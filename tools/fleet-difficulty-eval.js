#!/usr/bin/env node
/**
 * Eval set for the fleet's Jev difficulty Score (issue 725).
 *
 *   node tools/fleet-difficulty-eval.js                    # print the eval set as JSON
 *   node tools/fleet-difficulty-eval.js --out <file.json>  # write it
 *   node tools/fleet-difficulty-eval.js --from <refs.txt>  # branch names from a file, one per line
 *   node tools/fleet-difficulty-eval.js --score            # also ask Jev per ticket and print level vs label
 *
 * The fleet's branch names record the attempt (`agent/issue-<N>-attempt<K>-...`), so every ticket
 * that needed attempt 2 or later is a free "hard" label; the rest stay unlabelled (null), because a
 * first-attempt pass says nothing about difficulty. Branches are read from every PR head ref (fleet
 * branches are deleted on merge, their PRs are not) plus the live `agent/issue-*` heads on origin.
 * The labelling itself is difficultyEvalSet in tools/ticket-fleet-branch.js; `--score` builds its
 * request with the same difficultyRequest the fleet sends, so the eval asks the fleet's question.
 */
'use strict';

const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { difficultyEvalSet, difficultyRequest, parseDifficulty, JEV_ENDPOINT } = require('./ticket-fleet-branch.js');

function run(cmd, argv) {
  const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${argv.join(' ')} failed: ${(r.stderr || r.error || '').toString().trim()}`);
  return r.stdout;
}

function fleetBranchNames() {
  const names = [];
  for (let page = 1; page <= 50; page++) {
    const refs = run('gh', ['api', `repos/{owner}/{repo}/pulls?state=all&per_page=100&page=${page}`, '--jq', '.[].head.ref'])
      .split('\n').filter(Boolean);
    names.push(...refs);
    if (refs.length < 100) break;
  }
  const heads = run('git', ['ls-remote', '--heads', 'origin', 'agent/issue-*']);
  for (const line of heads.split('\n')) {
    const m = /refs\/heads\/(\S+)/.exec(line);
    if (m) names.push(m[1]);
  }
  return names;
}

function score(set) {
  const tickets = set.map(e => {
    const issue = JSON.parse(run('gh', ['api', `repos/{owner}/{repo}/issues/${e.number}`]));
    return { number: e.number, title: issue.title, criteria: issue.body || '' };
  });
  const repoMap = fs.existsSync('CLAUDE.md') ? fs.readFileSync('CLAUDE.md', 'utf8') : '';
  const headers = ['-H', 'Content-Type: application/json'];
  if (process.env.TYPESAFE_API_KEY) headers.push('-H', `Authorization: Bearer ${process.env.TYPESAFE_API_KEY}`);
  const levels = {};
  for (let i = 0; i < tickets.length; i += 10) {
    const chunk = tickets.slice(i, i + 10);
    const body = JSON.stringify(difficultyRequest(chunk, repoMap));
    const r = spawnSync('curl', ['-sS', '-m', '60', '-X', 'POST', JEV_ENDPOINT, ...headers, '--data-binary', '@-'], { input: body, encoding: 'utf8' });
    Object.assign(levels, r.status === 0 ? parseDifficulty(r.stdout, chunk) : {});
  }
  return set.map(e => Object.assign({}, e, { jev: levels[e.number] || null }));
}

function main(argv) {
  const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
  const from = flag('--from');
  const names = from ? fs.readFileSync(from, 'utf8').split(/\r?\n/) : fleetBranchNames();
  let set = difficultyEvalSet(names);
  if (argv.includes('--score')) set = score(set);
  const text = JSON.stringify(set, null, 2) + '\n';
  const out = flag('--out');
  if (out) fs.writeFileSync(out, text);
  else process.stdout.write(text);
  const hard = set.filter(e => e.label === 'hard').length;
  process.stderr.write(`${set.length} fleet ticket(s), ${hard} labelled hard (attempt 2+).\n`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { main };
