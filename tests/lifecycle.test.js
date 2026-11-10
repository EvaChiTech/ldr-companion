import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createScope, safeHttpUrl } from '../lifecycle.js'

/** Minimal EventTarget stand-in that records what is still attached. */
function fakeTarget() {
  const t = new EventTarget()
  let live = 0
  const origAdd = t.addEventListener.bind(t)
  t.addEventListener = (type, fn, opts) => {
    live++
    opts?.signal?.addEventListener('abort', () => { live-- }, { once: true })
    origAdd(type, fn, opts)
  }
  Object.defineProperty(t, 'liveCount', { get: () => live })
  return t
}

// ── listeners ───────────────────────────────────────────────

test('scope.on attaches a working listener', () => {
  const scope = createScope()
  const el = new EventTarget()
  let hits = 0
  scope.on(el, 'ping', () => hits++)
  el.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1)
})

test('destroy removes listeners so later events are ignored', () => {
  const scope = createScope()
  const el = new EventTarget()
  let hits = 0
  scope.on(el, 'ping', () => hits++)
  el.dispatchEvent(new Event('ping'))
  scope.destroy()
  el.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1, 'handler fired after destroy')
})

test('re-init after destroy does NOT stack handlers', () => {
  // This is the exact defect the scope exists to prevent: init/teardown/init
  // against the same static DOM used to double every handler.
  const scope = createScope()
  const el = new EventTarget()
  let hits = 0
  const handler = () => hits++

  for (let i = 0; i < 4; i++) {
    scope.on(el, 'ping', handler)
    scope.destroy()
  }
  scope.on(el, 'ping', handler)

  el.dispatchEvent(new Event('ping'))
  assert.equal(hits, 1, `handler fired ${hits}x — listeners stacked`)
})

test('the abort signal really detaches, not just guards', () => {
  const scope = createScope()
  const t = fakeTarget()
  scope.on(t, 'a', () => {})
  scope.on(t, 'b', () => {})
  assert.equal(t.liveCount, 2)
  scope.destroy()
  assert.equal(t.liveCount, 0)
})

test('scope.on tolerates a null target', () => {
  const scope = createScope()
  assert.doesNotThrow(() => {
    scope.on(null, 'click', () => {})
    scope.on(undefined, 'click', () => {})
    scope.on({}, 'click', () => {})
  })
})

test('a fresh signal is issued after destroy', () => {
  const scope = createScope()
  const first = scope.signal
  scope.destroy()
  assert.ok(first.aborted)
  assert.equal(scope.signal.aborted, false, 'scope unusable after destroy')
})

// ── timers ──────────────────────────────────────────────────

test('destroy clears pending intervals', async () => {
  const scope = createScope()
  let ticks = 0
  scope.interval(() => ticks++, 5)
  await new Promise(r => setTimeout(r, 30))
  const atDestroy = ticks
  scope.destroy()
  await new Promise(r => setTimeout(r, 30))
  assert.equal(ticks, atDestroy, 'interval kept running after destroy')
  assert.ok(atDestroy > 0, 'interval never ran')
})

test('destroy clears pending timeouts', async () => {
  const scope = createScope()
  let fired = false
  scope.timeout(() => { fired = true }, 20)
  scope.destroy()
  await new Promise(r => setTimeout(r, 50))
  assert.equal(fired, false)
})

test('scope.clear cancels one timer without touching the rest', async () => {
  const scope = createScope()
  let a = 0, b = 0
  const idA = scope.interval(() => a++, 5)
  scope.interval(() => b++, 5)
  await new Promise(r => setTimeout(r, 30))
  scope.clear(idA)
  const aAt = a
  await new Promise(r => setTimeout(r, 30))
  assert.equal(a, aAt, 'cleared interval still ran')
  assert.ok(b > aAt - 1, 'the other interval was wrongly cleared')
  scope.destroy()
})

test('scope.clear ignores a null id', () => {
  const scope = createScope()
  assert.doesNotThrow(() => scope.clear(null))
})

// ── safeHttpUrl ─────────────────────────────────────────────

test('http and https pass', () => {
  assert.equal(safeHttpUrl('https://example.com/a'), 'https://example.com/a')
  assert.ok(safeHttpUrl('http://example.com'))
})

test('hostile schemes are rejected', () => {
  // esc() would have left every one of these intact inside an href.
  for (const bad of [
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'file:///etc/passwd',
  ]) {
    assert.equal(safeHttpUrl(bad), null, `accepted ${bad}`)
  }
})

test('malformed input is rejected rather than thrown', () => {
  for (const bad of ['', 'not a url', null, undefined, {}, 42]) {
    assert.equal(safeHttpUrl(bad), null)
  }
})

test('the host allowlist accepts the domain and its subdomains', () => {
  const hosts = ['wikipedia.org']
  assert.ok(safeHttpUrl('https://en.wikipedia.org/wiki/Kyoto', { hosts }))
  assert.ok(safeHttpUrl('https://wikipedia.org/x', { hosts }))
})

test('the host allowlist rejects lookalike domains', () => {
  const hosts = ['wikipedia.org']
  assert.equal(safeHttpUrl('https://evil.com/x', { hosts }), null)
  // Must not match by suffix alone.
  assert.equal(safeHttpUrl('https://notwikipedia.org/x', { hosts }), null)
  assert.equal(safeHttpUrl('https://wikipedia.org.evil.com/x', { hosts }), null)
})

test('an empty or absent allowlist means any http(s) host', () => {
  assert.ok(safeHttpUrl('https://anywhere.test/x'))
  assert.ok(safeHttpUrl('https://anywhere.test/x', { hosts: [] }))
})
