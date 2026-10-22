import { CATEGORIES, WHO_OPTIONS, type Booking, type ItineraryItem } from '../types'

/** itinerary_items.who is a new column (couple, or null for everyone); types.ts doesn't have it yet. */
// ItineraryItem carries `who` now; the alias keeps the plan code's name for it
export type PlanItem = ItineraryItem

/** One row of a day's timeline: a plan item, or a read-only booking moment (landing, check-in, a table...). */
export type Entry = {
  key: string
  time: string | null
  icon: string
  title: string
  sub: string | null
  location: string | null
  who: string | null
  done: boolean
  item?: PlanItem
  booking?: Booking
}

/** mine = my couple's items plus the group's, group = only the group's, all = everything */
export type WhoMode = 'mine' | 'group' | 'all'

export function visible(who: string | null | undefined, mode: WhoMode, mine: string | null) {
  if (mode === 'all' || !who) return true
  return mode === 'mine' && (!mine || who === mine)
}

export function ymd(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function navUrl(destination: string) {
  return 'https://www.google.com/maps/dir/?api=1&travelmode=transit&destination=' + encodeURIComponent(destination)
}

const JAPAN = /\b(HND|NRT|KIX|ITM|NGO|CTS|FUK)\b|Haneda|Narita|Kansai|הנדה|נריטה|קנסאי|טוקיו|יפן/i

/** Which side of "A → B" a flight title puts Japan on; null when it can't tell. */
function flightSide(title: string): 'from' | 'to' | null {
  const parts = title.split(/→|->|⟶|—|–/)
  if (parts.length < 2) return null
  const from = JAPAN.test(parts[0])
  const to = JAPAN.test(parts.slice(1).join(' '))
  return from === to ? null : from ? 'from' : 'to'
}

export type Airport = 'HND' | 'NRT'

/** The Tokyo airport a flight lands at, from its title/notes, falling back to the couple's known airport. */
export function arrivalAirport(b: Booking): Airport | null {
  const dest = b.title.split(/→|->|⟶|—|–/).slice(1).join(' ') || b.title
  const text = `${dest} ${b.notes ?? ''}`
  if (/\bHND\b|Haneda|הנדה/i.test(text)) return 'HND'
  if (/\bNRT\b|Narita|נריטה/i.test(text)) return 'NRT'
  return null
}

const KIND_ICON: Record<string, string> = { hotel: '🏨', restaurant: '🍽️', activity: '🎟️', train: '🚄', other: '📄' }

/** Bookings that happen on this date (YYYY-MM-DD), as timeline rows. Insurance has no moment, so it is left out. */
export function bookingEntries(bookings: Booking[], date: string): Entry[] {
  const out: Entry[] = []
  const add = (b: Booking, at: string | null, tag: string, icon: string, location: string | null) => {
    if (!at || at.slice(0, 10) !== date) return
    out.push({
      key: `${b.id}:${tag}`,
      time: at.slice(11, 16),
      icon,
      title: `${tagLabel[tag] ?? ''}${b.title}`,
      sub: b.confirmation ? `אישור ${b.confirmation}` : null,
      location,
      who: b.who,
      done: false,
      booking: b,
    })
  }
  for (const b of bookings) {
    if (b.kind === 'insurance') continue
    if (b.kind === 'flight') {
      // a flight shows its Japan end only: taking off from Zurich on the way in is not part of a Japan day
      const side = flightSide(b.title)
      if (side !== 'to') add(b, b.starts_at, 'dep', '✈️', b.location)
      if (side !== 'from') add(b, b.ends_at, 'arr', '🛬', null)
    } else if (b.kind === 'hotel') {
      add(b, b.starts_at, 'in', '🏨', b.location || b.title)
      add(b, b.ends_at, 'out', '🏨', null)
    } else {
      add(b, b.starts_at, 'at', KIND_ICON[b.kind] ?? '📄', b.location || b.title)
    }
  }
  return out
}
const tagLabel: Record<string, string> = { dep: 'המראה · ', arr: 'נחיתה · ', in: 'צ׳ק-אין · ', out: 'צ׳ק-אאוט · ' }

export function itemEntry(i: PlanItem): Entry {
  return {
    key: i.id,
    time: i.time ? i.time.slice(0, 5) : null,
    icon: CATEGORIES[i.category]?.split(' ')[0] ?? '📌',
    title: i.title,
    sub: i.notes,
    location: i.location,
    who: i.who ?? null,
    done: i.done,
    item: i,
  }
}

const byEntryTime = (a: Entry, b: Entry) => (a.time ?? '99').localeCompare(b.time ?? '99')

/** A day as one timeline: plan items and bookings merged by time, filtered by whose they are. */
export function dayEntries(items: PlanItem[], bookings: Booking[], day: number, date: string, mode: WhoMode, mine: string | null) {
  const own = items.filter((i) => i.day === day).sort((a, b) => a.sort - b.sort).map(itemEntry)
  return [...own, ...bookingEntries(bookings, date)].filter((e) => visible(e.who, mode, mine)).sort(byEntryTime)
}

/** A day_info.hotel line like "💑 שקד ומאור: Hotel X" belongs to that couple; any other line is for everyone. */
export function hotelLines(hotel: string | null, couples: string[]) {
  const names = couples.length ? couples : WHO_OPTIONS
  return (hotel ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^(?:💑\s*)?([^:：]+?)\s*[:：]\s*(.+)$/)
      return m && names.includes(m[1].trim()) ? { who: m[1].trim(), text: m[2].trim() } : { who: null, text: raw }
    })
}

