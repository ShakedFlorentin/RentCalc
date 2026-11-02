// Tests for the night-split suggester (supabase/functions/plan-trip/split.ts): `node scripts/split-test.mjs`.
import { build } from 'esbuild'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = await build({
  entryPoints: [join(root, 'supabase/functions/plan-trip/split.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18',
})
const S = await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))

let bad = 0
const ok = (cond, msg) => { if (!cond) { bad++; console.log('  FAIL ' + msg) } }
const DAY = 86400000
const add = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)
const START = '2026-11-10'

const cities = [
  { id: 'tokyo', lat: 35.681, lng: 139.767 },
  { id: 'yokohama', lat: 35.444, lng: 139.638 },
  { id: 'kyoto', lat: 35.003, lng: 135.759 },
  { id: 'osaka', lat: 34.686, lng: 135.502 },
  { id: 'nara', lat: 34.685, lng: 135.805 },
]
// n places of `mins` each in a city
const places = (city, n, mins, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: `${city}${i}`, city, mins, ...extra }))
const base = (o) => ({ startDate: START, numDays: 10, parties: [], stays: [], cities, places: [], ...o })
const dates = (r) => Array.from({ length: r.nights }, (_, i) => add(r.checkIn, i))
const show = (alts) => alts.map((a) => a.reason.kind + ': ' + a.rows.map((r) => `${r.city}${r.party ? '(' + r.party + ')' : ''}x${r.nights}`).join(' > ') + ` [moves ${a.reason.moves}, ${a.reason.coveredPlaces}/${a.reason.totalPlaces}` + (a.reason.dayTrips.length ? ', day trips ' + JSON.stringify(a.reason.dayTrips) : '') + ']').join('\n    ')

