#!/usr/bin/env node
// file-it router: asks TypeSafe Jev where each part of an item belongs, using the destinations
// table in aac-nexus (destinations.json, nexus ADR 0007). One POST for every part: a `home.<id>`
// and a `form.<id>` Choice per part.
//
//   node route.js --destinations <destinations.json> --parts <parts.json>
//
// parts.json: [{ "id": "rulings", "text": "what this part is, who reads it, what it decides" }, ...]
// Prints JSON: { jev: "answered" | "unavailable", parts: [{ id, home, form, home_p, form_p }] }.
// home and form are null when Jev is unavailable; the model then picks (SKILL.md, step 3).
// Exit codes: 0 printed, 1 bad destinations or parts (every error listed), 2 bad arguments.
'use strict';

const fs = require('fs');
const path = require('path');

function validateDestinations(d) {
  const errors = [];
  if (!d || typeof d !== 'object') return ['destinations: not a JSON object'];
  for (const key of ['homes', 'forms']) {
    if (!Array.isArray(d[key]) || d[key].length === 0) { errors.push(`destinations.${key}: missing or empty`); continue; }
    const seen = new Set();
    d[key].forEach((e, i) => {
      if (!e || typeof e.id !== 'string' || !/^[a-z0-9-]+$/.test(e.id)) errors.push(`destinations.${key}[${i}]: id missing or not kebab-case`);
      else if (seen.has(e.id)) errors.push(`destinations.${key}[${i}]: duplicate id ${e.id}`);
      else seen.add(e.id);
      if (!e || typeof e.means !== 'string' || !e.means.trim()) errors.push(`destinations.${key}[${i}]: means missing`);
    });
    if (d[key].length > 255) errors.push(`destinations.${key}: more than 255 options (Jev Choice limit)`);
  }
  return errors;
}

function validateParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return ['parts: must be a non-empty list'];
  const errors = [];
  const seen = new Set();
  parts.forEach((p, i) => {
    if (!p || typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) errors.push(`parts[${i}]: id missing or not kebab-case`);
    else if (seen.has(p.id)) errors.push(`parts[${i}]: duplicate id ${p.id}`);
    else seen.add(p.id);
    if (!p || typeof p.text !== 'string' || !p.text.trim()) errors.push(`parts[${i}]: text missing`);
  });
  return errors;
}

/** State key for a part: Jev's instructions name it in backticks. */
function stateKey(id) { return 'part_' + id.replace(/-/g, '_'); }

/** The Jev request: one state, two Choice questions per part. Pure. */
function buildRequest(destinations, parts) {
  const criteria = (list) => Object.fromEntries(list.map((e) => [e.id, e.means]));
  const state = {};
  const questions = {};
  for (const p of parts) {
    const k = stateKey(p.id);
    state[k] = p.text;
    questions[`home.${p.id}`] = {
      type: 'choice',
      instructions: `\`${k}\` describes an item of Active Alarm Company work that is about to be saved. Which home does it belong in?`,
      criteria: criteria(destinations.homes),
    };
    questions[`form.${p.id}`] = {
      type: 'choice',
      instructions: `\`${k}\` describes an item of Active Alarm Company work that is about to be saved. What form should it take in its home?`,
      criteria: criteria(destinations.forms),
    };
  }
  return { state, questions };
}

/** Read Jev's answers into one route per part; null fields when an answer is missing. Pure. */
function readAnswers(destinations, parts, answers) {
  const valid = { home: new Set(destinations.homes.map((e) => e.id)), form: new Set(destinations.forms.map((e) => e.id)) };
  const pick = (kind, id) => {
    const a = answers && answers[`${kind}.${id}`];
    const choice = a && typeof a === 'object' ? a.choice : null;
    if (!valid[kind].has(choice)) return { choice: null, p: null };
    const p = a.probabilities && typeof a.probabilities[choice] === 'number' ? a.probabilities[choice] : null;
    return { choice, p };
  };
  const routed = parts.map((part) => {
    const h = pick('home', part.id);
    const f = pick('form', part.id);
    return { id: part.id, home: h.choice, form: f.choice, home_p: h.p, form_p: f.p };
  });
  const answered = routed.every((r) => r.home && r.form);
  return { jev: answered ? 'answered' : 'unavailable',
           parts: answered ? routed : routed.map((r) => ({ id: r.id, home: null, form: null, home_p: null, form_p: null })) };
}

async function route(destinations, parts, ask) {
  const { state, questions } = buildRequest(destinations, parts);
  let answers = null;
  try { answers = await ask(state, questions); } catch (e) { answers = null; }
  return readAnswers(destinations, parts, answers);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!['--destinations', '--parts'].includes(flag) || argv[i + 1] === undefined) return null;
    out[flag.slice(2)] = argv[i + 1];
  }
  return out.destinations && out.parts ? out : null;
}

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    process.stderr.write('usage: node route.js --destinations <destinations.json> --parts <parts.json>\n');
    process.exit(2);
  }
  let destinations;
  let parts;
  const errors = [];
  try { destinations = JSON.parse(fs.readFileSync(args.destinations, 'utf8')); } catch (e) { errors.push(`destinations: ${e.message}`); }
  try { parts = JSON.parse(fs.readFileSync(args.parts, 'utf8')); } catch (e) { errors.push(`parts: ${e.message}`); }
  if (!errors.length) errors.push(...validateDestinations(destinations), ...validateParts(parts));
  if (errors.length) { process.stderr.write(errors.join('\n') + '\n'); process.exit(1); }
  const { askJev } = require(path.join(__dirname, 'jev.js'));
  route(destinations, parts, (s, q) => askJev(s, q, { timeoutMs: 15000 })).then((result) => {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    process.exit(0);
  });
} else {
  module.exports = { validateDestinations, validateParts, buildRequest, readAnswers, route, stateKey };
}
