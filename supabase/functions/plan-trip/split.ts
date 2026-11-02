// Suggests how to split the open nights of a trip between cities. Plain code, no AI, no network: the same input
// always gives the same answer, and it is tested outside the edge runtime (scripts/split-test.mjs).
//
// A night is "open" for a party when no confirmed or locked stay (or a stay a person typed in) covers it. Only open
// nights get a city; the others stay as they are and still count (their city fills its places, and a move to or from
// them is a move). An alternative is a list of runs { city, nights, party }. It is scored on how many hours of the
// liked places each city can fill with the nights it got, on hotel changes, on going back to a city already left,
// on travel between cities and on starting near the arrival and ending near the departure. A city close to another
// (up to 150 km) whose places are few is better served as a day trip than with nights of its own.
import { km } from './plan.ts'

export type SplitCity = { id: string; lat: number; lng: number }
/** A party's own stretch: first night and the morning they leave (YYYY-MM-DD), and the city of arrival/departure. */
export type SplitParty = { id: string; from?: string | null; to?: string | null; arrival?: string | null; departure?: string | null }
export type SplitStay = { party: string | null; city: string; checkIn: string; checkOut: string; status: string; locked: boolean; source?: string | null }
export type SplitPlace = {
  id: string
  city?: string | null
  lat?: number | null
  lng?: number | null
  mins: number
  openDates?: string[]
  /** the parties that want it; empty = all */
  parties?: string[]
}
export type SplitInput = {
  startDate: string
  numDays: number
  parties: SplitParty[]
  stays: SplitStay[]
  cities: SplitCity[]
  places: SplitPlace[]
}
export type SplitRow = { city: string; nights: number; party: string | null; checkIn: string; checkOut: string }
export type SplitReason = {
  kind: 'fewer_moves' | 'more_places' | 'balanced'
  /** hotel changes in the whole stretch, locked stays included */
  moves: number
  coveredPlaces: number
  totalPlaces: number
  dayTrips: { city: string; from: string; places: number }[]
}
export type Alternative = { rows: SplitRow[]; reason: SplitReason }

const DAY = 86400000
const HOURS_PER_NIGHT = 5.5 // hours of visits a day holds
const DAYTRIP_KM = 150
const DAYTRIP_VALUE = 0.7 // a place seen on a day trip is worth less than one next to the bed
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10)

/** Minutes between two cities by train, with the way to and from the stations. */
export const travelMins = (a: SplitCity, b: SplitCity) => (a.id === b.id ? 0 : Math.round(30 + km(a, b) * 0.4))

// ---------- flights → a party's stretch

const JAPAN = /\b(HND|NRT|KIX|ITM|NGO|CTS|FUK|OKA|UKB)\b|Haneda|Narita|Kansai|Itami/i
const ROUTE = /→|->|⟶|—|–|\s-\s/
const AIRPORT_CITY: [RegExp, string][] = [
  [/\b(HND|NRT)\b|Haneda|Narita/i, 'tokyo'],
  [/\b(KIX|ITM)\b|Kansai|Itami/i, 'osaka'],
]
const cityOfAirport = (s: string) => AIRPORT_CITY.find(([re]) => re.test(s))?.[1] ?? null
export type FlightLite = { who: string | null; title: string; starts_at: string | null; ends_at: string | null }

/** From the flights of a party: the night it lands and the morning it flies out, and the airports' cities. */
export function partyStretch(flights: FlightLite[], party: string, startDate: string, numDays: number): SplitParty {
  const out: SplitParty = { id: party }
  const last = addDays(startDate, numDays - 1)
  for (const f of flights) {
    if (f.who && f.who !== party) continue
    const [from, ...to] = f.title.split(ROUTE)
    const dest = to.join(' ')
    if (JAPAN.test(dest) && f.ends_at) {
      const d = f.ends_at.slice(0, 10)
      if (d >= startDate && d < last && (!out.from || d < out.from)) {
        out.from = d
        out.arrival = cityOfAirport(dest)
      }
    } else if (JAPAN.test(from) && f.starts_at) {
      const d = f.starts_at.slice(0, 10)
      if (d > startDate && d <= last && (!out.to || d > out.to)) {
        out.to = d
        out.departure = cityOfAirport(from)
      }
    }
  }
  return out
}

// ---------- the nights

