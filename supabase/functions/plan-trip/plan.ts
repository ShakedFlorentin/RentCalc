// The trip planner's core: which day each matched place goes on, and roughly when. Pure code (no I/O), so it can
// be run and tested outside the edge runtime.

export type Point = { lat: number; lng: number }
export type BestTime = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'any'

/** Where one couple is on one day and the hours they have for plans (minutes after midnight). */
export type Presence = { base: string; hotel: Point; start: number; end: number }

export type Day = {
  day: number
  date: string // YYYY-MM-DD
  weekday: number // 0 = Sunday
  at: Map<string, Presence> // couple → presence; a couple not in Japan that day is missing
}

/** Something already fixed on a day: a booking, or a plan item a person put or moved there. */
export type Fixed = { day: number; couples: string[]; point: Point | null; start: number | null; mins: number }

/** A matched place the planner may put on a day. */
export type Unit = {
  id: string
  couples: string[]
  base: string
  far: boolean // a day trip: more than 25 km from where its couples sleep
  point: Point | null
  mins: number
  category: string
  best: BestTime
  opens: number | null
  closes: number | null
  closedWeekdays: number[]
  closedDates: string[]
  openDates: string[] // runs only on these dates (a market, an event); empty = no such limit
  priority: number
  current: number | null // the day it is on now, if any
}

// late: the day's timetable only reaches it after it closes (or after the day's hours)
export type Placed = { day: number; start: number; order: number; late?: boolean }
export type Outcome = { placed: Map<string, Placed>; unplanned: Map<string, 'closed' | 'no_day' | 'full'> }

// a day's plans add up to at most this much, whatever the window; a baby and December daylight set the pace
const DAY_CAP = 510
// a couple's own plans on a day both couples are in the same city: the day is mostly together
const APART_CAP = 180
// minutes between places on top of the ride itself
const HOP = 20
// a day trip starts by this time and its places sit this close together
const TRIP_START = 11 * 60
const TRIP_SPREAD = 20
// a place in another city this close to where a couple sleeps can go on that day too (Tokyo from Yokohama)
const NEAR_KM = 30
// at most this many of a kind a day, per couple
const PER_DAY: Record<string, number> = { food: 2, cafe: 2, nightlife: 2 }

export function km(a: Point, b: Point) {
  const r = Math.PI / 180
  const x = (b.lng - a.lng) * r * Math.cos(((a.lat + b.lat) / 2) * r)
  const y = (b.lat - a.lat) * r
  return Math.sqrt(x * x + y * y) * 6371
}

/** Minutes of travel between two places: walking, city trains with a transfer, or an express train further out. */
export function ride(a: Point | null, b: Point | null) {
  if (!a || !b) return 25
  const d = km(a, b)
  return Math.min(150, Math.round(d < 1.2 ? d * 15 : Math.min(12 + d * 3.2, 30 + d * 0.9)))
}

/**
 * The plan: each unit on the day that keeps the days compact and balanced, then a rough time for each. A place the
 * day's timetable can't fit before it closes is barred from that day and the days are worked out again.
 */
export function plan(days: Day[], units: Unit[], fixed: Fixed[]): Outcome {
  const barred = new Map<string, Set<number>>()
  let out = arrange(days, units, fixed, barred)
  for (let round = 0; round < 3 && out.late.length; round++) {
    for (const { id, day } of out.late) barred.set(id, new Set([...(barred.get(id) ?? []), day]))
    out = arrange(days, units, fixed, barred)
  }
  // still late after that: better left for the people to place than put where it is closed
  for (const { id } of out.late) {
    out.placed.delete(id)
    out.unplanned.set(id, 'full')
  }
  return { placed: out.placed, unplanned: out.unplanned }
}