/** The hotel lines that apply to a couple: its own, or the shared ones when it has none. */
export function hotelFor(hotel: string | null, couples: string[], mine: string | null) {
  const lines = hotelLines(hotel, couples)
  const own = lines.filter((l) => l.who && l.who === mine)
  return (own.length ? own : lines.filter((l) => !l.who)).map((l) => l.text)
}

/** "בעוד 45 דק׳" / "בעוד שעה ו-10 דק׳" for a number of minutes. */
export function fmtUntil(min: number) {
  if (min <= 0) return 'עכשיו'
  if (min < 60) return `בעוד ${min} דק׳`
  const h = Math.floor(min / 60)
  const r = min % 60
  const hs = h === 1 ? 'שעה' : h === 2 ? 'שעתיים' : `${h} שעות`
  return `בעוד ${hs}${r ? ` ו-${r} דק׳` : ''}`
}

export const minutesOf = (hhmm: string) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5)

/** First steps after landing, written per airport: Narita is far from Tokyo, Haneda is close. */
export const ARRIVAL: Record<Airport, { name: string; steps: string[] }> = {
  HND: {
    name: 'הנדה (HND)',
    steps: [
      '🛂 ביקורת גבולות: Visit Japan Web (קודי QR) פתוח בטלפון.',
      '💳 Suica או PASMO בארנק הטלפון (iPhone), או כרטיס Welcome Suica מהמכונות בטרמינל.',
      '💴 מזומן: למשוך ין בכספומט בשדה או בחנות נוחות (7-Eleven / Lawson).',
      '🚆 הנדה קרוב לעיר, בערך חצי שעה למרכז: רכבת קייקיו או המונורייל, ומשם לקו שמגיע למלון.',
      '🏨 צ׳ק-אין בדרך כלל מ-15:00. אפשר להשאיר מזוודות במלון ולצאת לטייל.',
    ],
  },
  NRT: {
    name: 'נריטה (NRT)',
    steps: [
      '🛂 ביקורת גבולות: Visit Japan Web (קודי QR) פתוח בטלפון.',
      '💳 Suica או PASMO בארנק הטלפון (iPhone), או כרטיס Welcome Suica מהמכונות בטרמינל.',
      '💴 מזומן: למשוך ין בכספומט בשדה או בחנות נוחות (7-Eleven / Lawson).',
      '🚆 נריטה רחוק: שעה ויותר עד טוקיו. הכי נוח ב-Narita Express או ב-Keisei Skyliner, ומשם ברכבת למלון.',
      '🏨 צ׳ק-אין בדרך כלל מ-15:00. אפשר להשאיר מזוודות במלון ולצאת לטייל.',
    ],
  },
}

/** Fallback when the booking doesn't name its airport: where each couple is known to land. */
export const COUPLE_AIRPORT: Record<string, Airport> = { 'שקד ומאור': 'HND', 'אלמוג ושניר': 'NRT' }
