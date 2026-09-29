#!/usr/bin/env node
// red-team.js - send one question to a panel of other-vendor models through OpenRouter, then have a
// critic attack Claude's draft answer. Claude is the integrator: this script only gathers.
//
//   node red-team.js --question q.md --draft d.md [--panel id,id,...] [--critic id] [--max-tokens n] [--dry-run]
//
// Stage 1 (panel): every panel model answers the question alone, in parallel, never seeing the
// draft or each other - independent drafts, because agents shown a peer's answer copy it.
// Stage 2 (critic): one model gets the question, the draft and the panel answers labelled A, B, C
// (model names withheld) and returns findings against the draft as JSON.
// stdout: one JSON object {panel, critique, errors, usage, key}. `key` maps labels to model ids and
// comes last, so the answers are read before the names.
//
// The critic sits outside the panel by default, so it never judges its own anonymised answer.
// Input files may be UTF-8 or UTF-16 with a BOM (PowerShell 5.1 `>` writes UTF-16LE).
//
// Exit 0 critique returned; 1 critic call failed or no panel answer came back; 2 usage error, an
// unreadable input file, or OPENROUTER_API_KEY unset with no HTTPS_PROXY. OPENROUTER_BASE_URL overrides the endpoint (the tests point it at a mock).
//
// Behind HTTPS_PROXY (a cloud container, whose proxy injects the OpenRouter key) the script re-runs
// itself with NODE_USE_ENV_PROXY=1: Node's fetch ignores the proxy variables otherwise, goes direct,
// and OpenRouter answers 401 "Missing Authentication header". The variable is read at startup only.

'use strict'
const fs = require('fs')
const { spawnSync } = require('child_process')

const DEFAULT_PANEL = ['google/gemini-3.1-pro-preview', 'x-ai/grok-4.7', 'openai/gpt-6.1-sol-pro']
const DEFAULT_CRITIC = 'openai/gpt-5.5'
const TIMEOUT_MS = 180000
// Sent on every call: without it OpenRouter reserves the model's whole output window (64k-128k tokens)
// against the balance and answers 402 even when the real answer would be cheap.
const DEFAULT_MAX_TOKENS = 16000

const PANEL_SYSTEM = 'Answer the question as well as you can. Be concrete. State your assumptions, ' +
  'and say what you are unsure of and why. Leave out your own name and your maker\'s.'

const CRITIC_SYSTEM = `You are the red team. Find what is wrong with DRAFT, the answer another assistant
plans to send. The PANEL answers came from independent models that never saw DRAFT; use them as
evidence where they disagree with DRAFT or cover something DRAFT misses. Attack substance: factual
errors, unsupported claims, missing risks or options, wrong recommendations, contradictions. Leave
style alone. Every finding quotes the DRAFT text it targets, or says "missing" for an omission, and
names its evidence: a panel label (A, B, C...) or your own reasoning in one line.
Return JSON only, in this shape:
{"verdict": "sound" | "needs-changes" | "wrong",
 "findings": [{"severity": "high" | "medium" | "low", "quote": "...", "problem": "...",
               "evidence": "...", "fix": "..."}],
 "panelOnly": ["points a panel answer makes that DRAFT lacks and that matter"]}`

function parseArgs(argv) {
  const args = { panel: DEFAULT_PANEL, critic: DEFAULT_CRITIC, maxTokens: DEFAULT_MAX_TOKENS, dryRun: false }
  const value = (i, flag) => {
    const v = argv[i]
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} needs a value`)
    return v
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--dry-run') args.dryRun = true
    else if (a === '--question') args.question = value(++i, a)
    else if (a === '--draft') args.draft = value(++i, a)
    else if (a === '--panel') args.panel = value(++i, a).split(',').map(s => s.trim()).filter(Boolean)
    else if (a === '--critic') args.critic = value(++i, a)
    else if (a === '--max-tokens') {
      args.maxTokens = Number(value(++i, a))
      if (!Number.isInteger(args.maxTokens) || args.maxTokens < 1) throw new Error('--max-tokens needs a positive integer')
    }
    else throw new Error(`unknown argument: ${a}`)
  }
  if (!args.question || !args.draft) throw new Error('--question and --draft are both required')
  if (!args.panel.length) throw new Error('--panel needs at least one model id')
  if (args.panel.includes(args.critic)) throw new Error(`critic ${args.critic} is also on the panel; it would judge its own answer`)
  return args
}

const label = i => String.fromCharCode(65 + i)

// A BYOK call (the account's own provider key) bills the provider directly: usage.cost holds only
// OpenRouter's fee, often 0, and the model's price sits in cost_details.upstream_inference_cost.
const callCost = u => Number(u.cost || 0) + (u.is_byok ? Number((u.cost_details && u.cost_details.upstream_inference_cost) || 0) : 0)

function panelRequest(model, question, maxTokens = DEFAULT_MAX_TOKENS) {
  return { model, max_tokens: maxTokens, messages: [{ role: 'system', content: PANEL_SYSTEM }, { role: 'user', content: question }] }
}

function criticRequest(model, question, draft, answers, maxTokens = DEFAULT_MAX_TOKENS) {
  const panel = answers.map(a => `### Panel ${a.label}\n${a.answer}`).join('\n\n')
  return {
    model,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: CRITIC_SYSTEM },
      { role: 'user', content: `## QUESTION\n${question}\n\n## DRAFT\n${draft}\n\n## PANEL\n${panel}` },
    ],
  }
}