type Occ = { party: string; fixed: string | null }
type Slot = { date: string; occ: Occ[]; free: boolean; main: string | null }

function buildSlots(inp: SplitInput) {
  const ids = inp.parties.length ? inp.parties.map((p) => p.id) : ['*']
  const range = new Map(inp.parties.map((p) => [p.id, p]))
  const tripFrom = inp.startDate
  const tripTo = addDays(inp.startDate, Math.max(1, inp.numDays - 1))
  // a stay a person made is fixed; only the planner's own earlier proposals can be replaced
  const fixed = inp.stays.filter((s) => !(s.source === 'auto' && s.status === 'proposed' && !s.locked))
  const slots: Slot[] = []
  for (let d = tripFrom; d < tripTo; d = addDays(d, 1)) {
    const occ: Occ[] = []
    for (const id of ids) {
      const r = range.get(id)
      const from = r?.from && r.from > tripFrom ? r.from : tripFrom
      const to = r?.to && r.to < tripTo ? r.to : tripTo
      if (d < from || d >= to) continue
      const st = fixed.find((s) => (s.party == null || s.party === id) && s.checkIn <= d && d < s.checkOut)
      occ.push({ party: id, fixed: st ? st.city : null })
    }
    if (!occ.length) continue
    const open = occ.filter((o) => !o.fixed)
    slots.push({ date: d, occ, free: open.length > 0, main: open.length ? null : occ[0].fixed })
  }
  return { ids, slots }
}

// ---------- scoring

type Profile = { kind: SplitReason['kind']; place: number; move: number; idle: number }
const PROFILES: Profile[] = [
  { kind: 'balanced', place: 1, move: 1, idle: 0.25 },
  { kind: 'fewer_moves', place: 1, move: 2.6, idle: 0.1 },
  { kind: 'more_places', place: 1.35, move: 0.45, idle: 0.1 },
]

type Bucket = { city: string; hours: number; ids: string[]; parties: string[]; dates: Set<string> | null }

