import {
  BadgeCheck,
  BedDouble,
  Banknote,
  CreditCard,
  PlaneLanding,
  PlaneTakeoff,
  Train,
  TrainFront,
} from 'lucide-react'
import { CATEGORY_ICON, BOOKING_ICON, type LucideIcon } from '../icons'
import { WHO_OPTIONS, type Booking, type ItineraryItem } from '../types'

/** itinerary_items.who is a new column (couple, or null for everyone); types.ts doesn't have it yet. */
// ItineraryItem carries `who` now; the alias keeps the plan code's name for it
export type PlanItem = ItineraryItem

/** One row of a day's timeline: a plan item, or a read-only booking moment (landing, check-in, a table...). */
export type Entry = {
  key: string
  time: string | null
  icon: LucideIcon
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
  return mode === 'mine' && !!mine && who === mine
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
// besides the arrows and dashes, a plain hyphen counts when spaced or between two airport codes ("NRT-TLV")
const ROUTE_SEP = /→|->|⟶|—|–|\s-\s|(?<=\b[A-Z]{3})-(?=[A-Z]{3}\b)/

function flightSide(title: string): 'from' | 'to' | null {
  const parts = title.split(ROUTE_SEP)
  if (parts.length < 2) return null
  const from = JAPAN.test(parts[0])
  const to = JAPAN.test(parts.slice(1).join(' '))
  return from === to ? null : from ? 'from' : 'to'
}

export type Airport = 'HND' | 'NRT'

/** The Tokyo airport a flight lands at, from its title/notes, falling back to the couple's known airport. */
export function arrivalAirport(b: Booking): Airport | null {
  const dest = b.title.split(ROUTE_SEP).slice(1).join(' ') || b.title
  const text = `${dest} ${b.notes ?? ''}`
  if (/\bHND\b|Haneda|הנדה/i.test(text)) return 'HND'
  if (/\bNRT\b|Narita|נריטה/i.test(text)) return 'NRT'
  return null
}

const OTHER_AIRPORT = /\b(KIX|ITM|NGO|FUK|CTS|OKA|UKB)\b|Kansai|Osaka|Itami|Nagoya|Fukuoka|Sapporo|Okinawa|קנסאי|אוסקה|נגויה|פוקואוקה|סאפורו|אוקינאווה/i

/**
 * The Tokyo airport to show an arrival card for: the one the booking names, else the couple's known airport.
 * null when the flight lands somewhere else in Japan (no Tokyo card), or when nothing says where.
 */
export function tokyoArrival(b: Booking): Airport | null {
  const named = arrivalAirport(b)
  if (named) return named
  const dest = b.title.split(ROUTE_SEP).slice(1).join(' ') || b.title
  if (OTHER_AIRPORT.test(`${dest} ${b.notes ?? ''}`)) return null
  return (b.who && COUPLE_AIRPORT[b.who]) || null
}

/** Bookings that happen on this date (YYYY-MM-DD), as timeline rows. Insurance has no moment, so it is left out. */
export function bookingEntries(bookings: Booking[], date: string): Entry[] {
  const out: Entry[] = []
  const add = (b: Booking, at: string | null, tag: string, icon: LucideIcon, location: string | null) => {
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
      if (side !== 'to') add(b, b.starts_at, 'dep', PlaneTakeoff, b.location)
      if (side !== 'from') add(b, b.ends_at, 'arr', PlaneLanding, null)
    } else if (b.kind === 'hotel') {
      add(b, b.starts_at, 'in', BedDouble, b.location || b.title)
      add(b, b.ends_at, 'out', BedDouble, null)
    } else {
      add(b, b.starts_at, 'at', BOOKING_ICON[b.kind] ?? BOOKING_ICON.other, b.location || b.title)
    }
  }
  return out
}
const tagLabel: Record<string, string> = { dep: 'המראה · ', arr: 'נחיתה · ', in: 'צ׳ק-אין · ', out: 'צ׳ק-אאוט · ' }

export function itemEntry(i: PlanItem): Entry {
  return {
    key: i.id,
    time: i.time ? i.time.slice(0, 5) : null,
    icon: CATEGORY_ICON[i.category] ?? CATEGORY_ICON.other,
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
  return [...own, ...bookingEntries(bookings, date)]
    .filter((e) => visible(e.who, mode, mine) || (mode === 'mine' && !!e.booking && staysWithUs(e.booking, bookings, mine)))
    .sort(byEntryTime)
}

const sameHotel = (a: Booking, b: Booking) => a.title.trim().toLowerCase() === b.title.trim().toLowerCase()
const overlap = (a: Booking, b: Booking) =>
  !!(a.starts_at && a.ends_at && b.starts_at && b.ends_at) && a.starts_at < b.ends_at && b.starts_at < a.ends_at

/**
 * Another couple's hotel stay that overlaps one of ours in the same hotel: we're there together, so it shows in
 * "שלנו" too, under its owner's name (two bookings because the dates differ).
 */
export function staysWithUs(b: Booking, bookings: Booking[], mine: string | null) {
  if (!mine || b.kind !== 'hotel' || !b.who || b.who === mine) return false
  return bookings.some((o) => o.kind === 'hotel' && o.who === mine && sameHotel(o, b) && overlap(o, b))
}

/** Hotel lines saved before the icon pass began with a pictograph; drop it. */
export const stripMarker = (line: string) => line.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '')

