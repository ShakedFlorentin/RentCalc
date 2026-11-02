// node scripts/rank-test.mjs: checks the pure ranking helpers in src/rank.ts (bundled on the fly with esbuild).
import { build } from 'esbuild'
import assert from 'node:assert/strict'

const out = await build({ entryPoints: ['src/rank.ts'], bundle: true, write: false, format: 'esm', platform: 'node' })
const R = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

// Bayesian mean: (5*3.5 + 15) / (5 + 3) = 4.0625, not a plain 5.0
assert.ok(Math.abs(R.smoothedStars([5, 5, 5]) - 4.0625) < 1e-9)
assert.equal(R.smoothedStars([], 4), 4)
assert.ok(R.smoothedStars([5, 5, 5], 4.5) > R.smoothedStars([5, 5, 5], 3))
assert.equal(R.categoryMeans([{ category: 'food', stars: [5, 3] }, { category: 'food', stars: [4] }]).get('food'), 4)

const cats = ['food', 'sight', 'cafe', 'shopping']
const cards = Array.from({ length: 60 }, (_, i) => ({
  id: 'c' + i,
  category: i < 30 ? 'food' : cats[i % 4], // a long block of food that all scores well
  tags: ['t' + (i % 7)],
  verdict: i % 11 === 0 ? 'gem' : null,
  photos: i % 2 ? ['x'] : [],
}))
const ctx = {
  fit: (c) => (c.category === 'food' ? 3 : 0),
  othersLiked: () => 0,
  swipeCount: (c) => (Number(c.id.slice(1)) % 3 === 0 ? 0 : 5),
  stars: () => [],
  categoryMean: () => undefined,
  hash: (c) => [...c.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 0),
}
const deck = R.rankDeck(cards, ctx)
assert.equal(deck.length, 20)
assert.equal(new Set(deck.map((c) => c.id)).size, 20)
for (let i = 3; i < deck.length; i++) {
  const last4 = deck.slice(i - 3, i + 1).map((c) => c.category)
  assert.ok(!last4.every((x) => x === last4[0]), 'no 4 of one category in a row')
}
const fresh = deck.filter((c, i) => (i + 1) % 5 === 0 && (ctx.swipeCount(c) <= 1 || c.verdict === 'gem'))
assert.equal(fresh.length, 4, 'every fifth slot is a new or gem card')
assert.deepEqual(R.rankDeck(cards, ctx).map((c) => c.id), deck.map((c) => c.id), 'deterministic')
// a run that came before the batch counts
assert.notEqual(R.rankDeck(cards, { ...ctx, recent: ['food', 'food', 'food'], size: 3 })[0].category, 'food')

// live learning: likes lift a tag, a no on a sight hurts it, a no on a restaurant barely does
let w = R.learnTags(new Map(), { id: 'a', category: 'sight', tags: ['Temple'] }, true)
assert.equal(w.get('temple'), 1)
w = R.learnTags(w, { id: 'b', category: 'sight', tags: ['temple'] }, false)
assert.ok(Math.abs(w.get('temple') - 0.4) < 1e-9)
const eat = R.learnTags(new Map(), { id: 'c', category: 'food', tags: ['ramen'] }, false)
assert.equal(eat.get('ramen'), -0.1)
console.log('rank-test: ok')
