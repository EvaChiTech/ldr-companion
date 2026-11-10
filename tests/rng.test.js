import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mulberry32, shuffleInPlace } from '../rng.js'

test('same seed yields the same sequence', () => {
  const a = mulberry32(12345)
  const b = mulberry32(12345)
  for (let i = 0; i < 200; i++) assert.equal(a(), b())
})

test('different seeds diverge', () => {
  const a = mulberry32(1), b = mulberry32(2)
  const sa = Array.from({ length: 20 }, a)
  const sb = Array.from({ length: 20 }, b)
  assert.notDeepEqual(sa, sb)
})

test('output stays in [0, 1)', () => {
  const r = mulberry32(99)
  for (let i = 0; i < 5000; i++) {
    const v = r()
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`)
  }
})

test('seed is coerced to uint32, so negatives and floats are stable', () => {
  assert.equal(mulberry32(-1)(), mulberry32(0xFFFFFFFF)())
  // Non-integers truncate via >>>0 rather than producing a distinct stream.
  assert.equal(mulberry32(7.9)(), mulberry32(7)())
})

test('distribution is not visibly skewed across quartiles', () => {
  const r = mulberry32(2024)
  const buckets = [0, 0, 0, 0]
  const N = 40000
  for (let i = 0; i < N; i++) buckets[Math.floor(r() * 4)]++
  // A fair generator gives N/4 each; allow a generous 10% band.
  for (const b of buckets) {
    assert.ok(Math.abs(b - N / 4) < N / 40, `skewed buckets: ${buckets}`)
  }
})

test('shuffleInPlace is a permutation, not a loss of data', () => {
  const src = Array.from({ length: 50 }, (_, i) => i)
  const out = shuffleInPlace([...src], mulberry32(5))
  assert.equal(out.length, src.length)
  assert.deepEqual([...out].sort((x, y) => x - y), src)
})

test('shuffleInPlace is reproducible from its generator', () => {
  const a = shuffleInPlace(Array.from({ length: 30 }, (_, i) => i), mulberry32(42))
  const b = shuffleInPlace(Array.from({ length: 30 }, (_, i) => i), mulberry32(42))
  assert.deepEqual(a, b)
})

test('shuffleInPlace actually reorders', () => {
  const src = Array.from({ length: 40 }, (_, i) => i)
  const out = shuffleInPlace([...src], mulberry32(8))
  assert.notDeepEqual(out, src)
})

test('shuffleInPlace handles empty and single-element arrays', () => {
  assert.deepEqual(shuffleInPlace([], mulberry32(1)), [])
  assert.deepEqual(shuffleInPlace([7], mulberry32(1)), [7])
})
