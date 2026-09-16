#!/usr/bin/env node
/**
 * claude-md-lint — check a CLAUDE.md against the "keep it concise" paradigm.
 *
 *   node tools/claude-md-lint.js <path/to/CLAUDE.md> [--max-lines N] [--max-words N]
 *                                [--against <other.md>]... [--warn-only a,b] [--json]
 *
 * The paradigm (Anthropic's CLAUDE.md guidance): for each line ask "would removing this cause
 * Claude to make mistakes?" — if not, cut it. Bloated files make Claude ignore the rules that
 * matter. Include: commands Claude can't guess, style rules that differ from defaults, test
 * runners, repo etiquette, project-specific architecture decisions, env quirks, gotchas.
 * Exclude: anything derivable by reading code, standard conventions, detailed API docs, facts
 * that change often, tutorials, file-by-file inventories, self-evident practice.
 *
 * The derivability test is borrowed from the bundled /doctor skill (Claude Code 2.1.206+):
 * a line a fresh session could reconstruct with a few tool calls (`ls`, `cat`, the manifest,
 * `--help`) is dead weight every session pays for. /doctor applies that with model judgment,
 * interactively, to checked-in files only; this tool applies the mechanical subset to any file,
 * with exit codes, so it can gate a commit.
 *
 * Every rule here is a heuristic for one row of that table. A finding means "look at this
 * line and ask the question", not "this line is wrong". Rules:
 *
 *   size               over the line / word / char budget (bloat is the root failure; the char
 *                      budget is Claude Code's own large-memory-file warning floor)
 *   self-evident       "write clean code", "follow best practices" — Claude knows
 *   std-convention     "follow PEP 8", "use camelCase in JS" — default behaviour, only keep deltas
 *   enforced-elsewhere a formatting rule when a formatter/linter config sits beside the file —
 *                      the tool enforces it mechanically, the prose is a copy
 *   guessable-command  a fenced command that is the tool's standard invocation, or a bare
 *                      `npm run X` that package.json scripts already lists, with no flag or
 *                      comment adding anything
 *   tech-stack         a "Tech stack" / "Dependencies" section, or a list run of manifest
 *                      dependency names — the manifest already says this
 *   tutorial           paragraph over TUTORIAL_WORDS words — an explanation, not a rule
 *   file-inventory     run of list items that each start with a path, or a fenced directory
 *                      tree — derivable by `ls`
 *   api-dump           run of list items that each start with `name(...)` — link to docs
 *   lazy-candidate     a "How to deploy" / "Release checklist" / "Reference" section with real
 *                      length — task-specific; move to a skill or nested file, keep a pointer
 *   volatile           counts, progress, TODO/WIP, "currently" — changes faster than the file
 *   code-derivable     "`foo()` returns …" — describing what code does instead of a rule
 *   ambiguous          "try to", "if possible", "when appropriate" — hedged rules get ignored
 *   duplicate          same sentence twice in this file, or also present in an --against file
 *   emphasis           more than EMPHASIS_MAX shouting markers (MUST/NEVER/ALWAYS/IMPORTANT)
 *
 * Keep-always guard (also from /doctor): a line carrying a prohibition — never / do not /
 * must not — is exempt from self-evident, std-convention, enforced-elsewhere and code-derivable.
 * Safety rules are never "generic".
 *
 * Suppress: a line containing `claude-md-lint-ignore` (inside an HTML comment) silences
 * findings on that line and the next; `<!-- claude-md-lint-disable: rule,rule -->` anywhere
 * silences those rules for the file. Fenced code blocks are never linted as prose; only the
 * guessable-command and file-inventory (tree) rules look inside them.
 *
 * Repo context: the CLI reads package.json (scripts, dependencies) and looks for formatter /
 * linter configs in the same directory as the file. Library callers pass `manifest` and
 * `formatterConfigs` in opts instead.
 *
 * Warn-only rules (issue 337): some rules are prompts rather than verdicts, and which ones is a
 * per-file fact this repo already states — `size` on any file, so a slow creep is visible without
 * going red, plus `volatile`, `code-derivable` and `tutorial` on `claude/CLAUDE.md`, the byte
 * mirror of a personal ~/.claude/CLAUDE.md whose text quotes counterexamples that trip those
 * regexes on purpose. A warn-only finding prints like any other and does not set the exit code,
 * so a caller that trusts the exit code reads the file the way the repo does. `--warn-only a,b`
 * replaces the per-file set; `--warn-only ''` makes every rule gate.
 *
 * Exit 0 when nothing is left after the warn-only split, 1 on a gating finding, 2 usage / read
 * error. Output one line per finding:
 *   <path>:<line>\t<rule>\t<message>
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Bumped when this file changes ahead of the generated skill copies (claude/skills/claude-md-lint,
// marketplace/...), which only `sync.ps1 -Mode push` can refresh from a Windows machine. The drift
// test in claude-md-lint.test.js allows a mirror that is behind by revision — a declaration that
// shows up in the diff — and still fails on an undeclared byte difference.
const MIRROR_REVISION = 2;

const DEFAULTS = Object.freeze({
  maxLines: 200,      // non-blank lines (docs: "target under 200 lines")
  maxWords: 2500,     // prose words, fences excluded
  maxChars: 40000,    // Claude Code warns above ~5% of context, floor ~40,000 chars
  tutorialWords: 120, // words in one paragraph
  inventoryRun: 6,    // consecutive path-led list items
  apiRun: 5,          // consecutive signature-led list items
  depRun: 4,          // consecutive dependency-named list items
  lazyWords: 80,      // prose words under a task-specific heading
  emphasisMax: 12,    // MUST/NEVER/ALWAYS/IMPORTANT occurrences
});

const RULES = Object.freeze([
  'size', 'self-evident', 'std-convention', 'enforced-elsewhere', 'guessable-command', 'tech-stack',
  'tutorial', 'file-inventory', 'api-dump', 'lazy-candidate', 'volatile', 'code-derivable',
  'ambiguous', 'duplicate', 'emphasis',
]);

// Rules that print but do not gate. WARN_ONLY_DEFAULT applies to any file; PATH_WARN_ONLY names
// the files whose set differs, matched on a path suffix so an absolute path works too.
const WARN_ONLY_DEFAULT = Object.freeze(['size']);
const PATH_WARN_ONLY = Object.freeze([
  { suffix: 'claude/CLAUDE.md', rules: Object.freeze(['size', 'volatile', 'code-derivable', 'tutorial']) },
]);

/** The warn-only rule set for a file. `override` (from --warn-only) replaces it wholesale. */
function warnOnlyFor(file, override) {
  if (Array.isArray(override)) return new Set(override);
  const p = String(file).replace(/\\/g, '/');
  for (const e of PATH_WARN_ONLY) {
    if (p === e.suffix || p.endsWith('/' + e.suffix)) return new Set(e.rules);
  }
  return new Set(WARN_ONLY_DEFAULT);
}

