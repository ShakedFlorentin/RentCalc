export type Trip = {
  id: string
  name: string
  start_date: string | null
  num_days: number
  join_code: string
  match_threshold: number
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
  sight: '⛩️ אטרקציה',
  food: '🍜 אוכל',
  shopping: '🛍️ קניות',
  transport: '🚄 תחבורה',
  other: '📌 אחר',
}

export const BOOKING_KINDS: Record<string, string> = {
  flight: '✈️ טיסה',
  hotel: '🏨 מלון',
  restaurant: '🍽️ מסעדה',
  train: '🚄 רכבת',
  activity: '🎟️ כרטיס / אטרקציה',
  insurance: '🛡️ ביטוח',
  other: '📄 אחר',
}

/** Tabs on the bookings screen, one per kind; the first three always show, the rest only when they have bookings. */
export const BOOKING_TABS: Record<string, string> = {
  flight: '✈️ טיסות',
  hotel: '🏨 מלונות',
  restaurant: '🍽️ מסעדות',
  train: '🚄 רכבות',
  activity: '🎟️ אטרקציות',
  insurance: '🛡️ ביטוח',
  other: '📄 אחר',
}

export type Candidate = {
  id: string
  trip_id: string
  name: string
  /** what a restaurant, cafe or bar serves, in Hebrew */
  serves?: string | null
  dishes?: string[] | null
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

export const CARD_STYLE: Record<string, { emoji: string; label: string; bg: string }> = {
  food: { emoji: '🍜', label: 'אוכל', bg: 'linear-gradient(135deg,#ff8a5b,#d7263d)' },
  cafe: { emoji: '🍵', label: 'קפה וקינוחים', bg: 'linear-gradient(135deg,#9bc27a,#3f7d5a)' },
  sight: { emoji: '⛩️', label: 'אטרקציה', bg: 'linear-gradient(135deg,#ff5f6d,#8e2de2)' },
  shopping: { emoji: '🛍️', label: 'קניות', bg: 'linear-gradient(135deg,#f7b733,#fc4a1a)' },
  nightlife: { emoji: '🍶', label: 'חיי לילה', bg: 'linear-gradient(135deg,#4b3f9e,#151032)' },
  experience: { emoji: '🎌', label: 'חוויה', bg: 'linear-gradient(135deg,#36d1dc,#5b86e5)' },
}

export const VERDICTS: Record<string, { label: string; tone: string }> = {
  gem: { label: '💎 פנינה נסתרת', tone: 'good' },
  worth_it: { label: '👍 שווה את ההייפ', tone: 'good' },
  overhyped: { label: '😐 מוגזם ברשתות', tone: 'meh' },
  trap: { label: '🚨 מלכודת תיירים', tone: 'bad' },
}

export const AUDIENCES: Record<string, string> = {
  baby: '👶 עם התינוק',
  adults: '🍸 ערב מבוגרים',
}
