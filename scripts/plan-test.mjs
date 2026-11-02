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
const E = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'))

// a fixture's days carry `at` as an object (as the dry run's `input` does); the engine wants a Map
const load = (f) => ({ ...f, days: f.days.map((d) => ({ ...d, at: new Map(Object.entries(d.at)) })) })
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
  if (x.placedMin != null && out.placed.size < x.placedMin) errs.push(`only ${out.placed.size} placed, expected at least ${x.placedMin}`)
  if (x.fillBefore) {
    const { days, first, then } = x.fillBefore
    const firstIn = first.filter((id) => days.includes(dayOfId(id)))
    for (const id of first) if (!days.includes(dayOfId(id))) errs.push(`${id}: expected on days ${days.join(',')}, is ${dayOfId(id) ?? 'unplanned'}`)
    if (firstIn.length < first.length)
      for (const id of then) if (days.includes(dayOfId(id))) errs.push(`${id}: on day ${dayOfId(id)} before the places for that base were placed`)
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
  }
}
console.log(failed ? `\n${failed} fixture(s) failed` : '\nok')
process.exit(failed ? 1 : 0)
