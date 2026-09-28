'use strict'
// Tests for aac-skills/red-team/red-team.js against a local mock of OpenRouter's
// /chat/completions: no key, no network.
const test = require('node:test')
const assert = require('node:assert')
const http = require('node:http')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')

const SCRIPT = path.join(__dirname, '..', 'aac-skills', 'red-team', 'red-team.js')
const { parseArgs, parseCritique, readText, DEFAULT_PANEL, DEFAULT_CRITIC } = require(SCRIPT)

function tmpFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'red-team-'))
  const q = path.join(dir, 'q.md'), d = path.join(dir, 'd.md')
  fs.writeFileSync(q, 'Is the moon made of cheese?')
  fs.writeFileSync(d, 'Yes, cheddar.')
  return { q, d }
}

// handler(body) returns {status, json} per request; every request body is recorded.
function mockServer(handler) {
  const seen = []
  const server = http.createServer((req, res) => {
    let raw = ''
    req.on('data', c => { raw += c })
    req.on('end', () => {
      const body = JSON.parse(raw)
      seen.push({ body, auth: req.headers.authorization, url: req.url })
      const { status, json } = handler(body)
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(json))
    })
  })
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, seen, base: `http://127.0.0.1:${server.address().port}` })))
}

function runScript(args, env) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { env: { PATH: process.env.PATH, ...env } })
    let out = '', err = ''
    child.stdout.on('data', c => { out += c })
    child.stderr.on('data', c => { err += c })
    child.on('close', code => resolve({ code, out, err }))
  })
}

const reply = (content, cost = 0.01) => ({ status: 200, json: { choices: [{ message: { content } }], usage: { cost } } })
const isCritic = body => body.messages[0].content.includes('You are the red team')

test('panel answers blind, critic sees draft and anonymised panel, key comes last', async () => {
  const { server, seen, base } = await mockServer(body => isCritic(body)
    ? reply(JSON.stringify({ verdict: 'wrong', findings: [{ severity: 'high', quote: 'Yes, cheddar.', problem: 'false', evidence: 'A', fix: 'No.' }], panelOnly: [] }), 0.05)
    : reply(`answer from ${body.model}`))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/one,p/two', '--critic', 'c/critic'],
      { OPENROUTER_API_KEY: 'test-key', OPENROUTER_BASE_URL: base })
    assert.strictEqual(r.code, 0, r.err)
    const out = JSON.parse(r.out)

    const panelCalls = seen.filter(s => !isCritic(s.body))
    assert.strictEqual(panelCalls.length, 2)
    for (const c of panelCalls) {
      assert.strictEqual(c.url, '/chat/completions')
      assert.strictEqual(c.auth, 'Bearer test-key')
      assert.ok(!JSON.stringify(c.body.messages).includes('cheddar'), 'panel must never see the draft')
    }

    const critic = seen.find(s => isCritic(s.body))
    assert.strictEqual(critic.body.model, 'c/critic')
    const user = critic.body.messages[1].content
    assert.ok(user.includes('Yes, cheddar.'), 'critic sees the draft')
    assert.ok(user.includes('### Panel A') && user.includes('### Panel B'))
    assert.ok(!/### Panel [AB]\s*\(?p\//.test(user), 'panel labels carry no model id')

    assert.strictEqual(out.critique.verdict, 'wrong')
    assert.strictEqual(out.critique.findings.length, 1)
    assert.deepStrictEqual(out.key, { A: 'p/one', B: 'p/two' })
    assert.deepStrictEqual(Object.keys(out).slice(-1), ['key'])
    assert.ok(Math.abs(out.usage.cost - 0.07) < 1e-9)
  } finally { server.close() }
})

test('one panelist failing is tolerated and reported; labels stay contiguous', async () => {
  const { server, base } = await mockServer(body => isCritic(body)
    ? reply('{"verdict":"sound","findings":[],"panelOnly":[]}')
    : body.model === 'p/bad' ? { status: 500, json: { error: 'boom' } } : reply('ok'))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/bad,p/good', '--critic', 'c/x'],
      { OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: base })
    assert.strictEqual(r.code, 0, r.err)
    const out = JSON.parse(r.out)
    assert.deepStrictEqual(out.key, { A: 'p/good' })
    assert.strictEqual(out.errors.length, 1)
    assert.match(out.errors[0], /p\/bad: HTTP 500/)
  } finally { server.close() }
})

test('critic failure exits 1 and keeps the panel answers', async () => {
  const { server, base } = await mockServer(body => isCritic(body) ? { status: 429, json: { error: 'rate' } } : reply('ok'))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/one', '--critic', 'c/x'],
      { OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: base })
    assert.strictEqual(r.code, 1)
    const out = JSON.parse(r.out)
    assert.match(out.error, /critic failed: c\/x: HTTP 429/)
    assert.strictEqual(out.panel.length, 1)
  } finally { server.close() }
})

test('every panelist failing exits 1 without calling the critic', async () => {
  const { server, seen, base } = await mockServer(() => ({ status: 500, json: {} }))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/a,p/b', '--critic', 'c/x'],
      { OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: base })
    assert.strictEqual(r.code, 1)
    assert.strictEqual(seen.filter(s => isCritic(s.body)).length, 0)
  } finally { server.close() }
})

