import { t } from './i18n'

export type Trip = {
  id: string
  name: string
  start_date: string | null
  num_days: number
  join_code: string
  match_threshold: number
  /** shekels per yen, for showing yen expenses in shekels */
  ils_per_jpy: number
  /** how shared expenses are settled: between couples, or each person separately. Set in the backend only */
  settle_by?: 'couples' | 'people'
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

export const TOGETHER = 'כולם ביחד' // he-only: stored and compared; shown through t(TOGETHER)
export const WHO_OPTIONS = ['שקד ומאור', 'אלמוג ושניר'] // he-only: couple names are stored as keys

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
  /** put there by the planner and not touched since: its time is a rough guess and it may still move */
  auto?: boolean
  /** the planner's note in English (notes is the Hebrew) */
  notes_en?: string | null
}

/** What the planner (plan-trip) last said about the trip: places it left out, and plan items that clash with opening days. */
export type PlanSummary = {
  unplanned: { place_id: string; name: string; reason: 'waiting' | 'full' | 'closed' | 'no_day'; who: string | null; city?: string | null }[]
  // text is the Hebrew; kind (and weekday or hours) lets the app word it in English
  warnings: { item_id: string; text: string; kind?: 'closed_date' | 'closed_weekday' | 'hours'; weekday?: number; opens?: string; closes?: string }[]
  facts_pending: number
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
  /** a couple's own item (packing); null = the whole trip's */
  couple?: string | null
  /** every couple does it separately (an entry form, insurance): done per couple in done_couples */
  each?: boolean
  done_couples?: string[]
}

/** Whether an item is done as far as this couple is concerned. */
export function itemDone(i: ChecklistItem, couple: string | null) {
  return i.each ? !!couple && (i.done_couples ?? []).includes(couple) : i.done
}

export const CATEGORIES: Record<string, string> = {
  sight: t('אטרקציה'),
  food: t('אוכל'),
  shopping: t('קניות'),
  transport: t('תחבורה'),
  other: t('אחר'),
}

export const BOOKING_KINDS: Record<string, string> = {
  flight: t('טיסה'),
  hotel: t('מלון'),
  restaurant: t('מסעדה'),
  train: t('רכבת'),
  activity: t('כרטיס / אטרקציה'),
  insurance: t('ביטוח'),
  other: t('אחר'),
}

/** Tabs on the bookings screen, one per kind; the first four always show, the rest only when they have bookings. */
export const BOOKING_TABS: Record<string, string> = {
  flight: t('טיסות'),
  hotel: t('מלונות'),
  restaurant: t('מסעדות'),
  activity: t('אטרקציות'),
  train: t('רכבות'),
  insurance: t('ביטוח'),
  other: t('אחר'),
}

/** A place from a published guide map (e.g. the Ptitim blog's Tokyo map), shown as an optional map layer. */
export type GuidePlace = {
  id: number
  source: string
  folder: string
  name: string
  note: string | null
  lat: number
  lng: number
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
  /** the card's text in English, shown when the app is in English */
  en?: CardText | null
} & PlanFacts

/** The card text fields, as kept in English in `en` (same keys as the Hebrew columns). */
export type CardText = Partial<{
  hype: string | null
  reality: string | null
  tip: string | null
  baby_notes: string | null
  price: string | null
  serves: string | null
  dishes: string[] | null
  todo: string | null
  special: string | null
  highlights: string[] | null
  time_needed: string | null
  kosher_note: string | null
  plan_line: string | null
  baby_block: string | null
}>

/**
 * What the trip planner needs about a place, carried by the card (library → trip copy) so planning needs no lookup:
 * usual hours ("HH:MM"), weekly closing days (0 = Sunday), closed dates in the trip, best time of day, visit length,
 * booking, one short Hebrew line for the plan, and a Hebrew line only when something blocks a visit with the baby.
 * facts_at is the day they were checked; null = never (the planner then goes by the card's kind and time_needed).
 */
export type PlanFacts = {
  /** the street address people navigate to (coordinates stay in the backend, for distances) */
  address?: string | null
  /** search words, never shown: what it sells, what kind of place, synonyms in Hebrew and English */
  tags?: string[] | null
  opens?: string | null
  closes?: string | null
  closed_weekdays?: number[] | null
  closed_dates?: string[] | null
  /** runs only on these dates (a market, an event); empty = no such limit */
  open_dates?: string[] | null
  best_time?: 'morning' | 'midday' | 'afternoon' | 'evening' | 'night' | 'any' | null
  visit_mins?: number | null
  booking?: 'required' | 'recommended' | 'no' | null
  plan_line?: string | null
  baby_block?: string | null
  facts_at?: string | null
  /** true: confirmed from a source; false: estimated */
  facts_sure?: boolean | null
}

export type Swipe = { trip_id: string; candidate_id: string; user_id: string; liked: boolean; created_at: string }

export const CITY_HE: Record<string, string> = {
  tokyo: 'טוקיו', // he-only
  kyoto: 'קיוטו', // he-only
  osaka: 'אוסקה', // he-only
  nara: 'נארה', // he-only
  daytrip: 'טיולי יום', // he-only
}

/** Card label and the flat colour behind a card that has no photo (icons are in icons.tsx). */
export const CARD_STYLE: Record<string, { label: string; bg: string }> = {
  food: { label: t('אוכל'), bg: '#8c3b2e' },
  cafe: { label: t('קפה וקינוחים'), bg: '#4d6b4f' },
  sight: { label: t('אטרקציה'), bg: '#5a4a72' },
  shopping: { label: t('קניות'), bg: '#8a6a2f' },
  nightlife: { label: t('חיי לילה'), bg: '#2f3349' },
  experience: { label: t('פעילות'), bg: '#3e6577' },
}

export const VERDICTS: Record<string, { label: string; tone: string }> = {
  gem: { label: t('תגלית'), tone: 'good' },
  worth_it: { label: t('שווה את ההייפ'), tone: 'good' },
  overhyped: { label: t('מוגזם ברשתות'), tone: 'meh' },
  trap: { label: t('מלכודת תיירים'), tone: 'bad' },
}

// no place in Japan is certified, so these describe eating without pork or seafood
export const KOSHER: Record<string, { label: string; tone: string }> = {
  friendly: { label: t('קל לשומרי כשרות'), tone: 'good' },
  options: { label: t('יש אפשרויות כשרות'), tone: 'meh' },
  hard: { label: t('קשה לשומרי כשרות'), tone: 'bad' },
}

export const AUDIENCES: Record<string, string> = {
  baby: t('עם התינוק'),
  adults: t('ערב מבוגרים'),
}

/** A problem someone reported from the app; status and reply are set from the backend when it's handled. */
export type Report = {
  id: string
  trip_id: string
  user_id: string
  reporter: string | null
  body: string
  screen: string | null
  app_version: string | null
  device: string | null
  status: 'open' | 'fixed' | 'wontfix'
  reply: string | null
  created_at: string
  resolved_at: string | null
}