function arrange(days: Day[], units: Unit[], fixed: Fixed[], barred: Map<string, Set<number>>) {
  const byDay = new Map(days.map((d) => [d.day, d]))
  const fixedMins = new Map<string, number>()
  const fixedPts = new Map<string, Point[]>()
  for (const f of fixed) {
    for (const c of f.couples) {
      const k = f.day + '|' + c
      fixedMins.set(k, (fixedMins.get(k) ?? 0) + f.mins)
      if (f.point) fixedPts.set(k, [...(fixedPts.get(k) ?? []), f.point])
    }
  }
  const cap = (day: number, c: string) => {
    const p = byDay.get(day)?.at.get(c)
    if (!p) return 0
    return Math.max(0, Math.min(DAY_CAP, p.end - p.start) - (fixedMins.get(day + '|' + c) ?? 0))
  }
  // the couples sleeping in the same city as this couple that day
  const together = (d: Day, c: string) => [...d.at].filter(([, p]) => p.base === d.at.get(c)!.base).map(([o]) => o)

  const unplanned = new Map<string, 'closed' | 'no_day' | 'full'>()
  const options = new Map<string, number[]>()
  for (const u of units) {
    let anyDay = false
    const ok = days.filter((d) => {
      const there = u.couples.every((c) => {
        const p = d.at.get(c)
        if (!p) return false
        // a day trip needs a day that starts in the morning, with time for the ride there and back
        if (u.far) return !!u.point && km(p.hotel, u.point) <= 150 && p.start <= TRIP_START && p.end - p.start >= 2 * ride(p.hotel, u.point) + u.mins
        return p.base === u.base || (!!u.point && km(p.hotel, u.point) <= NEAR_KM)
      })
      if (!there) return false
      anyDay = true
      if (u.closedWeekdays.includes(d.weekday) || u.closedDates.includes(d.date) || barred.get(u.id)?.has(d.day)) return false
      if (u.openDates.length && !u.openDates.includes(d.date)) return false
      // open long enough inside the hours everyone has that day
      const start = Math.max(...u.couples.map((c) => d.at.get(c)!.start), u.opens ?? 0)
      const end = Math.min(...u.couples.map((c) => d.at.get(c)!.end), u.closes ?? 24 * 60)
      return end - start >= Math.min(u.mins, 90)
    })
    if (ok.length) options.set(u.id, ok.map((d) => d.day))
    else unplanned.set(u.id, anyDay ? 'closed' : 'no_day')
  }
  const live = units.filter((u) => options.has(u.id))
  const unitById = new Map(units.map((u) => [u.id, u]))

  // state: the day of each unit (or null) and the units on each day/couple
  const at = new Map<string, number | null>()
  const groups = new Map<string, Set<string>>()
  const group = (day: number, c: string) => {
    const k = day + '|' + c
    let g = groups.get(k)
    if (!g) groups.set(k, (g = new Set()))
    return g
  }
  // the day's plans, plus the ride out and back when it is a day trip (once, however many places it has)
  const load = (day: number, c: string) => {
    let m = 0
    let trip = 0
    const hotel = byDay.get(day)!.at.get(c)!.hotel
    for (const id of group(day, c)) {
      const u = unitById.get(id)!
      m += u.mins + HOP
      if (u.far) trip = Math.max(trip, 2 * ride(hotel, u.point))
    }
    return m + trip
  }
  const apartLoad = (day: number, c: string) => {
    const d = byDay.get(day)!
    const others = together(d, c).length
    let m = 0
    for (const id of group(day, c)) {
      const u = unitById.get(id)!
      if (u.couples.length < others) m += u.mins
    }
    return m
  }

  /** Cost of one couple's day: spread around its middle (km), crowding, and a long day weighs more than two short ones. */
  const groupCost = (day: number, c: string) => {
    const ids = [...group(day, c)]
    if (!ids.length) return 0
    const d = byDay.get(day)!
    const pres = d.at.get(c)!
    const pts = (far: boolean) =>
      ids.map((id) => unitById.get(id)!).filter((u) => u.far === far && u.point).map((u) => u.point!)
    const fx = fixedPts.get(day + '|' + c) ?? []
    // the hotel pulls the middle a little: a day near where you sleep beats one across town
    const spreadOf = (ps: Point[], around: Point[], pull: number) => {
      if (!ps.length) return 0
      const all = [...ps, ...around]
      const w = all.length + pull
      const mid = {
        lat: (all.reduce((s, p) => s + p.lat, 0) + pres.hotel.lat * pull) / w,
        lng: (all.reduce((s, p) => s + p.lng, 0) + pres.hotel.lng * pull) / w,
      }
      return ps.reduce((s, p) => s + km(p, mid), 0)
    }
    // a day trip's places are measured among themselves; its ride is already in the day's load
    const spread = spreadOf(pts(false), fx, 0.5) + spreadOf(pts(true), [], 0)
    const hours = load(day, c) / 60
    const capH = Math.max(1, cap(day, c) / 60)
    const crowd = Math.max(0, hours - capH * 0.8) * 4
    return spread + crowd + hours * hours * 0.35
  }
  const unitCost = (u: Unit, day: number | null) => {
    if (day == null) return u.priority * 14
    let cost = 0
    const d = byDay.get(day)!
    // a couple's own place fits best on a day the other couple is elsewhere
    if (u.couples.length < together(d, u.couples[0]).length) cost += 2
    if (u.current != null && u.current !== day) cost += 1.5
    // a day that leaves little of the place's opening hours (a market that closes at 14:30 on an arrival day): only
    // if no roomier day will do
    const from = Math.max(u.opens ?? 0, ...u.couples.map((c) => d.at.get(c)!.start))
    if ((u.closes ?? 24 * 60) - from < u.mins + 90) cost += 2
    return cost
  }
  const fits = (u: Unit, day: number) =>
    u.couples.every((c) => {
      const d = byDay.get(day)!
      const extra = u.far ? Math.max(0, 2 * ride(d.at.get(c)!.hotel, u.point) - tripRide(day, c)) : 0
      if (load(day, c) + u.mins + HOP + extra > cap(day, c) + 15) return false
      if (u.couples.length < together(d, c).length && apartLoad(day, c) + u.mins > APART_CAP) return false
      let same = 0
      for (const id of group(day, c)) {
        const v = unitById.get(id)!
        if (v.category === u.category) same++
        // a day trip fills the day: no places back in town, and its places sit near each other
        if (u.far !== v.far) return false
        if (u.far && v.far && u.point && v.point && km(u.point, v.point) > TRIP_SPREAD) return false
      }
      return same < (PER_DAY[u.category] ?? 99)
    })
  const tripRide = (day: number, c: string) => {
    const hotel = byDay.get(day)!.at.get(c)!.hotel
    let trip = 0
    for (const id of group(day, c)) {
      const v = unitById.get(id)!
      if (v.far) trip = Math.max(trip, 2 * ride(hotel, v.point))
    }
    return trip
  }
  const put = (u: Unit, day: number | null) => {
    const was = at.get(u.id)
    if (was != null) for (const c of u.couples) group(was, c).delete(u.id)
    at.set(u.id, day)
    if (day != null) for (const c of u.couples) group(day, c).add(u.id)
  }
  // the change in total cost if u moved to day (and, optionally, evicted went off the plan)
  const delta = (u: Unit, day: number | null, evicted?: Unit) => {
    const was = at.get(u.id) ?? null
    const touched = new Set<string>()
    for (const c of u.couples) {
      if (was != null) touched.add(was + '|' + c)
      if (day != null) touched.add(day + '|' + c)
    }
    if (evicted) for (const c of evicted.couples) touched.add(at.get(evicted.id) + '|' + c)
    const cost = () =>
      [...touched].reduce((s, k) => {
        const [dd, c] = k.split('|')
        return s + groupCost(Number(dd), c)
      }, 0)
    const before = cost() + unitCost(u, was) + (evicted ? unitCost(evicted, at.get(evicted.id) ?? null) : 0)
    const evDay = evicted ? at.get(evicted.id) ?? null : null
    if (evicted) put(evicted, null)
    put(u, day)
    const after = cost() + unitCost(u, day) + (evicted ? unitCost(evicted, null) : 0)
    put(u, was)
    if (evicted) put(evicted, evDay)
    return after - before
  }

  // greedy: the most wanted first, each where it adds least
  const order = [...live].sort((a, b) => b.priority - a.priority || options.get(a.id)!.length - options.get(b.id)!.length)
  for (const u of order) {
    at.set(u.id, null)
    let best: number | null = null
    let bestD = 0
    for (const day of options.get(u.id)!) {
      if (!fits(u, day)) continue
      const dl = delta(u, day)
      if (dl < bestD) {
        bestD = dl
        best = day
      }
    }
    put(u, best)
  }

  // then improve: move single places, or swap a place in for a less wanted one on a full day
  for (let pass = 0; pass < 40; pass++) {
    let improved = false
    for (const u of order) {
      const was = at.get(u.id) ?? null
      let best: { day: number | null; ev?: Unit; dl: number } = { day: was, dl: -0.01 }
      const tries: (number | null)[] = [null, ...options.get(u.id)!]
      for (const day of tries) {
        if (day === was) continue
        if (day == null || fitsWithout(u, day, null)) {
          const dl = delta(u, day)
          if (dl < best.dl) best = { day, dl }
        } else {
          // the day is full: try taking off one less wanted place to make room
          for (const c of u.couples) {
            // a copy: trying a swap takes places off the day and puts them back, which would re-run a live Set
            for (const id of [...group(day, c)]) {
              const v = unitById.get(id)!
              if (v.priority > u.priority || !fitsWithout(u, day, v)) continue
              const dl = delta(u, day, v)
              if (dl < best.dl) best = { day, ev: v, dl }
            }
          }
        }
      }
      if (best.day !== was) {
        if (best.ev) put(best.ev, null)
        put(u, best.day)
        improved = true
      }
    }
    if (!improved) break
  }

  function fitsWithout(u: Unit, day: number, v: Unit | null) {
    const vDay = v ? at.get(v.id) ?? null : null
    const uDay = at.get(u.id) ?? null
    if (v) put(v, null)
    put(u, null)
    const ok = fits(u, day)
    put(u, uDay)
    if (v) put(v, vDay)
    return ok
  }

  const placed = new Map<string, Placed>()
  const late: { id: string; day: number }[] = []
  for (const u of live) {
    const day = at.get(u.id)
    if (day == null) unplanned.set(u.id, 'full')
  }
  for (const d of days) {
    const ids = live.filter((u) => at.get(u.id) === d.day)
    if (!ids.length) continue
    const times = schedule(d, ids, fixed.filter((f) => f.day === d.day))
    for (const [id, p] of times) {
      placed.set(id, p)
      if (p.late) late.push({ id, day: d.day })
    }
  }
  return { placed, unplanned, late }
}