test('missing key exits 2 and names the fix; dry run needs no key and sends nothing', async () => {
  const { q, d } = tmpFiles()
  const noKey = await runScript(['--question', q, '--draft', d], {})
  assert.strictEqual(noKey.code, 2)
  assert.match(noKey.err, /OPENROUTER_API_KEY is not set/)

  const dry = await runScript(['--question', q, '--draft', d, '--dry-run'], { OPENROUTER_BASE_URL: 'http://127.0.0.1:9' })
  assert.strictEqual(dry.code, 0, dry.err)
  const out = JSON.parse(dry.out)
  assert.strictEqual(out.requests.length, 4, 'three default panelists plus the critic')
})

test('parseArgs rejects missing files and unknown flags', () => {
  assert.throws(() => parseArgs(['--draft', 'd']), /--question and --draft/)
  assert.throws(() => parseArgs(['--question', 'q', '--draft', 'd', '--bogus']), /unknown argument/)
  assert.deepStrictEqual(parseArgs(['--question', 'q', '--draft', 'd', '--panel', 'a/b, c/d']).panel, ['a/b', 'c/d'])
  assert.throws(() => parseArgs(['--question', 'q', '--draft', 'd', '--critic', '--dry-run']), /--critic needs a value/)
  assert.throws(() => parseArgs(['--question', 'q', '--draft', 'd', '--panel', 'a/b,c/d', '--critic', 'c/d']), /also on the panel/)
})

test('parseCritique takes fenced JSON and keeps raw text it cannot parse', () => {
  assert.strictEqual(parseCritique('```json\n{"verdict":"sound","findings":[]}\n```').verdict, 'sound')
  const bad = parseCritique('no json here')
  assert.strictEqual(bad.verdict, 'unparsed')
  assert.strictEqual(bad.raw, 'no json here')
})

test('an unreadable input file is a usage error (exit 2), not a retryable failure', async () => {
  const { d } = tmpFiles()
  const r = await runScript(['--question', path.join(os.tmpdir(), 'red-team-missing.md'), '--draft', d, '--dry-run'], {})
  assert.strictEqual(r.code, 2)
  assert.match(r.err, /cannot read input/)
})

test('a network or non-JSON failure still names the panelist', async () => {
  const { server, base } = await mockServer(body => isCritic(body)
    ? reply('{"verdict":"sound","findings":[]}')
    : { status: 200, json: 'not an object' })
  try {
    const { q, d } = tmpFiles()
    const offline = await runScript(['--question', q, '--draft', d, '--panel', 'p/one', '--critic', 'c/x'],
      { OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: 'http://127.0.0.1:9' })
    assert.strictEqual(offline.code, 1)
    assert.match(JSON.parse(offline.out).errors[0], /^p\/one: /)
    const empty = await runScript(['--question', q, '--draft', d, '--panel', 'p/two', '--critic', 'c/x'],
      { OPENROUTER_API_KEY: 'k', OPENROUTER_BASE_URL: base })
    assert.match(JSON.parse(empty.out).errors[0], /^p\/two: /)
  } finally { server.close() }
})

test('JSON without a findings array is unparsed, never a clean pass', () => {
  assert.strictEqual(parseCritique('42').verdict, 'unparsed')
  assert.strictEqual(parseCritique('{"verdict":"sound"}').verdict, 'unparsed')
  assert.strictEqual(parseCritique('{"verdict":"sound"}').raw, '{"verdict":"sound"}')
})

test('UTF-16LE input with a BOM (PowerShell 5.1 redirect) reads as text', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'red-team-')), 'q.md')
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Is it safe?', 'utf16le')]))
  assert.strictEqual(readText(file), 'Is it safe?')
  fs.writeFileSync(file, '﻿plain')
  assert.strictEqual(readText(file), 'plain')
})

test('the default critic sits outside the default panel', () => {
  assert.ok(!DEFAULT_PANEL.includes(DEFAULT_CRITIC))
})

test('every call caps max_tokens; --max-tokens overrides and rejects a non-integer', async () => {
  const { server, seen, base } = await mockServer(body => isCritic(body)
    ? reply(JSON.stringify({ verdict: 'sound', findings: [], panelOnly: [] }))
    : reply('ok'))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/one', '--critic', 'c/critic', '--max-tokens', '900'],
      { OPENROUTER_API_KEY: 'test-key', OPENROUTER_BASE_URL: base })
    assert.strictEqual(r.code, 0, r.err)
    assert.deepStrictEqual(seen.map(s => s.body.max_tokens), [900, 900])
  } finally { server.close() }
  assert.strictEqual(parseArgs(['--question', 'q', '--draft', 'd']).maxTokens, 16000)
  assert.throws(() => parseArgs(['--question', 'q', '--draft', 'd', '--max-tokens', '1.5']), /positive integer/)
})

test('behind HTTPS_PROXY no key is needed and no Authorization header is sent (the proxy injects it)', async () => {
  const { server, seen, base } = await mockServer(body => isCritic(body)
    ? reply(JSON.stringify({ verdict: 'sound', findings: [], panelOnly: [] }))
    : reply('ok'))
  try {
    const { q, d } = tmpFiles()
    const r = await runScript(['--question', q, '--draft', d, '--panel', 'p/one', '--critic', 'c/critic'],
      { OPENROUTER_BASE_URL: base, HTTPS_PROXY: 'http://127.0.0.1:9', NO_PROXY: '127.0.0.1' })
    assert.strictEqual(r.code, 0, r.err)
    assert.strictEqual(seen.length, 2)
    assert.ok(seen.every(s => s.auth === undefined))
  } finally { server.close() }
})