/** A day_info.hotel line like "שקד ומאור: Hotel X" (older ones carry a leading marker) belongs to that couple; any other line is for everyone. */
export function hotelLines(hotel: string | null, couples: string[]) {
  const names = couples.length ? couples : WHO_OPTIONS
  return (hotel ?? '')
    .split('\n')
    .map((l) => stripMarker(l.trim()))
    .filter(Boolean)
    .map((raw) => {
      const m = raw.match(/^([^:：]+?)\s*[:：]\s*(.+)$/)
      return m && names.includes(m[1].trim()) ? { who: m[1].trim(), text: m[2].trim() } : { who: null, text: raw }
    })
}

/** Hotel bookings covering the night of this date (YYYY-MM-DD): checked in on or before it, out after it. */
export function stayLines(bookings: Booking[], date: string) {
  return bookings
    .filter((b) => b.kind === 'hotel' && b.starts_at && b.ends_at && b.starts_at.slice(0, 10) <= date && date < b.ends_at.slice(0, 10))
    .map((b) => ({ who: b.who, text: b.title }))
}

/**
 * A night's hotels, read straight from the bookings so an edit or a deletion shows at once, plus any hotel typed on
 * the day by hand that no booking already names.
 */
export function nightLines(hotel: string | null, bookings: Booking[], date: string, couples: string[]) {
  const booked = stayLines(bookings, date)
  const titles = new Set(booked.map((l) => l.text))
  return [...booked, ...hotelLines(hotel, couples).filter((l) => !titles.has(l.text))]
}

/**
 * Each hotel once: both couples in the same hotel (two rooms, two bookings) is one line, named for a couple only when
 * it's that couple's alone.
 */
export function hotelNights(lines: { who: string | null; text: string }[]) {
  const out: { who: string | null; text: string }[] = []
  for (const l of lines) {
    const same = out.find((o) => o.text === l.text)
    if (!same) out.push({ ...l })
    else if (same.who !== l.who) same.who = null
  }
  return out
}

/** The hotel lines that apply to a couple: its own, or the shared ones when it has none. */
export function hotelFor(lines: { who: string | null; text: string }[], mine: string | null) {
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

export type ArrivalStep = { icon: LucideIcon; text: string }

const BORDER: ArrivalStep = { icon: BadgeCheck, text: 'ביקורת גבולות: Visit Japan Web (קודי QR) פתוח בטלפון.' }
const CARD: ArrivalStep = { icon: CreditCard, text: 'Suica או PASMO בארנק הטלפון (iPhone), או כרטיס Welcome Suica מהמכונות בטרמינל.' }
const CASH: ArrivalStep = { icon: Banknote, text: 'מזומן: למשוך ין בכספומט בשדה או בחנות נוחות (7-Eleven, Lawson).' }
const CHECKIN: ArrivalStep = { icon: BedDouble, text: 'צ׳ק-אין בדרך כלל מ-15:00. אפשר להשאיר מזוודות במלון.' }

/** First steps after landing, written per airport: Narita is far from Tokyo, Haneda is close. */
export const ARRIVAL: Record<Airport, { name: string; steps: ArrivalStep[] }> = {
  HND: {
    name: 'הנדה (HND)',
    steps: [
      BORDER,
      CARD,
      CASH,
      { icon: TrainFront, text: 'הנדה קרוב, כחצי שעה למרכז. רכבת קייקיו או המונורייל, ומשם ברכבת למלון.' },
      CHECKIN,
    ],
  },
  NRT: {
    name: 'נריטה (NRT)',
    steps: [
      BORDER,
      CARD,
      CASH,
      { icon: Train, text: 'נריטה רחוקה, שעה ויותר עד טוקיו. הכי נוח ב-Narita Express או ב-Keisei Skyliner, ומשם ברכבת למלון.' },
      CHECKIN,
    ],
  },
}

/** Fallback when the booking doesn't name its airport: where each couple is known to land. */
export const COUPLE_AIRPORT: Record<string, Airport> = { 'שקד ומאור': 'HND', 'אלמוג ושניר': 'NRT' }

/**
 * A couple's time in Japan from its flights: the date it lands to the date it flies out (YYYY-MM-DD), or null when
 * either end isn't booked. The group's flights (who null) count for every couple.
 */
export function stayInJapan(bookings: Booking[], who: string): { from: string; to: string } | null {
  const flights = bookings.filter((b) => b.kind === 'flight' && (!b.who || b.who === who))
  // only legs that actually land in or leave Japan (not the connection in Munich or Zurich)
  const lands = flights.flatMap((b) => (flightSide(b.title) === 'to' && b.ends_at ? [b.ends_at.slice(0, 10)] : []))
  const leaves = flights.flatMap((b) => (flightSide(b.title) === 'from' && b.starts_at ? [b.starts_at.slice(0, 10)] : []))
  if (!lands.length || !leaves.length) return null
  const from = lands.sort()[0]
  const to = leaves.sort().reverse()[0]
  return from < to ? { from, to } : null
}