async function complete(body, key) {
  try { return await request(body, key) } catch (e) {
    throw new Error(e.message.startsWith(`${body.model}: `) ? e.message : `${body.model}: ${e.message}`)
  }
}

async function request(body, key) {
  const base = process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1'
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { ...(key && { Authorization: `Bearer ${key}` }), 'Content-Type': 'application/json', 'X-Title': 'claude-red-team' },
    body: JSON.stringify({ ...body, usage: { include: true } }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${body.model}: HTTP ${res.status} ${text.slice(0, 300)}`)
  const json = JSON.parse(text)
  const content = json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content
  if (!content) throw new Error(`${body.model}: empty response ${text.slice(0, 300)}`)
  return { content, usage: json.usage || {} }
}

// A model asked for JSON can still wrap it in a fence or prose; take the outermost object. Anything
// without a findings array comes back as verdict 'unparsed' with the raw text, never as a clean pass.
function parseCritique(content) {
  const isCritique = v => v && typeof v === 'object' && Array.isArray(v.findings)
  try { const v = JSON.parse(content); if (isCritique(v)) return v } catch (_) { /* try the outermost object */ }
  const start = content.indexOf('{'), end = content.lastIndexOf('}')
  if (start >= 0 && end > start) {
    try { const v = JSON.parse(content.slice(start, end + 1)); if (isCritique(v)) return v } catch (_) { /* keep the raw text */ }
  }
  return { verdict: 'unparsed', findings: [], raw: content }
}

function readText(file) {
  const buf = fs.readFileSync(file)
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le')
  if (buf[0] === 0xfe && buf[1] === 0xff) return Buffer.from(buf.subarray(2)).swap16().toString('utf16le')
  return buf.toString('utf8').replace(/^\uFEFF/, '')
}

async function run(args, apiKey, question, draft) {

  if (args.dryRun) {
    const placeholders = args.panel.map((_, i) => ({ label: label(i), answer: `<panel ${label(i)} answer>` }))
    const requests = args.panel.map(m => panelRequest(m, question, args.maxTokens))
    requests.push(criticRequest(args.critic, question, draft, placeholders, args.maxTokens))
    return { code: 0, out: { dryRun: true, requests } }
  }

  const settled = await Promise.allSettled(args.panel.map(m => complete(panelRequest(m, question, args.maxTokens), apiKey)))
  const panel = [], key = {}, errors = [], usage = { cost: 0, calls: [] }
  settled.forEach((s, i) => {
    const model = args.panel[i]
    if (s.status === 'rejected') { errors.push(String((s.reason && s.reason.message) || s.reason)); return }
    const l = label(panel.length)
    panel.push({ label: l, answer: s.value.content })
    key[l] = model
    usage.cost += callCost(s.value.usage)
    usage.calls.push({ model, cost: callCost(s.value.usage), byok: Boolean(s.value.usage.is_byok) })
  })
  if (!panel.length) return { code: 1, out: { error: 'no panel answer came back', errors } }

  let critique
  try {
    const c = await complete(criticRequest(args.critic, question, draft, panel, args.maxTokens), apiKey)
    critique = parseCritique(c.content)
    usage.cost += callCost(c.usage)
    usage.calls.push({ model: args.critic, role: 'critic', cost: callCost(c.usage), byok: Boolean(c.usage.is_byok) })
  } catch (e) {
    return { code: 1, out: { error: `critic failed: ${e.message}`, panel, errors, usage, key } }
  }
  return { code: 0, out: { panel, critique, errors, usage, key } }
}

async function main() {
  let args
  try { args = parseArgs(process.argv.slice(2)) } catch (e) {
    process.stderr.write(`red-team: ${e.message}\n`)
    return 2
  }
  let question, draft
  try { question = readText(args.question); draft = readText(args.draft) } catch (e) {
    process.stderr.write(`red-team: cannot read input: ${e.message}\n`)
    return 2
  }
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey && !args.dryRun && !proxy()) {
    process.stderr.write('red-team: OPENROUTER_API_KEY is not set (create one at openrouter.ai, Keys page; keep it in environment secrets, never in a repo)\n')
    return 2
  }
  const { code, out } = await run(args, apiKey, question, draft)
  process.stdout.write(JSON.stringify(out, null, 2) + '\n')
  return code
}

const proxy = () => process.env.HTTPS_PROXY || process.env.https_proxy

if (require.main === module) {
  if (proxy() && process.env.NODE_USE_ENV_PROXY !== '1') {
    const r = spawnSync(process.execPath, process.argv.slice(1), { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1' } })
    process.exitCode = r.status ?? 1
  } else main().then(code => { process.exitCode = code })
}

module.exports = { parseArgs, parseCritique, callCost, readText, panelRequest, criticRequest, run, DEFAULT_PANEL, DEFAULT_CRITIC }