const PROHIBITION = /\b(never|do not|don'?t|must not|forbidden|prohibited)\b/i;

const SELF_EVIDENT = [
  /\bwrite (clean|good|readable|maintainable|quality) code\b/i,
  /\bfollow (the )?best practices?\b/i,
  /\buse (meaningful|descriptive|good) (variable |function )?names\b/i,
  /\bbe (careful|thorough|thoughtful|mindful|consistent)\b/i,
  /\b(always )?handle errors? (properly|correctly|gracefully)\b/i,
  /\bkeep (the )?code (clean|readable|simple|dry)\b/i,
  /\bmake sure (the )?code works\b/i,
  /\bthink (carefully|step by step) before\b/i,
  /\bavoid (code )?duplication\b/i,
  /\b(add|write) tests\.?$/i,
];

const STD_CONVENTION = [
  /\bfollow(s|ing)? pep ?8\b/i,
  /\buse camel ?case (for|in) (javascript|typescript|js|ts)\b/i,
  /\buse snake_?case (for|in) python\b/i,
  /\b(follow|use) (the )?(airbnb|google|standard) (js |javascript )?style guide\b/i,
  /\buse (const|let) (instead of|over|not) var\b/i,
  /\buse semicolons\b/i,
  /\b(follow|use) idiomatic \w+\b/i,
  /\buse (2|4)[- ]space indent(ation)?\b/i,
  /\brun (prettier|black|gofmt|rustfmt) (with )?defaults?\b/i,
];

const STYLE_RULE = /\b(semicolons?|single quotes?|double quotes?|trailing commas?|tabs? (vs|not|over|instead of) spaces|spaces (vs|not|over|instead of) tabs|indent(ation)? (with|using)|line length|max(imum)? line|print ?width|import (order|sorting)|sorted imports|\d+[- ]space)\b/i;

const FORMATTER_CONFIGS = [
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.cjs', '.prettierrc.yaml', '.prettierrc.yml',
  'prettier.config.js', 'prettier.config.cjs', 'prettier.config.mjs',
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yaml', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts',
  'biome.json', 'biome.jsonc', '.editorconfig', 'ruff.toml', '.ruff.toml', 'setup.cfg', 'tox.ini',
  '.flake8', 'rustfmt.toml', '.rustfmt.toml', '.golangci.yml', '.golangci.yaml', '.pre-commit-config.yaml',
  '.stylelintrc', '.clang-format', 'dprint.json',
];

// Bare standard invocations: the tool's own default. Anything after them (flags, args) or a
// trailing comment means the author added something a session could not guess.
const STANDARD_COMMANDS = new Set([
  'npm install', 'npm i', 'npm ci', 'npm test', 'npm t', 'npm start', 'npm run build', 'npm run test',
  'yarn', 'yarn install', 'yarn test', 'yarn build', 'yarn start',
  'pnpm install', 'pnpm i', 'pnpm test', 'pnpm build', 'pnpm start',
  'bun install', 'bun test',
  'pip install -r requirements.txt', 'pip install -e .', 'pytest', 'python -m pytest', 'poetry install', 'poetry run pytest',
  'cargo build', 'cargo test', 'cargo run', 'cargo check', 'cargo fmt', 'cargo clippy',
  'go build', 'go build ./...', 'go test', 'go test ./...', 'go vet ./...', 'go run .',
  'make', 'make test', 'make build', 'dotnet build', 'dotnet test', 'dotnet run', 'mvn test', 'mvn package',
  'gradle test', './gradlew test', 'npx tsc', 'npx tsc --noEmit', 'npx eslint .', 'npx prettier --check .',
  'npx prettier --write .', 'npx jest', 'npx vitest', 'git status', 'git pull', 'docker compose up', 'docker-compose up',
]);

const VOLATILE = [
  /\b\d+ of \d+\b/,
  /\b(currently|at the moment|right now|for now)\b/i,
  /\b(in progress|work in progress|wip|todo|fixme)\b/i,
  /\b(halfway|almost|nearly) (done|finished|complete)\b/i,
  /^\s*\**status\**\s*:/i,
  /\b(coming soon|not yet (implemented|done|built))\b/i,
];

const CODE_DERIVABLE = [
  /`[\w.$]+\([^`]*\)`\s+(returns?|takes?|accepts?|does|handles?|is responsible for|calls?)\b/i,
  /\bthe `?[\w.$]+`? (function|method|class|module) (returns?|takes?|accepts?|does|handles?|is responsible for)\b/i,
  /\bthis (file|module|class) (contains|defines|implements|exports) /i,
];

const AMBIGUOUS = [
  /\btry to\b/i,
  /\bif possible\b/i,
  /\bwhen(ever)? (appropriate|possible|applicable|it makes sense)\b/i,
  /\b(you )?(might|may) want to\b/i,
  /\bconsider (using|adding|checking)\b/i,
  /\bideally\b/i,
  /\bgenerally (speaking )?(prefer|use|avoid)\b/i,
  /\bshould probably\b/i,
];

const EMPHASIS = /\b(MUST|NEVER|ALWAYS|IMPORTANT|CRITICAL|DO NOT)\b/g;
const PATH_ITEM = /^\s*[-*+]\s+`[^`]*[\/\\.][^`]*`\s*[-–—:]/;
const SIGNATURE_ITEM = /^\s*[-*+]\s+`?[\w.$]+\([^)]*\)`?\s*[-–—:]/;
const TREE_LINE = /(├──|└──|│|^\s*[|`]-- )/;
const TECH_STACK_HEADING = /^\s*#{1,6}\s*\**(tech(nical|nology)?[ -]?stack|stack|dependencies|technologies|libraries|tools (used|we use))\b/i;
const LAZY_HEADING = /\b(how to|deploy(ment|ing)?|release (process|checklist|steps)|checklist|api reference|reference|walkthrough|tutorial|onboarding|troubleshooting|runbook|migration guide)\b/i;
const FENCE = /^\s*(```|~~~)/;
const HEADING = /^\s*#{1,6}\s/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s+/;

function wordsIn(text) {
  const m = text.match(/[A-Za-z0-9_'`]+/g);
  return m ? m.length : 0;
}

