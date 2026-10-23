export type Trip = {
  id: string
  name: string
  start_date: string | null
  num_days: number
  join_code: string
  match_threshold: number
  /** shekels per yen, for showing yen expenses in shekels */
  ils_per_jpy: number
}

export type Member = { trip_id: string; user_id: string; display_name: string; couple: string | null }

export type DayInfo = {
  trip_id: string
  day: number
  city: string | null
  hotel: string | null
  notes: string | null
  /** who is in Japan that day; null means the whole group */
  who: string | null
}

export const TOGETHER = 'כולם ביחד'
export const WHO_OPTIONS = ['שקד ומאור', 'אלמוג ושניר']

export type ItineraryItem = {
  id: string
  trip_id: string
  day: number
  time: string | null
  title: string
  location: string | null
  notes: string | null
  category: string
  done: boolean
  sort: number
  place_id?: string | null
  /** whose plan it is: a couple, or null for everyone */
  who?: string | null
}

/** Must-have info: hotel addresses in Japanese, phone numbers, insurance, documents. */
export type Essential = {
  id: string
  trip_id: string
  kind: 'hotel' | 'phone' | 'insurance' | 'document' | 'note' | 'other'
  title: string
  value: string | null
  /** a couple's, or null for everyone */
  who: string | null
  sort: number
}

/**
 * A shared expense split equally among `split_among` (user ids), or a settlement: `paid_by` paid the one person in
 * `split_among` back.
 */
export type Expense = {
  id: string
  trip_id: string
  kind: 'expense' | 'settlement'
  title: string
  amount: number
  currency: 'JPY' | 'ILS'
  paid_by: string
  split_among: string[]
  category: string | null
  spent_on: string
  created_by: string | null
  created_at: string
}

export type Booking = {
  id: string
  trip_id: string
  kind: string
  title: string
  starts_at: string | null
  ends_at: string | null
  confirmation: string | null
  location: string | null
  url: string | null
  notes: string | null
  file_path: string | null
  /** whose booking this is; null means the whole group */
  who: string | null
}

export type Place = {
  id: string
  trip_id: string
  city: string | null
  name: string
  category: string
  url: string | null
  notes: string | null
  visited: boolean
  added_by: string | null
  candidate_id: string | null
  area: string | null
  lat: number | null
  lng: number | null
  verdict: string | null
  audience: string | null
  instagram_url?: string | null
  tiktok_url?: string | null
  photos?: string[] | null
  /** whose list it is on: a couple, or null for the whole group */
  who?: string | null
}

export type ChecklistItem = {
  id: string
  trip_id: string
  list: string
  text: string
  assignee: string | null
  done: boolean
}

export const CATEGORIES: Record<string, string> = {
  sight: 'אטרקציה',
  food: 'אוכל',
  shopping: 'קניות',
  transport: 'תחבורה',
  other: 'אחר',
}

export const BOOKING_KINDS: Record<string, string> = {
  flight: 'טיסה',
  hotel: 'מלון',
  restaurant: 'מסעדה',
  train: 'רכבת',
  activity: 'כרטיס / אטרקציה',
  insurance: 'ביטוח',
  other: 'אחר',
}

/** Tabs on the bookings screen, one per kind; the first four always show, the rest only when they have bookings. */
export const BOOKING_TABS: Record<string, string> = {
  flight: 'טיסות',
  hotel: 'מלונות',
  restaurant: 'מסעדות',
  activity: 'אטרקציות',
  train: 'רכבות',
  insurance: 'ביטוח',
  other: 'אחר',
}

export type Candidate = {
  id: string
  trip_id: string
  name: string
  /** what a restaurant, cafe or bar serves, in Hebrew */
  serves?: string | null
  dishes?: string[] | null
  /** for an attraction: what you do there, what is special about it, what not to miss, and how long it takes */
  todo?: string | null
  special?: string | null
  highlights?: string[] | null
  time_needed?: string | null
  /** for food, cafes and bars: how easy it is to eat there without pork or seafood, and what to order */
  kosher?: 'friendly' | 'options' | 'hard' | null
  kosher_note?: string | null
  name_ja: string | null
  city: string
  area: string | null
  category: string
  lat: number | null
  lng: number | null
  hype: string | null
  reality: string | null
  verdict: string | null
  tabelog_score: number | null
  google_score: number | null
  price: string | null
  tip: string | null
  sources: string[]
  added_by: string | null
  audience: string | null
  baby_notes: string | null
  local_pick: boolean
  maps_url?: string | null
  website_url?: string | null
  instagram_url?: string | null
  tiktok_url?: string | null
  photos?: string[] | null
}

export type Swipe = { trip_id: string; candidate_id: string; user_id: string; liked: boolean; created_at: string }

export const CITY_HE: Record<string, string> = {
  tokyo: 'טוקיו',
  kyoto: 'קיוטו',
  osaka: 'אוסקה',
  nara: 'נארה',
  daytrip: 'טיולי יום',
}

/** Card label and the flat colour behind a card that has no photo (icons are in icons.tsx). */
export const CARD_STYLE: Record<string, { label: string; bg: string }> = {
  food: { label: 'אוכל', bg: '#8c3b2e' },
  cafe: { label: 'קפה וקינוחים', bg: '#4d6b4f' },
  sight: { label: 'אטרקציה', bg: '#5a4a72' },
  shopping: { label: 'קניות', bg: '#8a6a2f' },
  nightlife: { label: 'חיי לילה', bg: '#2f3349' },
  experience: { label: 'חוויה', bg: '#3e6577' },
}

export const VERDICTS: Record<string, { label: string; tone: string }> = {
  gem: { label: 'פנינה נסתרת', tone: 'good' },
  worth_it: { label: 'שווה את ההייפ', tone: 'good' },
  overhyped: { label: 'מוגזם ברשתות', tone: 'meh' },
  trap: { label: 'מלכודת תיירים', tone: 'bad' },
}

// no place in Japan is certified, so these describe eating without pork or seafood
export const KOSHER: Record<string, { label: string; tone: string }> = {
  friendly: { label: 'ידידותי לכשרות', tone: 'good' },
  options: { label: 'יש אפשרויות כשרות', tone: 'meh' },
  hard: { label: 'קשה לשומרי כשרות', tone: 'bad' },
}

export const AUDIENCES: Record<string, string> = {
  baby: 'עם התינוק',
  adults: 'ערב מבוגרים',
}
