import { useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, Heart, ListChecks, MapPin, Search as SearchIcon, Ticket } from 'lucide-react'
import { BOOKING_ICON, Icon, type LucideIcon } from '../icons'
import { BOOKING_TABS, CITY_HE, type Booking, type Candidate, type ChecklistItem, type ItineraryItem, type Place } from '../types'
import { dayDate, fmtDay, useTripTable } from '../lib'
import { Sheet } from '../ui'

/** Where a result leads: the screen that shows it. */
export type SearchTarget =
  | { tab: 'places' }
  | { tab: 'swipe' }
  | { tab: 'bookings' }
  | { tab: 'plan'; day: number }
  | { tab: 'lists' }

type Hit = { key: string; title: string; sub: string; icon: LucideIcon; to: SearchTarget }

// lower-case and drop Hebrew niqqud and geresh, so "ג׳" and "ג'" and "ג" find each other
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[֑-ׇ'׳"״`]/g, '')

/** Search across everything in the trip: places, the swipe deck, bookings, the day plan and the lists. */
export default function Search({
  tripId,
  start,
  onClose,
  onPick,
}: {
  tripId: string
  start: string | null
  onClose: () => void
  onPick: (to: SearchTarget) => void
}) {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const { rows: places } = useTripTable<Place>('places', tripId)
  const { rows: cards } = useTripTable<Candidate>('candidates', tripId)
  const { rows: bookings } = useTripTable<Booking>('bookings', tripId, 'starts_at')
  const { rows: items } = useTripTable<ItineraryItem>('itinerary_items', tripId, 'sort')
  const { rows: todos } = useTripTable<ChecklistItem>('checklist_items', tripId)
  // the sheet takes focus when it opens; hand it to the field right after
  useEffect(() => {
    const t = setTimeout(() => input.current?.focus(), 60)
    return () => clearTimeout(t)
  }, [])

  const groups = useMemo(() => {
    const term = norm(q.trim())
    if (term.length < 2) return []
    const has = (...fields: (string | null | undefined)[]) => fields.some((f) => norm(f).includes(term))
    const out: { label: string; hits: Hit[] }[] = [
      {
        label: 'מקומות',
        hits: places
          .filter((p) => has(p.name, p.city, p.area, p.notes))
          .map((p) => ({ key: 'p' + p.id, title: p.name, sub: [p.city, p.area].filter(Boolean).join(' · '), icon: MapPin, to: { tab: 'places' } })),
      },
      {
        label: 'גילוי',
        hits: cards
          .filter((c) => has(c.name, c.name_ja, c.area, CITY_HE[c.city] ?? c.city, c.serves, c.todo, ...(c.dishes ?? [])))
          .map((c) => ({ key: 'c' + c.id, title: c.name, sub: [CITY_HE[c.city] ?? c.city, c.area].filter(Boolean).join(' · '), icon: Heart, to: { tab: 'swipe' } })),
      },
      {
        label: 'הזמנות',
        hits: bookings
          .filter((b) => has(b.title, b.location, b.confirmation, b.notes, b.who))
          .map((b) => ({
            key: 'b' + b.id,
            title: b.title,
            sub: [BOOKING_TABS[b.kind] ?? b.kind, b.who].filter(Boolean).join(' · '),
            icon: BOOKING_ICON[b.kind] ?? Ticket,
            to: { tab: 'bookings' },
          })),
      },
      {
        label: 'מסלול',
        hits: items
          .filter((i) => has(i.title, i.location, i.notes))
          .map((i) => ({ key: 'i' + i.id, title: i.title, sub: `${fmtDay(dayDate(start, i.day)) || `יום ${i.day}`}${i.time ? ` · ${i.time.slice(0, 5)}` : ''}`, icon: CalendarDays, to: { tab: 'plan', day: i.day } })),
      },
      {
        label: 'רשימות',
        hits: todos
          .filter((t) => has(t.text, t.assignee))
          .map((t) => ({ key: 't' + t.id, title: t.text, sub: t.done ? 'בוצע' : '', icon: ListChecks, to: { tab: 'lists' } })),
      },
    ]
    return out.filter((g) => g.hits.length)
  }, [q, places, cards, bookings, items, todos])

  return (
    <Sheet title="חיפוש" onClose={onClose}>
      <label className="search-field">
        <Icon as={SearchIcon} />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          placeholder="מקומות, הזמנות, מסלול ועוד"
          aria-label="חיפוש בטיול"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {q.trim().length >= 2 && !groups.length && <p className="empty">אין תוצאות ל"{q.trim()}"</p>}
      {groups.map((g) => (
        <section key={g.label} className="search-group">
          <h3>{g.label}</h3>
          <div className="card list-card">
            {g.hits.slice(0, 20).map((h) => (
              <button key={h.key} className="search-row" onClick={() => onPick(h.to)}>
                <span className="tile neutral">
                  <Icon as={h.icon} />
                </span>
                <span className="search-text">
                  <b dir="auto">{h.title}</b>
                  {h.sub && <span className="muted small" dir="auto">{h.sub}</span>}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </Sheet>
  )
}
