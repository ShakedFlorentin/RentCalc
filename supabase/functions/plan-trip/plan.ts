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
// missed: it wants a time of day (a morning café, cakes that sell out) and the day only reaches it hours after
export type Placed = { day: number; start: number; order: number; late?: boolean; missed?: boolean }
export type Outcome = { placed: Map<string, Placed>; unplanned: Map<string, 'closed' | 'no_day' | 'full'>; issues: Issue[] }
/** What the final check found on a planned place: it should never happen, and the app shows it if it does. */
export type Issue = { id: string; kind: 'overlap' | 'tight' | 'hours' | 'meals' }

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
  return { placed: out.placed, unplanned: out.unplanned, issues: check(days, units, fixed, out.placed) }
}

/**
 * The last word before the plan is written: walk each couple's day in time order and flag what a person couldn't
 * follow: two plans at once (with each other or with something fixed), not enough time to get from one to the next,
 * outside opening hours, or two full meals too close together.
 */
export function check(days: Day[], units: Unit[], fixed: Fixed[], placed: Map<string, Placed>): Issue[] {
  const byId = new Map(units.map((u) => [u.id, u]))
  const issues: Issue[] = []
  const flag = (id: string, kind: Issue['kind']) => {
    if (!issues.some((x) => x.id === id && x.kind === kind)) issues.push({ id, kind })
  }
  for (const d of days) {
    for (const c of d.at.keys()) {
      const mine = [...placed]
        .filter(([id, p]) => p.day === d.day && byId.get(id)!.couples.includes(c))
        .map(([id, p]) => ({ id, u: byId.get(id)!, s: p.start }))
        .sort((x, y) => x.s - y.s)
      const busy = fixed.filter((f) => f.day === d.day && f.start != null && f.couples.includes(c))
      let lastMeal: number | null = null
      mine.forEach(({ id, u, s }, i) => {
        const prev = mine[i - 1]
        if (prev && prev.s + prev.u.mins > s) flag(id, 'overlap')
        // ten minutes of slack: the times are rounded to a quarter of an hour
        else if (prev && prev.s + prev.u.mins + ride(prev.u.point, u.point) > s + 10) flag(id, 'tight')
        if (busy.some((f) => s < f.start! + f.mins && s + u.mins > f.start!)) flag(id, 'overlap')
        if ((u.opens != null && s < u.opens) || (u.closes != null && s + u.mins > u.closes)) flag(id, 'hours')
        if (u.category === 'food') {
          if (lastMeal != null && s - lastMeal < MEAL_GAP) flag(id, 'meals')
          lastMeal = s
        }
      })
    }
  }
  return issues
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

  // a day's times: the couples one after another (shared places first), or everyone's clocks at once, whichever
  // reaches fewer places hours past their hour without making any late for closing
  const timesOf = (day: number) => {
    const d = byDay.get(day)!
    const ids = live.filter((u) => at.get(u.id) === day)
    const fx = fixed.filter((f) => f.day === day)
    if (!ids.length) return new Map<string, Placed>()
    const [a, b] = timetables(d, ids, fx)
    const score = (m: Map<string, Placed>) => {
      let late = 0
      let missed = 0
      let behind = 0
      const meals = new Map<string, number[]>()
      for (const [id, p] of m) {
        const u = unitById.get(id)!
        if (p.late) late++
        if (p.missed) missed++
        const w = wantOf(u)
        if (w != null && w < 17 * 60) behind += Math.max(0, p.start - w)
        if (u.category === 'food') for (const c of u.couples) meals.set(c, [...(meals.get(c) ?? []), p.start])
      }
      // two full meals too close together for the same people
      let crowded = 0
      for (const ss of meals.values()) {
        ss.sort((x, y) => x - y)
        for (let i = 1; i < ss.length; i++) if (ss[i] - ss[i - 1] < MEAL_GAP) crowded++
      }
      // what a person couldn't follow: two plans at once, not enough time to get there, outside opening hours
      const broken = check([d], ids, fx, m).filter((x) => x.kind !== 'meals').length
      return { late, broken, crowded, missed, behind }
    }
    const sa = score(a)
    const sb = score(b)
    // nothing late for closing first, then a day that can be followed, meals spaced, fewer places past their hour,
    // then less waiting for it
    const keys = ['broken', 'crowded', 'missed', 'behind'] as const
    const k = keys.find((x) => sb[x] !== sa[x])
    return sb.late <= sa.late && k != null && sb[k] < sa[k] ? b : a
  }
  const missedOn = (day: number) => {
    let late = 0
    let missed = 0
    for (const p of timesOf(day).values()) {
      if (p.late) late++
      if (p.missed) missed++
    }
    return { late, missed }
  }

  // repair: a place reached hours past its hour moves on its own to a day where it is on time, when that day has
  // room and neither day ends up with more places late or past their hour (nothing else moves, nothing drops)
  for (let round = 0; round < 2; round++) {
    let moved = false
    for (const u of order) {
      const was = at.get(u.id)
      if (was == null || !timesOf(was).get(u.id)?.missed) continue
      const before = missedOn(was)
      for (const day of options.get(u.id)!) {
        if (day === was || !fitsWithout(u, day, null)) continue
        const there = missedOn(day)
        put(u, day)
        const p = timesOf(day).get(u.id)!
        const a = missedOn(was)
        const b = missedOn(day)
        if (!p.missed && !p.late && a.late <= before.late && b.late <= there.late && a.missed + b.missed < before.missed + there.missed) {
          moved = true
          break
        }
        put(u, was)
      }
    }
    if (!moved) break
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
    const times = timesOf(d.day)
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
// the whole visit has to end by closing time (it used to be enough to arrive an hour before)
const stay = (u: Unit) => u.mins
// two full meals for the same people at least this far apart (start to start)
const MEAL_GAP = 180
// minutes of travel worth one minute of a timed place reached past its hour, when placing a place that has none
const LW = 0.5
// the time of day a place asks for; "morning" for a place that opens at noon means as soon as it opens
const wantOf = (u: Unit) => {
  const s = SLOT[u.best]
  return s == null ? null : Math.max(s, u.opens ?? 0)
}

/**
 * Rough times for one day, two ways, both walked with a clock per couple (the ride from wherever each couple is):
 * what everyone does together first and then each couple's own, or every place in the order of the hour it wants,
 * so a couple's morning place can come before the shared afternoon instead of after all of it. Places that want no
 * hour go where they add the least travel without pushing a timed place late or past closing.
 */
function timetables(d: Day, units: Unit[], fixed: Fixed[]) {
  const couples = [...d.at.keys()]
  const meals = new Map<string, number[]>()
  const want = new Map<string, number | null>()
  // meals without a stated hour: lunch if the couple's day starts early enough, then dinner (per group of couples)
  for (const u of [...units].sort((a, b) => b.priority - a.priority)) {
    const w = wantOf(u)
    if (w != null) {
      want.set(u.id, w)
      continue
    }
    const k = [...u.couples].sort().join('+')
    if (!meals.has(k)) {
      const start = Math.max(...u.couples.map((c) => d.at.get(c)!.start))
      meals.set(k, [...(start <= 13 * 60 + 30 ? [12 * 60 + 15] : []), 18 * 60 + 30])
    }
    want.set(u.id, u.category === 'food' ? meals.get(k)!.shift() ?? null : u.category === 'cafe' ? 15 * 60 : u.category === 'nightlife' ? 20 * 60 : null)
  }
  const fixedBusy = new Map<string, [number, number][]>(couples.map((c) => [c, []]))
  for (const f of fixed) if (f.start != null) for (const c of f.couples) fixedBusy.get(c)?.push([f.start, f.start + f.mins])

  // walks an order of places and gives each a start; late: minutes daytime places are reached past their hour
  const walk = (order: Unit[]) => {
    const clock = new Map(couples.map((c) => [c, d.at.get(c)!.start]))
    const where = new Map<string, Point | null>(couples.map((c) => [c, d.at.get(c)!.hotel]))
    const busy = new Map(couples.map((c) => [c, [...fixedBusy.get(c)!]]))
    const meal = new Map<string, number>()
    const starts = new Map<string, number>()
    let late = 0
    let closed = 0
    for (const u of order) {
      let t = Math.max(...u.couples.map((c) => clock.get(c)! + ride(where.get(c)!, u.point)))
      const w = want.get(u.id)
      // an evening place waits for the evening; a daytime one waits only when its hour is close
      if (w != null && w > t && (w >= 17 * 60 || u.category === 'food' || w - t < 120)) t = w
      if (u.opens != null && t < u.opens) t = u.opens
      // a full meal waits until the last one has settled (a café or dessert stop doesn't count)
      if (u.category === 'food') for (const c of u.couples) if (meal.has(c)) t = Math.max(t, meal.get(c)! + MEAL_GAP)
      for (let guard = 0; guard < 6; guard++) {
        const clash = u.couples.flatMap((c) => busy.get(c)!).find(([a, b]) => t < b && t + u.mins > a)
        if (!clash) break
        t = clash[1] + 15
      }
      const s = round15(t)
      starts.set(u.id, s)
      if (w != null && w < 17 * 60) late += Math.max(0, s - w - 30)
      if (s + stay(u) > (u.closes ?? 24 * 60) || s > Math.min(...u.couples.map((c) => d.at.get(c)!.end)) + 30) closed++
      for (const c of u.couples) {
        clock.set(c, s + u.mins)
        where.set(c, u.point ?? where.get(c)!)
        busy.get(c)!.push([s, s + u.mins])
        if (u.category === 'food') meal.set(c, s)
      }
    }
    return { starts, late, closed }
  }
  // travel a place adds for its couples between its neighbours in the order
  const travel = (order: Unit[]) => {
    const where = new Map<string, Point | null>(couples.map((c) => [c, d.at.get(c)!.hotel]))
    let m = 0
    for (const u of order) for (const c of u.couples) {
      m += ride(where.get(c)!, u.point)
      where.set(c, u.point ?? where.get(c)!)
    }
    return m
  }
  // places in the order of their hour, each place that wants none where it adds least travel and lateness
  const arrangeOrder = (us: Unit[], before: Unit[]) => {
    const order = us.filter((u) => want.get(u.id) != null).sort((a, b) => want.get(a.id)! - want.get(b.id)! || b.couples.length - a.couples.length)
    for (const u of us.filter((x) => want.get(x.id) == null).sort((a, b) => b.mins - a.mins)) {
      let best = 0
      let bestCost = Infinity
      for (let i = 0; i <= order.length; i++) {
        const tried = [...before, ...order.slice(0, i), u, ...order.slice(i)]
        // after a night place (a bar) nothing else comes that day
        const night = i > 0 && order[i - 1].best === 'night' ? 60 : 0
        // a spot that leaves anything after closing (or after the day's end) only if there is no other
        const w = walk(tried)
        const cost = travel(tried) + w.late * LW + night + w.closed * 1000
        if (cost < bestCost) {
          bestCost = cost
          best = i
        }
      }
      order.splice(best, 0, u)
    }
    return order
  }
  const timed = (order: Unit[]) => {
    const { starts } = walk(order)
    const out = new Map<string, Placed>()
    const end = (u: Unit) => Math.min(...u.couples.map((c) => d.at.get(c)!.end))
    const sorted = [...order].sort((a, b) => starts.get(a.id)! - starts.get(b.id)!)
    sorted.forEach((u, i) => {
      const s = starts.get(u.id)!
      const w = wantOf(u)
      out.set(u.id, {
        day: d.day,
        start: s,
        order: i,
        late: s + stay(u) > (u.closes ?? 24 * 60) || s > end(u) + 30,
        missed: w != null && w < 17 * 60 && s - w > 120,
      })
    })
    return out
  }
  // groups: what everyone does together first, then each couple's own (the planner's first way of doing it)
  const groups: Unit[] = []
  const sets = new Map<string, Unit[]>()
  for (const u of units) sets.set([...u.couples].sort().join('+'), [...(sets.get([...u.couples].sort().join('+')) ?? []), u])
  for (const [, us] of [...sets].sort((a, b) => b[1][0].couples.length - a[1][0].couples.length)) groups.push(...arrangeOrder(us, groups))
  return [timed(groups), timed(arrangeOrder(units, []))]
}

export const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
