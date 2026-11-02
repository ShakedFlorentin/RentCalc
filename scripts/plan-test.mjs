// Regression harness for the trip planner's engine (supabase/functions/plan-trip/plan.ts).
// Bundles plan.ts with esbuild, runs each scripts/plan-fixtures/*.json through plan(days, units, fixed) the way
// index.ts does, and checks the engine's rules plus the fixture's own `expect`. `node scripts/plan-test.mjs [name…]`.
import { build } from 'esbuild'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'scripts/plan-fixtures')
const bundle = await build({
  entryPoints: [join(root, 'supabase/functions/plan-trip/plan.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18',
})
const PB = await build({
  entryPoints: [join(root, 'supabase/functions/plan-trip/presence.ts')],
  bundle: true, write: false, format: 'esm', platform: 'node', target: 'node18',
})
const P = await import('data:text/javascript;base64,' + Buffer.from(PB.outputFiles[0].text).toString('base64'))
const E = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

// a fixture's days carry `at` as an object (as the dry run's `input` does); the engine wants a Map
// a fixture with `presence` (stays, flights, day_info.who) gets its days from presence.ts, the way index.ts builds them
const load = (f) => {
  if (f.presence) {
    const x = f.presence
    const dateOf = (d) => new Date(Date.parse(x.startDate + 'T00:00:00Z') + (d - 1) * 86400000).toISOString().slice(0, 10)
    const days = P.buildDays({
      numDays: x.numDays, dateOf, sleeps: x.sleeps, couples: x.couples, flights: x.flights ?? [],
      dayWho: new Map(Object.entries(x.dayWho ?? {}).map(([d, w]) => [Number(d), w])),
      capOf: new Map(Object.entries(x.capOf ?? {})), past: () => false,
    })
    return { ...f, days }
  }
  return { ...f, days: f.days.map((d) => ({ ...d, at: new Map(Object.entries(d.at)) })) }
}
const NEAR_KM = 30 // mirrors plan.ts
const rules = (f, out) => {
  const errs = []
  const byId = new Map(f.units.map((u) => [u.id, u]))
  const dayOf = new Map(f.days.map((d) => [d.day, d]))
  for (const [id, p] of out.placed) {
    const u = byId.get(id)
    const d = dayOf.get(p.day)
    if (!u) { errs.push(`${id}: placed but not a unit`); continue }
    if (!d) { errs.push(`${id}: on day ${p.day}, which does not exist`); continue }
    for (const c of u.couples) {
      const pr = d.at.get(c)
      if (!pr) { errs.push(`${id}: on day ${p.day} but ${c} is not present`); continue }
      const near = u.point && E.km(pr.hotel, u.point) <= (u.far ? 150 : NEAR_KM)
      if (!u.far && pr.base !== u.base && !near) errs.push(`${id}: on day ${p.day}, ${c} is in ${pr.base}, place is ${u.base}`)
      if (u.far && !near) errs.push(`${id}: day trip on day ${p.day} too far from ${c}'s hotel`)
    }
    if (u.closedWeekdays.includes(d.weekday)) errs.push(`${id}: on day ${p.day}, closed that weekday (${d.weekday})`)
    if (u.closedDates.includes(d.date)) errs.push(`${id}: on day ${p.day}, closed ${d.date}`)
    if (u.openDates.length && !u.openDates.includes(d.date)) errs.push(`${id}: on day ${p.day}, runs only ${u.openDates.join(',')}`)
  }
  for (const id of out.placed.keys()) if (out.unplanned.has(id)) errs.push(`${id}: both placed and unplanned`)
  // never silently: a place outside the city its couples sleep in that day (and not a day trip) is in out.away, with its city,
  // and nothing else is
  for (const [id, p] of out.placed) {
    const u = byId.get(id)
    const d = dayOf.get(p.day)
    const isAway = !u.far && u.couples.some((c) => d.at.get(c) && d.at.get(c).base !== u.base)
    if (isAway && out.away.get(id) !== u.base) errs.push(`${id}: away on day ${p.day} but labelled ${out.away.get(id) ?? 'nothing'}, expected ${u.base}`)
    if (!isAway && out.away.has(id)) errs.push(`${id}: labelled away but sits in its own city on day ${p.day}`)
  }
  for (const id of out.away.keys()) if (!out.placed.has(id)) errs.push(`${id}: labelled away but not placed`)
  // own city first: a place left out for lack of room must not have a day (in its own city) that holds another city's place
  for (const [id, why] of out.unplanned) {
    const u = byId.get(id)
    if (why !== 'full' || u.far) continue
    for (const d of f.days) {
      if (!u.couples.every((c) => d.at.get(c)?.base === u.base)) continue
      const taker = [...out.placed].find(([o, p]) => p.day === d.day && out.away.has(o) && byId.get(o).couples.some((c) => u.couples.includes(c)))
      if (taker) errs.push(`${id}: left out ('full') although day ${d.day}, in its city, holds ${taker[0]} from ${out.away.get(taker[0])}`)
    }
  }
  return errs
}

const expectations = (f, out, run) => {
  const x = f.expect ?? {}
  const errs = []
  const dayOfId = (id) => out.placed.get(id)?.day
  for (const k of x.noIssueKinds ?? []) for (const i of out.issues) if (i.kind === k) errs.push(`issue ${k}: ${i.id}`)
  for (const d of x.emptyDays ?? []) for (const [id, p] of out.placed) if (p.day === d) errs.push(`${id}: placed on day ${d}, expected none`)
  for (const [id, days] of Object.entries(x.onlyDays ?? {})) {
    const d = dayOfId(id)
    if (d != null && !days.includes(d)) errs.push(`${id}: on day ${d}, allowed ${days.join(',')}`)
    if (d == null && x.requirePlaced) errs.push(`${id}: not placed`)
  }
  for (const [id, why] of Object.entries(x.unplanned ?? {})) {
    if (out.placed.has(id)) errs.push(`${id}: placed, expected unplanned (${why})`)
    else if (out.unplanned.get(id) !== why) errs.push(`${id}: unplanned as ${out.unplanned.get(id)}, expected ${why}`)
  }
  // away: id → the city it is labelled with, for the places a fixture expects to be reported
  for (const [id, city] of Object.entries(x.away ?? {})) {
    if (out.away.get(id) !== city) errs.push(`${id}: away label ${out.away.get(id) ?? 'none'}, expected ${city}`)
  }
  // noAwayOnDays: days that must hold only places of their own city
  for (const d of x.noAwayOnDays ?? []) for (const [id, p] of out.placed) if (p.day === d && out.away.has(id)) errs.push(`${id}: away (${out.away.get(id)}) on day ${d}, expected none`)
  if (x.awayMin != null && out.away.size < x.awayMin) errs.push(`only ${out.away.size} away, expected at least ${x.awayMin}`)
  if (x.placedMin != null && out.placed.size < x.placedMin) errs.push(`only ${out.placed.size} placed, expected at least ${x.placedMin}`)
  if (x.fillBefore) {
    const { days, first, then } = x.fillBefore
    const firstIn = first.filter((id) => days.includes(dayOfId(id)))
    for (const id of first) if (!days.includes(dayOfId(id))) errs.push(`${id}: expected on days ${days.join(',')}, is ${dayOfId(id) ?? 'unplanned'}`)
    if (firstIn.length < first.length)
      for (const id of then) if (days.includes(dayOfId(id))) errs.push(`${id}: on day ${dayOfId(id)} before the places for that base were placed`)
  }
  // presence: per day and couple, where they sleep (null = not there), the hours and whether the times are estimates
  for (const [day, byCouple] of Object.entries(x.presence ?? {})) {
    for (const [c, want] of Object.entries(byCouple)) {
      const got = run.days.find((d) => d.day === Number(day))?.at.get(c)
      if (want === null) { if (got) errs.push(`day ${day}: ${c} present, expected not`); continue }
      if (!got) { errs.push(`day ${day}: ${c} missing`); continue }
      if (want.base && got.base !== want.base) errs.push(`day ${day}: ${c} in ${got.base}, expected ${want.base}`)
      if (want.start != null && got.start !== want.start) errs.push(`day ${day}: ${c} starts ${got.start}, expected ${want.start}`)
      if (want.end != null && got.end !== want.end) errs.push(`day ${day}: ${c} ends ${got.end}, expected ${want.end}`)
      if (!!got.estimate !== !!want.estimate) errs.push(`day ${day}: ${c} estimate ${!!got.estimate}, expected ${!!want.estimate}`)
    }
  }
  if (x.estimateDays) {
    const got = run.days.filter((d) => [...d.at.values()].some((p) => p.estimate)).map((d) => d.day)
    if (got.join() !== x.estimateDays.join()) errs.push(`estimate days ${got.join(',') || '-'}, expected ${x.estimateDays.join(',') || '-'}`)
  }
  if (x.stable) {
    // second run: each unit's current is the day the first run gave it (index.ts: autoByPlace)
    const again = E.plan(run.days, f.units.map((u) => ({ ...u, current: out.placed.get(u.id)?.day ?? null })), f.fixed)
    for (const u of f.units) {
      const a = out.placed.get(u.id)?.day ?? null
      const b = again.placed.get(u.id)?.day ?? null
      if (a !== b) errs.push(`${u.id}: moved from day ${a ?? '-'} to ${b ?? '-'} on re-run`)
    }
  }
  return errs
}

const only = process.argv.slice(2)
const files = readdirSync(dir).filter((n) => n.endsWith('.json') && (!only.length || only.includes(n.replace(/\.json$/, '')))).sort()
let failed = 0
for (const file of files) {
  const f = JSON.parse(readFileSync(join(dir, file), 'utf8'))
  const run = load(f)
  let errs
  let out
  try {
    out = E.plan(run.days, run.units, run.fixed)
    errs = [...rules(run, out), ...expectations(f, out, run)]
  } catch (e) {
    errs = ['threw: ' + (e.stack ?? e)]
  }
  const known = f.knownFailing === true
  const status = !errs.length ? (known ? 'PASS (known failing, now passes: drop the flag)' : 'PASS') : known ? 'FAIL (known)' : 'FAIL'
  if (errs.length && !known) failed++
  console.log(`${status}  ${f.name ?? file}${out ? `  [${out.placed.size}/${f.units.length} placed]` : ''}`)
  for (const e of errs) console.log('   - ' + e)
  if (out && process.env.VERBOSE) {
    for (const [id, p] of [...out.placed].sort((a, b) => a[1].day - b[1].day || a[1].start - b[1].start)) console.log(`     day ${p.day} ${E.hhmm(p.start)} ${id}`)
    for (const [id, r] of out.unplanned) console.log(`     unplanned ${id}: ${r}`)
    for (const [id, c] of out.away) console.log(`     away ${id}: in ${c}`)
  }
}
console.log(failed ? `\n${failed} fixture(s) failed` : '\nok')
process.exit(failed ? 1 : 0)
