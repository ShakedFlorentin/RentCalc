export type Trip = {
  id: string
  name: string
  start_date: string | null
  num_days: number
  join_code: string
}

export type Member = { trip_id: string; user_id: string; display_name: string }

export type DayInfo = {
  trip_id: string
  day: number
  city: string | null
  hotel: string | null
  notes: string | null
}

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
  train: '🚄 רכבת',
  activity: '🎟️ כרטיס / אטרקציה',
  insurance: '🛡️ ביטוח',
  other: '📄 אחר',
}