export function suggestSplit(inp: SplitInput): Alternative[] {
  const cities = new Map(inp.cities.map((c) => [c.id, c]))
  const { ids, slots } = buildSlots(inp)
  const freeIdx = slots.map((s, i) => (s.free ? i : -1)).filter((i) => i >= 0)
  if (!freeIdx.length || !cities.size) return []

  // each place belongs to the city whose middle is nearest
  const homeOf = (p: SplitPlace) => {
    if (p.lat != null && p.lng != null) {
      let best: string | null = null
      let bd = Infinity
      for (const c of cities.values()) {
        const d = km({ lat: p.lat, lng: p.lng }, c)
        if (d < bd) {
          bd = d
          best = c.id
        }
      }
      return bd <= 60 ? best : p.city && cities.has(p.city) ? p.city : null
    }
    return p.city && cities.has(p.city) ? p.city : null
  }
  const homes = inp.places.map((p) => ({ p, home: homeOf(p) })).filter((x): x is { p: SplitPlace; home: string } => !!x.home)
  const totalPlaces = homes.length
  const allIds = new Set(ids)

  // places of one city, grouped by who wants them and when they run: most are "anyone, any day" and count at once
  const bucketMap = new Map<string, Bucket>()
  for (const { p, home } of homes) {
    const parties = (p.parties ?? []).filter((x) => allIds.has(x))
    const wantsAll = !p.parties?.length || !parties.length
    const key = `${home}|${wantsAll ? '' : parties.sort().join(',')}|${(p.openDates ?? []).join(',')}`
    let b = bucketMap.get(key)
    if (!b) bucketMap.set(key, (b = { city: home, hours: 0, ids: [], parties: wantsAll ? [] : parties, dates: p.openDates?.length ? new Set(p.openDates) : null }))
    b.hours += p.mins / 60
    b.ids.push(p.id)
  }
  const buckets = [...bucketMap.values()]
  const demand = new Map<string, number>()
  for (const b of buckets) demand.set(b.city, (demand.get(b.city) ?? 0) + b.hours)

  // the cities a free night may go to: those with places (the busiest 8), those already slept in, the airports'
  const cand = new Set<string>()
  for (const [c] of [...demand].sort((a, b) => b[1] - a[1]).slice(0, 8)) cand.add(c)
  for (const s of slots) for (const o of s.occ) if (o.fixed && cities.has(o.fixed)) cand.add(o.fixed)
  for (const p of inp.parties) for (const c of [p.arrival, p.departure]) if (c && cities.has(c)) cand.add(c)
  if (!cand.size) cand.add(inp.cities[0].id)
  const candList = [...cand].sort()

  const mins = (a: string, b: string) => (a === b ? 0 : travelMins(cities.get(a)!, cities.get(b)!))
  const near = (a: string, b: string) => a !== b && km(cities.get(a)!, cities.get(b)!) <= DAYTRIP_KM

  type Eval = { score: number; moves: number; hours: number; dt: { city: string; from: string; hours: number }[] }
  const cityOf = (assign: (string | null)[], i: number, o: Occ) => o.fixed ?? assign[i]!

  function evaluate(assign: (string | null)[], prof: Profile, detail = false): Eval {
    // nights per city, and for the picky places when each party is where
    const nights = new Map<string, number>()
    const where = new Map<string, { date: string; party: string }[]>()
    for (let i = 0; i < slots.length; i++) {
      const seen = new Set<string>()
      for (const o of slots[i].occ) {
        const c = cityOf(assign, i, o)
        seen.add(c)
        if (buckets.length) {
          let w = where.get(c)
          if (!w) where.set(c, (w = []))
          w.push({ date: slots[i].date, party: o.party })
        }
      }
      for (const c of seen) nights.set(c, (nights.get(c) ?? 0) + 1)
    }
    // hours of places each city can show with its nights
    const reach = new Map<string, number>()
    const lost = new Map<string, number>() // hours in cities no night reaches
    for (const b of buckets) {
      const n = nights.get(b.city) ?? 0
      let ok = n > 0
      if (ok && (b.dates || b.parties.length)) {
        ok = !!where.get(b.city)?.some((w) => (!b.parties.length || b.parties.includes(w.party)) && (!b.dates || b.dates.has(w.date) || b.dates.has(addDays(w.date, 1))))
      }
      if (ok) reach.set(b.city, (reach.get(b.city) ?? 0) + b.hours)
      else lost.set(b.city, (lost.get(b.city) ?? 0) + b.hours)
    }
    let own = 0
    let idle = 0
    const spare = new Map<string, number>()
    for (const [c, n] of nights) {
      const cap = n * HOURS_PER_NIGHT
      const used = Math.min(reach.get(c) ?? 0, cap)
      own += used
      spare.set(c, cap - used)
    }
    // what is left over in a city may be a day trip from a city next to it that has the time
    const left = new Map<string, number>()
    for (const [c, h] of reach) {
      const over = h - (spare.has(c) ? Math.min(h, (nights.get(c) ?? 0) * HOURS_PER_NIGHT) : 0)
      if (over > 1e-9) left.set(c, (left.get(c) ?? 0) + over)
    }
    for (const [c, h] of lost) left.set(c, (left.get(c) ?? 0) + h)
    let trips = 0
    const dt: Eval['dt'] = []
    for (const [c, h] of [...left].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) {
      let from: string | null = null
      let room = 0
      for (const [y, s] of spare) {
        if (!near(c, y)) continue
        const r = s - (2 * mins(c, y)) / 60
        if (r > room) {
          room = r
          from = y
        }
      }
      if (!from) continue
      const take = Math.min(h, room)
      if (take < 0.5) continue
      spare.set(from, spare.get(from)! - take - (2 * mins(c, from)) / 60)
      trips += take
      dt.push({ city: c, from, hours: take })
    }
    for (const s of spare.values()) idle += Math.max(0, s)

    // hotel changes, going back, one-night stays, arrival and departure
    const seq = slots.map((s, i) => (s.free ? assign[i]! : s.main!))
    let moves = 0
    let moveCost = 0
    const runs = new Map<string, number>()
    let runLen = 0
    for (let i = 0; i < seq.length; i++) {
      if (i === 0 || seq[i] !== seq[i - 1]) {
        if (i > 0) {
          moves++
          moveCost += 3 + (1.5 * mins(seq[i - 1], seq[i])) / 60
          if (runLen === 1 && i - 1 > 0) moveCost += 1.5
        }
        runs.set(seq[i], (runs.get(seq[i]) ?? 0) + 1)
        runLen = 1
      } else runLen++
    }
    for (const n of runs.values()) if (n > 1) moveCost += 6 * (n - 1)
    for (const p of inp.parties) {
      const mine = slots.map((s, i) => ({ s, i })).filter(({ s }) => s.occ.some((o) => o.party === p.id))
      if (!mine.length) continue
      const first = mine[0]
      const lastS = mine[mine.length - 1]
      const fc = cityOf(assign, first.i, first.s.occ.find((o) => o.party === p.id)!)
      const lc = cityOf(assign, lastS.i, lastS.s.occ.find((o) => o.party === p.id)!)
      if (p.arrival && cities.has(p.arrival)) moveCost += (1.5 * mins(p.arrival, fc)) / 60
      if (p.departure && cities.has(p.departure)) moveCost += (1.5 * mins(p.departure, lc)) / 60
    }
    const score = prof.place * (own + DAYTRIP_VALUE * trips) - prof.idle * idle - prof.move * moveCost
    return { score, moves, hours: own + trips, dt: detail ? dt : [] }
  }

  // ---- search: from a few starting points, change a block of open nights to one city while that improves the score
  const F = freeIdx.length
  function climb(start: (string | null)[], prof: Profile) {
    const a = [...start]
    let best = evaluate(a, prof).score
    for (let round = 0; round < 60; round++) {
      let move: { i: number; j: number; c: string } | null = null
      let gain = 1e-9
      for (let i = 0; i < F; i++) {
        for (let j = i; j < F; j++) {
          for (const c of candList) {
            const save: (string | null)[] = []
            let changed = false
            for (let k = i; k <= j; k++) {
              save.push(a[freeIdx[k]])
              if (a[freeIdx[k]] !== c) changed = true
              a[freeIdx[k]] = c
            }
            if (changed) {
              const s = evaluate(a, prof).score
              if (s - best > gain) {
                gain = s - best
                move = { i, j, c }
              }
            }
            for (let k = i; k <= j; k++) a[freeIdx[k]] = save[k - i]
          }
        }
      }
      if (!move) break
      for (let k = move.i; k <= move.j; k++) a[freeIdx[k]] = move.c
      best += gain
    }
    return a
  }

  const blank = () => slots.map(() => null as string | null)
  const seeds: (string | null)[][] = []
  for (const c of candList) {
    const a = blank()
    for (const i of freeIdx) a[i] = c
    seeds.push(a)
  }
  // the busiest cities in turn, in the order of their distance from the arrival city (or from the busiest one)
  {
    const byDemand = [...candList].sort((x, y) => (demand.get(y) ?? 0) - (demand.get(x) ?? 0) || (x < y ? -1 : 1))
    const origin = inp.parties.find((p) => p.arrival && cities.has(p.arrival))?.arrival ?? byDemand[0]
    const order = [...byDemand].sort((x, y) => mins(origin, x) - mins(origin, y) || (x < y ? -1 : 1))
    const w = order.map((c) => Math.max(demand.get(c) ?? 0, 0.5))
    const tot = w.reduce((s, x) => s + x, 0)
    const a = blank()
    let k = 0
    let acc = 0
    for (let n = 0; n < F; n++) {
      while (k < order.length - 1 && n >= Math.round(((acc + w[k]) / tot) * F)) {
        acc += w[k]
        k++
      }
      a[freeIdx[n]] = order[k]
    }
    seeds.push(a)
  }

  type Found = { assign: (string | null)[]; sig: string; ev: Record<string, Eval>; place: number }
  const found = new Map<string, Found>()
  for (const prof of PROFILES) {
    const ranked = seeds
      .map((s) => ({ s, v: evaluate(s, prof).score }))
      .sort((x, y) => y.v - x.v)
      .slice(0, 4)
    for (const { s } of ranked) {
      const a = climb(s, prof)
      const sig = freeIdx.map((i) => a[i]).join('|')
      if (!found.has(sig)) found.set(sig, { assign: a, sig, ev: {}, place: 0 })
    }
  }
  const pool = [...found.values()]
  for (const f of pool) for (const p of PROFILES) f.ev[p.kind] = evaluate(f.assign, p, true)

  // choose: the best balanced one; one with fewer hotel changes and one that fills more hours, when there is one
  // that really is (not just the same nights in another order); a second best balanced one if those are missing
  const shape = (f: Found) => {
    const runs: string[] = []
    let n = 0
    for (let k = 0; k < F; k++) {
      n++
      const c = f.assign[freeIdx[k]]
      if (k === F - 1 || f.assign[freeIdx[k + 1]] !== c || freeIdx[k + 1] !== freeIdx[k] + 1) {
        runs.push(c + ':' + n)
        n = 0
      }
    }
    return runs.sort().join()
  }
  const bal = (a: Found, b: Found) => b.ev.balanced.score - a.ev.balanced.score
  const sorted = [...pool].sort(bal)
  const picked: { f: Found; kind: SplitReason['kind'] }[] = []
  const fresh = (x: Found) => !picked.some((p) => shape(p.f) === shape(x))
  const best = sorted[0]
  picked.push({ f: best, kind: 'balanced' })
  const fewer = [...sorted].sort((a, b) => a.ev.balanced.moves - b.ev.balanced.moves || bal(a, b)).find((x) => fresh(x) && x.ev.balanced.moves < best.ev.balanced.moves)
  if (fewer) picked.push({ f: fewer, kind: 'fewer_moves' })
  const more = [...sorted].sort((a, b) => b.ev.balanced.hours - a.ev.balanced.hours || bal(a, b)).find((x) => fresh(x) && x.ev.balanced.hours > best.ev.balanced.hours + 0.4)
  if (more) picked.push({ f: more, kind: 'more_places' })
  if (picked.length < 2) {
    const next = sorted.find(fresh)
    if (next) {
      const e = next.ev.balanced
      const b = best.ev.balanced
      picked.push({ f: next, kind: e.moves < b.moves ? 'fewer_moves' : e.hours > b.hours + 0.4 ? 'more_places' : 'balanced' })
    }
  }
  return picked.map(({ f, kind }) => toAlternative(f.assign, kind, f.ev.balanced))

  // ---- the answer: runs of open nights, and what the alternative covers
  function toAlternative(assign: (string | null)[], kind: SplitReason['kind'], ev: Eval): Alternative {
    const rows: SplitRow[] = []
    const open = (i: number) => slots[i].occ.filter((o) => !o.fixed).map((o) => o.party)
    let i = 0
    while (i < slots.length) {
      if (!slots[i].free) {
        i++
        continue
      }
      const who = open(i).join(',')
      const city = assign[i]!
      let j = i
      while (j + 1 < slots.length && slots[j + 1].free && assign[j + 1] === city && open(j + 1).join(',') === who && slots[j + 1].date === addDays(slots[j].date, 1)) j++
      const parties = open(i)
      const everyone = parties.length === ids.length || ids[0] === '*'
      for (const p of everyone ? [null] : parties) {
        rows.push({ city, nights: j - i + 1, party: p, checkIn: slots[i].date, checkOut: addDays(slots[j].date, 1) })
      }
      i = j + 1
    }
    // places: in the city of a night (as many as the nights hold), then on day trips
    const covered = coverCount(assign, ev)
    return { rows, reason: { kind, moves: ev.moves, coveredPlaces: covered.count, totalPlaces, dayTrips: covered.dayTrips } }
  }

  function coverCount(assign: (string | null)[], ev: Eval) {
    const nights = new Map<string, number>()
    for (let i = 0; i < slots.length; i++) {
      for (const c of new Set(slots[i].occ.map((o) => cityOf(assign, i, o)))) nights.set(c, (nights.get(c) ?? 0) + 1)
    }
    let count = 0
    const dayTrips: SplitReason['dayTrips'] = []
    const byCity = new Map<string, SplitPlace[]>()
    for (const { p, home } of homes) byCity.set(home, [...(byCity.get(home) ?? []), p])
    const dtLeft = new Map(ev.dt.map((d) => [d.city, d]))
    for (const [c, ps] of byCity) {
      const sorted = [...ps].sort((a, b) => a.mins - b.mins)
      let cap = (nights.get(c) ?? 0) * HOURS_PER_NIGHT
      let n = 0
      for (const p of sorted) {
        if (p.mins / 60 <= cap + 1e-9) {
          cap -= p.mins / 60
          n++
        }
      }
      count += n
      const d = dtLeft.get(c)
      if (d) {
        let h = d.hours
        let m = 0
        for (const p of sorted.slice(n)) {
          if (p.mins / 60 <= h + 1e-9) {
            h -= p.mins / 60
            m++
          }
        }
        if (m) {
          count += m
          dayTrips.push({ city: c, from: d.from, places: m })
        }
      }
    }
    return { count, dayTrips }
  }
}