const SLOT: Record<BestTime, number | null> = {
  morning: 9 * 60 + 30,
  midday: 12 * 60,
  afternoon: 14 * 60 + 30,
  evening: 18 * 60,
  night: 20 * 60,
  any: null,
}
const round15 = (m: number) => Math.round(m / 15) * 15

/**
 * Rough times for one day: the places everyone does together first, then each couple's own in their free time.
 * Places that want a time of day (sunset, dinner, a bar) keep it; the rest are threaded in by distance.
 */
function schedule(d: Day, units: Unit[], fixed: Fixed[]) {
  const out = new Map<string, Placed>()
  const busy = new Map<string, [number, number][]>()
  for (const c of d.at.keys()) busy.set(c, [])
  for (const f of fixed) if (f.start != null) for (const c of f.couples) busy.get(c)?.push([f.start, f.start + f.mins])

  // biggest groups first: shared plans are set before a couple fills its own gaps
  const sets = new Map<string, Unit[]>()
  for (const u of units) {
    const k = [...u.couples].sort().join('+')
    sets.set(k, [...(sets.get(k) ?? []), u])
  }
  let order = 0
  for (const [, us] of [...sets].sort((a, b) => b[1][0].couples.length - a[1][0].couples.length)) {
    const couples = us[0].couples
    const pres = couples.map((c) => d.at.get(c)!)
    const start = Math.max(...pres.map((p) => p.start))
    const hotel = pres[0].hotel
    // meals without a stated time: lunch if the day starts early enough, then dinner
    const meals = [...(start <= 13 * 60 + 30 ? [12 * 60 + 15] : []), 18 * 60 + 30]
    const want = (u: Unit) => {
      const s = SLOT[u.best]
      if (s != null) return s
      if (u.category === 'food') return meals.shift() ?? null
      if (u.category === 'cafe') return 15 * 60
      if (u.category === 'nightlife') return 20 * 60
      return null
    }
    const timed = us.map((u) => ({ u, want: want(u) }))
    const anchored = timed.filter((t) => t.want != null).sort((a, b) => a.want! - b.want!)
    const loose = timed.filter((t) => t.want == null).sort((a, b) => b.u.mins - a.u.mins)
    // route: start at the hotel, anchored places in time order, each loose place where it adds the least travel
    const route = anchored.map((t) => t.u)
    for (const { u } of loose) {
      let bestI = 0
      let bestAdd = Infinity
      for (let i = 0; i <= route.length; i++) {
        // a loose place before the first anchored one keeps the morning busy
        const prev = i === 0 ? hotel : route[i - 1].point
        const next = i === route.length ? null : route[i].point
        const add = ride(prev, u.point) + (next ? ride(u.point, next) - ride(prev, next) : 0)
        const late = i > 0 && anchored.length && route[i - 1].best === 'night' ? 60 : 0
        if (add + late < bestAdd) {
          bestAdd = add + late
          bestI = i
        }
      }
      route.splice(bestI, 0, u)
    }
    const end = Math.min(...pres.map((p) => p.end))
    let t = start
    let at: Point | null = hotel
    const wants = new Map(timed.map((x) => [x.u.id, x.want]))
    for (const u of route) {
      t += ride(at, u.point)
      const w = wants.get(u.id)
      // an evening place (sunset, dinner, bars) waits for the evening, the free hours before it are a rest;
      // a morning or afternoon one waits only when its time is close
      if (w != null && w > t && (w >= 17 * 60 || u.category === 'food' || w - t < 120)) t = w
      if (u.opens != null && t < u.opens) t = u.opens
      // step past anything fixed for these couples (a booked table, a check-in)
      for (let guard = 0; guard < 6; guard++) {
        const clash = couples.flatMap((c) => busy.get(c) ?? []).find(([a, b]) => t < b && t + u.mins > a)
        if (!clash) break
        t = clash[1] + 15
      }
      const s = round15(t)
      const closes = u.closes ?? 24 * 60
      out.set(u.id, { day: d.day, start: s, order: order++, late: s + Math.min(u.mins, 60) > closes || s > end + 30 })
      for (const c of couples) busy.get(c)?.push([s, s + u.mins])
      t = s + u.mins
      at = u.point ?? at
    }
  }
  return out
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