function normalizeSentence(line) {
  return line
    .replace(/^\s*([-*+]|\d+[.)])\s+/, '')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/[*_`]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Strip a shell prompt and trailing comment from a fenced command line. */
function bareCommand(line) {
  let s = line.trim().replace(/^\$\s+/, '');
  const hadComment = /\s(#|\/\/)\s/.test(s) || /\s#$/.test(s);
  s = s.replace(/\s+(#|\/\/)\s.*$/, '').trim();
  return { cmd: s, hadComment };
}

/** Index the sentences of a sibling file for the --against duplicate check. */
function sentenceIndex(text) {
  const map = new Map();
  let inFence = false;
  text.split(/\r?\n/).forEach((raw, i) => {
    if (FENCE.test(raw)) { inFence = !inFence; return; }
    if (inFence || HEADING.test(raw)) return;
    const key = normalizeSentence(raw);
    if (key.split(' ').length >= 6 && !map.has(key)) map.set(key, i + 1);
  });
  return map;
}

/**
 * Lint markdown text. Returns { findings, stats }.
 * opts.manifest: { scripts: {}, dependencies: [] } (parsed package.json, optional)
 * opts.formatterConfigs: string[] of config filenames found beside the file (optional)
 * opts.against: [{ name, text }] sibling files for the cross-file duplicate check (optional)
 */
function lint(text, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const manifest = o.manifest || null;
  const scripts = new Set(Object.keys((manifest && manifest.scripts) || {}));
  const deps = new Set(((manifest && manifest.dependencies) || []).map((d) => String(d).toLowerCase()));
  const formatterConfigs = Array.isArray(o.formatterConfigs) ? o.formatterConfigs : [];
  const against = (o.against || []).map((a) => ({ name: a.name, index: sentenceIndex(a.text) }));

  const lines = text.split(/\r?\n/);
  const findings = [];
  const disabled = new Set();
  const ignoreLines = new Set();

  const disableRe = /claude-md-lint-disable:\s*([\w-]+(?:\s*,\s*[\w-]+)*)/g;
  let dm;
  while ((dm = disableRe.exec(text)) !== null) {
    for (const r of dm[1].split(',')) { const n = r.trim(); if (n) disabled.add(n); }
  }
  lines.forEach((l, i) => {
    if (/claude-md-lint-ignore/.test(l)) { ignoreLines.add(i + 1); ignoreLines.add(i + 2); }
  });

  const add = (rule, lineNo, message) => {
    if (disabled.has(rule) || ignoreLines.has(lineNo)) return;
    findings.push({ rule, line: lineNo, message });
  };
  const clip = (t) => `"${t.trim().slice(0, 80)}"`;

  // Pass 1: classify lines (prose vs fence), collect stats, lint fence contents.
  let inFence = false;
  let fenceStart = 0;
  let fenceLines = [];
  let nonBlank = 0;
  let proseWords = 0;
  let fenceCount = 0;
  let emphasisCount = 0;
  const prose = []; // { n, text }
  const closeFence = () => {
    const treeLines = fenceLines.filter((l) => TREE_LINE.test(l.text)).length;
    if (treeLines >= 3) {
      add('file-inventory', fenceStart, `directory tree (${treeLines} tree lines) — \`ls\` shows this; cut it`);
    }
    fenceLines.forEach(({ n, text: t }) => {
      const { cmd, hadComment } = bareCommand(t);
      if (!cmd || hadComment) return;
      if (STANDARD_COMMANDS.has(cmd)) {
        add('guessable-command', n, `\`${cmd}\` is the tool's standard invocation — a session guesses this; keep only if a flag or comment adds a gotcha`);
        return;
      }
      const m = cmd.match(/^(?:npm run|npm run-script|yarn run|yarn|pnpm run|pnpm|bun run)\s+([\w:.-]+)$/);
      if (m && scripts.has(m[1])) {
        add('guessable-command', n, `\`${cmd}\` — package.json scripts already lists "${m[1]}"; keep only if a flag or comment adds a gotcha`);
      }
    });
    fenceLines = [];
  };
  lines.forEach((raw, i) => {
    const n = i + 1;
    if (FENCE.test(raw)) {
      if (!inFence) { fenceCount++; fenceStart = n; } else { closeFence(); }
      inFence = !inFence;
      nonBlank++;
      return;
    }
    if (raw.trim() !== '') nonBlank++;
    if (inFence) { fenceLines.push({ n, text: raw }); return; }
    if (raw.trim() === '') { prose.push({ n, text: '' }); return; }
    proseWords += wordsIn(raw);
    const em = raw.match(EMPHASIS);
    if (em) emphasisCount += em.length;
    prose.push({ n, text: raw });
  });
  if (inFence) closeFence();

  // size
  if (nonBlank > o.maxLines) {
    add('size', 1, `${nonBlank} non-blank lines, budget ${o.maxLines} — bloat is why rules get ignored; cut before adding`);
  }
  if (proseWords > o.maxWords) {
    add('size', 1, `${proseWords} prose words, budget ${o.maxWords} — bloat is why rules get ignored; cut before adding`);
  }
  if (text.length > o.maxChars) {
    add('size', 1, `${text.length} chars, over ${o.maxChars} — Claude Code itself warns about a memory file this large`);
  }
  if (emphasisCount > o.emphasisMax) {
    add('emphasis', 1, `${emphasisCount} MUST/NEVER/ALWAYS/IMPORTANT markers (max ${o.emphasisMax}) — rules shouting over each other is the symptom of a file too long; shorten instead`);
  }

  // Per-line pattern rules.
  const seen = new Map();
  for (const { n, text: t } of prose) {
    if (!t) continue;
    const prohibition = PROHIBITION.test(t);
    if (!prohibition) {
      for (const re of SELF_EVIDENT) {
        if (re.test(t)) { add('self-evident', n, `${clip(t)} — Claude already does this; cut`); break; }
      }
      for (const re of STD_CONVENTION) {
        if (re.test(t)) { add('std-convention', n, `${clip(t)} — default behaviour; keep only if it differs from the default`); break; }
      }
      if (formatterConfigs.length && STYLE_RULE.test(t)) {
        add('enforced-elsewhere', n, `${clip(t)} — ${formatterConfigs.join(', ')} enforces formatting mechanically; cut unless the prose says something the config does not`);
      }
      for (const re of CODE_DERIVABLE) {
        if (re.test(t)) { add('code-derivable', n, `${clip(t)} — describes what code does; Claude can read the code`); break; }
      }
    }
    for (const re of VOLATILE) {
      if (re.test(t)) { add('volatile', n, `${clip(t)} — changes faster than this file; point at the tracker or code instead`); break; }
    }
    for (const re of AMBIGUOUS) {
      if (re.test(t)) { add('ambiguous', n, `${clip(t)} — hedged rule; make it imperative or cut`); break; }
    }
    if (HEADING.test(t)) {
      if (TECH_STACK_HEADING.test(t)) add('tech-stack', n, `${clip(t)} — the package manifest already says this; cut the section`);
    } else {
      const key = normalizeSentence(t);
      if (key.split(' ').length >= 6) {
        if (seen.has(key)) add('duplicate', n, `repeats line ${seen.get(key)} — say it once`);
        else seen.set(key, n);
        for (const a of against) {
          if (a.index.has(key)) {
            add('duplicate', n, `also in ${a.name}:${a.index.get(key)} — keep one copy; if one file is shared across projects, keep the project-specific side there`);
          }
        }
      }
    }
  }

  // Paragraph rule (tutorial), list-run rules (file-inventory, api-dump, tech-stack), and
  // section rule (lazy-candidate).
  let para = [];
  let pathRun = [];
  let sigRun = [];
  let depRun = [];
  let section = null; // { n, text, words }
  const flushPara = () => {
    if (para.length === 0) return;
    const w = para.reduce((s, p) => s + wordsIn(p.text), 0);
    if (w > o.tutorialWords && !LIST_ITEM.test(para[0].text) && !HEADING.test(para[0].text)) {
      add('tutorial', para[0].n, `${w}-word paragraph — an explanation, not a rule; keep the rule, link the rest`);
    }
    para = [];
  };
  const flushRuns = () => {
    if (pathRun.length >= o.inventoryRun) {
      add('file-inventory', pathRun[0].n, `${pathRun.length} path-led items — file-by-file description; Claude can list the tree`);
    }
    if (sigRun.length >= o.apiRun) {
      add('api-dump', sigRun[0].n, `${sigRun.length} signature-led items — API documentation; link to the docs instead`);
    }
    if (depRun.length >= o.depRun) {
      add('tech-stack', depRun[0].n, `${depRun.length} items naming package.json dependencies — the manifest already says this`);
    }
    pathRun = [];
    sigRun = [];
    depRun = [];
  };
  const flushSection = () => {
    if (section && LAZY_HEADING.test(section.text) && section.words > o.lazyWords) {
      add('lazy-candidate', section.n, `${clip(section.text)} — ${section.words}-word task-specific section; move to a skill or nested CLAUDE.md, keep a one-line pointer`);
    }
    section = null;
  };
  const depItem = (t) => {
    if (!deps.size) return false;
    const m = t.match(/^\s*[-*+]\s+(?:\*\*|`)?([@\w./-]+)/);
    return !!(m && deps.has(m[1].toLowerCase()));
  };
  for (const { n, text: t } of prose) {
    if (!t) { flushPara(); flushRuns(); continue; }
    if (HEADING.test(t)) { flushPara(); flushRuns(); flushSection(); section = { n, text: t, words: 0 }; continue; }
    if (section) section.words += wordsIn(t);
    if (LIST_ITEM.test(t)) {
      flushPara();
      if (PATH_ITEM.test(t)) pathRun.push({ n, text: t }); else if (pathRun.length) { flushRuns(); }
      if (SIGNATURE_ITEM.test(t)) sigRun.push({ n, text: t }); else if (sigRun.length) { flushRuns(); }
      if (depItem(t)) depRun.push({ n, text: t }); else if (depRun.length) { flushRuns(); }
      continue;
    }
    if (/^\s{2,}\S/.test(t) && (pathRun.length || sigRun.length || depRun.length)) continue; // wrapped item
    flushRuns();
    para.push({ n, text: t });
  }
  flushPara();
  flushRuns();
  flushSection();

  findings.sort((a, b) => a.line - b.line || RULES.indexOf(a.rule) - RULES.indexOf(b.rule));
  return {
    findings,
    stats: {
      nonBlankLines: nonBlank,
      proseWords,
      chars: text.length,
      estTokens: Math.round(text.length / 4),
      fencedBlocks: fenceCount,
      emphasisMarkers: emphasisCount,
    },
  };
}

/** Repo context for a CLAUDE.md: package.json scripts/deps and formatter configs beside it. */
function repoContext(dir) {
  const ctx = { manifest: null, formatterConfigs: [] };
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    try {
      const j = JSON.parse(fs.readFileSync(pkg, 'utf8'));
      ctx.manifest = {
        scripts: j.scripts || {},
        dependencies: Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }),
      };
    } catch { /* unreadable manifest: no manifest-based checks */ }
  }
  ctx.formatterConfigs = FORMATTER_CONFIGS.filter((f) => fs.existsSync(path.join(dir, f)));
  return ctx;
}

function parseArgs(argv) {
  const out = { file: null, json: false, against: [], warnOnly: null, opts: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') out.json = true;
    else if (a === '--max-lines') out.opts.maxLines = Number(argv[++i]);
    else if (a === '--max-words') out.opts.maxWords = Number(argv[++i]);
    else if (a === '--against') { const f = argv[++i]; if (!f) throw new Error('--against needs a file'); out.against.push(f); }
    else if (a === '--warn-only') {
      const v = argv[++i];
      if (v === undefined) throw new Error('--warn-only needs a comma-separated rule list (empty for none)');
      out.warnOnly = v.split(',').map((r) => r.trim()).filter(Boolean);
      for (const r of out.warnOnly) if (!RULES.includes(r)) throw new Error(`--warn-only: unknown rule ${r}`);
    }
    else if (a.startsWith('--')) throw new Error(`unknown flag ${a}`);
    else if (!out.file) out.file = a;
    else throw new Error(`unexpected argument ${a}`);
  }
  if (!out.file) throw new Error('usage: claude-md-lint <CLAUDE.md> [--max-lines N] [--max-words N] [--against <other.md>]... [--warn-only a,b] [--json]');
  for (const k of ['maxLines', 'maxWords']) {
    if (k in out.opts && !(Number.isInteger(out.opts[k]) && out.opts[k] > 0)) throw new Error(`${k} must be a positive integer`);
  }
  return out;
}

function main(argv) {
  let args;
  try { args = parseArgs(argv); } catch (e) { process.stderr.write(e.message + '\n'); return 2; }
  let text;
  try { text = fs.readFileSync(args.file, 'utf8'); } catch (e) { process.stderr.write(`cannot read ${args.file}: ${e.message}\n`); return 2; }
  const against = [];
  for (const f of args.against) {
    try { against.push({ name: path.relative(process.cwd(), f) || f, text: fs.readFileSync(f, 'utf8') }); }
    catch (e) { process.stderr.write(`cannot read ${f}: ${e.message}\n`); return 2; }
  }
  const ctx = repoContext(path.dirname(path.resolve(args.file)));
  const { findings, stats } = lint(text, { ...args.opts, ...ctx, against });
  const rel = path.relative(process.cwd(), args.file) || args.file;
  const warnOnly = warnOnlyFor(rel, args.warnOnly);
  const gating = findings.filter((f) => !warnOnly.has(f.rule));
  if (args.json) {
    process.stdout.write(JSON.stringify(
      { file: rel, context: ctx, warnOnly: [...warnOnly], stats, findings: findings.map((f) => ({ ...f, gating: !warnOnly.has(f.rule) })) },
      null, 2) + '\n');
  } else {
    for (const f of findings) process.stdout.write(`${rel}:${f.line}\t${f.rule}\t${f.message}\n`);
    const tally = findings.length === 0
      ? 'already lean, nothing to cut'
      : `${findings.length} finding(s), ${gating.length} gating` +
        (findings.length > gating.length ? ` (warn-only here: ${[...warnOnly].join(', ')})` : '');
    process.stdout.write(
      `${rel}: ${stats.nonBlankLines} lines, ${stats.proseWords} prose words, ~${stats.estTokens} tokens, ${stats.fencedBlocks} fenced blocks, ` +
      `${stats.emphasisMarkers} emphasis markers — ${tally}\n`
    );
  }
  return gating.length === 0 ? 0 : 1;
}

module.exports = {
  lint, repoContext, warnOnlyFor,
  DEFAULTS, RULES, STANDARD_COMMANDS, FORMATTER_CONFIGS,
  WARN_ONLY_DEFAULT, PATH_WARN_ONLY, MIRROR_REVISION,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