const cases = {
  'no hotels: every night gets one city, 2-3 distinct alternatives'() {
    const alts = S.suggestSplit(base({ places: [...places('tokyo', 8, 180), ...places('kyoto', 6, 180), ...places('osaka', 3, 120)] }))
    console.log('    ' + show(alts))
    ok(alts.length >= 2 && alts.length <= 3, `expected 2-3 alternatives, got ${alts.length}`)
    const sigs = new Set(alts.map((a) => a.rows.map((r) => r.city + r.nights).join()))
    ok(sigs.size === alts.length, 'alternatives are not distinct')
    for (const a of alts) {
      const all = a.rows.flatMap(dates).sort()
      ok(all.length === 9 && all.every((d, i) => d === add(START, i)), `${a.reason.kind}: nights not 9 consecutive: ${all}`)
      ok(a.rows.every((r) => r.party === null), 'party should be null for everyone')
    }
    const c = (k) => alts.find((a) => a.reason.kind === k)
    if (c('fewer_moves') && c('more_places')) ok(c('fewer_moves').reason.moves <= c('more_places').reason.moves, 'fewer_moves has more moves than more_places')
    const best = alts[0]
    ok(best.rows.some((r) => r.city === 'tokyo') && best.rows.some((r) => r.city === 'kyoto'), 'balanced should sleep in both tokyo and kyoto')
    ok(best.rows.length <= 3, 'balanced goes back and forth: ' + best.rows.map((r) => r.city))
  },

  'one city locked: its nights are never touched'() {
    const stays = [{ party: null, city: 'kyoto', checkIn: add(START, 4), checkOut: add(START, 7), status: 'confirmed', locked: true, source: 'booking' }]
    const alts = S.suggestSplit(base({ stays, places: [...places('tokyo', 8, 180), ...places('kyoto', 3, 180), ...places('osaka', 3, 120)] }))
    console.log('    ' + show(alts))
    ok(alts.length >= 1, 'no alternatives')
    const locked = new Set([4, 5, 6].map((n) => add(START, n)))
    for (const a of alts) {
      const all = a.rows.flatMap(dates)
      ok(!all.some((d) => locked.has(d)), `${a.reason.kind} writes over the locked nights`)
      ok(all.length === 6 && new Set(all).size === 6, `${a.reason.kind}: expected the 6 open nights, got ${all.length}`)
    }
    // a confirmed (not locked) stay is also safe; an earlier planner proposal is replaced
    const stays2 = [
      { party: null, city: 'tokyo', checkIn: add(START, 0), checkOut: add(START, 2), status: 'confirmed', locked: false, source: 'manual' },
      { party: null, city: 'osaka', checkIn: add(START, 2), checkOut: add(START, 9), status: 'proposed', locked: false, source: 'auto' },
    ]
    const a2 = S.suggestSplit(base({ stays: stays2, places: places('tokyo', 4, 180) }))
    const all2 = a2.flatMap((a) => a.rows.flatMap(dates))
    ok(!all2.includes(add(START, 0)) && !all2.includes(add(START, 1)), 'wrote over a confirmed stay')
    ok(a2[0].rows.reduce((s, r) => s + r.nights, 0) === 7, 'old auto proposal should be open again')
  },

  'two parties with different dates: each covered exactly on its own nights'() {
    const parties = [
      { id: 'A', arrival: 'tokyo', departure: 'osaka' },
      { id: 'B', from: add(START, 3), to: add(START, 8), arrival: 'tokyo' },
    ]
    const stays = [{ party: 'B', city: 'kyoto', checkIn: add(START, 5), checkOut: add(START, 8), status: 'confirmed', locked: true, source: 'booking' }]
    const alts = S.suggestSplit(base({ parties, stays, places: [...places('tokyo', 6, 180), ...places('kyoto', 4, 180, { parties: ['A'] }), ...places('osaka', 3, 120)] }))
    console.log('    ' + show(alts))
    ok(alts.length >= 1, 'no alternatives')
    for (const a of alts) {
      const cover = (id, from, to) => {
        const got = a.rows.filter((r) => r.party === null || r.party === id).flatMap(dates)
        const lock = id === 'B' ? [5, 6, 7].map((n) => add(START, n)) : []
        const want = []
        for (let d = from; d < to; d = add(d, 1)) if (!lock.includes(d)) want.push(d)
        ok(got.slice().sort().join() === want.join(), `${a.reason.kind}: party ${id} nights ${got.sort()} != ${want}`)
      }
      cover('A', START, add(START, 9))
      cover('B', add(START, 3), add(START, 8))
      ok(!a.rows.some((r) => r.party === 'B' && dates(r).some((d) => ['2026-11-15', '2026-11-16', '2026-11-17'].includes(d))), 'wrote over B locked nights')
      ok(a.rows.some((r) => r.party !== null), `${a.reason.kind}: expected rows for single parties in the stretch they are apart`)
    }
  },

  'a city better as a day trip: Yokohama with two places does not get nights; with many it does'() {
    const few = S.suggestSplit(base({ places: [...places('tokyo', 10, 180), ...places('yokohama', 2, 90)] }))
    console.log('    ' + show(few))
    ok(few[0].rows.length === 1 && few[0].rows[0].city === 'tokyo' && few[0].rows[0].nights === 9, 'balanced should be 9 nights in Tokyo')
    ok(few[0].reason.dayTrips.some((d) => d.city === 'yokohama' && d.from === 'tokyo' && d.places === 2), 'Yokohama should be a day trip from Tokyo')
    const many = S.suggestSplit(base({ places: [...places('tokyo', 4, 180), ...places('yokohama', 12, 180)] }))
    console.log('    ' + show(many))
    ok(many.some((a) => a.rows.some((r) => r.city === 'yokohama' && r.nights >= 2)), 'Yokohama with a lot to do should get nights')
  },

  'flights: a party stretch and the airports'() {
    const r = S.partyStretch(
      [
        { who: null, title: 'TLV → HND', starts_at: '2026-11-09T20:00', ends_at: '2026-11-11T08:00' },
        { who: null, title: 'KIX → TLV', starts_at: '2026-11-18T11:00', ends_at: '2026-11-18T20:00' },
      ],
      'A', START, 10,
    )
    ok(r.from === '2026-11-11' && r.arrival === 'tokyo' && r.to === '2026-11-18' && r.departure === 'osaka', 'stretch: ' + JSON.stringify(r))
  },

  'nothing to plan: no open nights, no cities'() {
    const stays = [{ party: null, city: 'tokyo', checkIn: START, checkOut: add(START, 9), status: 'confirmed', locked: true }]
    ok(S.suggestSplit(base({ stays })).length === 0, 'no open nights should give no alternatives')
    ok(S.suggestSplit(base({ cities: [] })).length === 0, 'no cities should give none')
  },
}

const only = process.argv.slice(2)
for (const [name, fn] of Object.entries(cases)) {
  if (only.length && !only.some((o) => name.includes(o))) continue
  const before = bad
  console.log(name)
  const t0 = Date.now()
  try { fn() } catch (e) { bad++; console.log('  ERROR ' + (e.stack || e)) }
  console.log(`  ${bad === before ? 'ok' : 'FAILED'} (${Date.now() - t0} ms)`)
}
if (bad) { console.log(`\n${bad} failure(s)`); process.exit(1) }
console.log('\nall good')
