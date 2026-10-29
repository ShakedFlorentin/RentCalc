import { useEffect, useMemo, useRef, useState } from 'react'
import { Ban, CalendarDays, Heart, ListChecks, MapPin, Search as SearchIcon, Ticket } from 'lucide-react'
import { BOOKING_ICON, Icon, type LucideIcon } from '../icons'
import { BOOKING_TABS, CITY_HE, type Booking, type Candidate, type ChecklistItem, type ItineraryItem, type Member, type Place, type Swipe } from '../types'
import { cityLabel, dayDate, fmtDay, useTripTable } from '../lib'
import { t } from '../i18n'
import { Sheet } from '../ui'

/** Where a result leads: the screen that shows it. */
export type SearchTarget =
  | { tab: 'places' }
  | { tab: 'swipe'; vetoed?: string }
  | { tab: 'bookings' }
  | { tab: 'plan'; day: number }
  | { tab: 'lists' }

type Hit = { key: string; title: string; sub: string; icon: LucideIcon; to: SearchTarget }

// lower-case and drop Hebrew niqqud and geresh, so "ג׳" and "ג'" and "ג" find each other
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[֑-ׇ'׳"״`]/g, '') // he-only

/** Search across everything in the trip: places, the swipe deck, bookings, the day plan and the lists. */
export default function Search({
  tripId,
  start,
  members,
  onClose,
  onPick,
}: {
  tripId: string
  start: string | null
  members: Member[]
  onClose: () => void
  onPick: (to: SearchTarget) => void
}) {
  const [q, setQ] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const { rows: places } = useTripTable<Place>('places', tripId)
  const { rows: cards } = useTripTable<Candidate>('candidates', tripId)
  const { rows: swipes } = useTripTable<Swipe>('swipes', tripId)
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
        label: t('מקומות'),
        hits: places
          .filter((p) => has(p.name, p.city, cityLabel(p.city), p.area, p.notes))
          .map((p) => ({ key: 'p' + p.id, title: p.name, sub: [cityLabel(p.city), p.area].filter(Boolean).join(' · '), icon: MapPin, to: { tab: 'places' } })),
      },
      {
        label: t('גילוי'),
        hits: cards
          .filter((c) => has(c.name, c.name_ja, c.area, CITY_HE[c.city] ?? c.city, cityLabel(CITY_HE[c.city] ?? c.city), c.serves, c.todo, ...(c.dishes ?? [])))
          .map((c) => {
            // a card someone said no to says who, and opens the list of turned-down places
            const no = swipes
              .filter((s) => s.candidate_id === c.id && !s.liked)
              .map((s) => t(members.find((m) => m.user_id === s.user_id)?.display_name ?? '?'))
            const where = [cityLabel(CITY_HE[c.city] ?? c.city), c.area].filter(Boolean).join(' · ')
            return {
              key: 'c' + c.id,
              title: c.name,
              sub: no.length ? `${where} · ${t('אמרו לא: {names}', { names: no.join(', ') })}` : where,
              icon: no.length ? Ban : Heart,
              to: no.length ? { tab: 'swipe', vetoed: c.id } : { tab: 'swipe' },
            } satisfies Hit
          }),
      },
      {
        label: t('הזמנות'),
        hits: bookings
          .filter((b) => has(b.title, b.location, b.confirmation, b.notes, b.who))
          .map((b) => ({
            key: 'b' + b.id,
            title: b.title,
            sub: [BOOKING_TABS[b.kind] ?? b.kind, b.who && t(b.who)].filter(Boolean).join(' · '),
            icon: BOOKING_ICON[b.kind] ?? Ticket,
            to: { tab: 'bookings' },
          })),
      },
      {
        label: t('מסלול'),
        hits: items
          .filter((i) => has(i.title, i.location, i.notes))
          .map((i) => ({ key: 'i' + i.id, title: i.title, sub: `${fmtDay(dayDate(start, i.day)) || t('יום {day}', { day: i.day })}${i.time ? ` · ${i.time.slice(0, 5)}` : ''}`, icon: CalendarDays, to: { tab: 'plan', day: i.day } })),
      },
      {
        label: t('רשימות'),
        hits: todos
          .filter((todo) => has(todo.text, todo.assignee))
          .map((todo) => ({ key: 't' + todo.id, title: todo.text, sub: todo.done ? t('בוצע') : '', icon: ListChecks, to: { tab: 'lists' } })),
      },
    ]
    return out.filter((g) => g.hits.length)
  }, [q, places, cards, swipes, members, bookings, items, todos])

  return (
    <Sheet title={t('חיפוש')} onClose={onClose}>
      <label className="search-field">
        <Icon as={SearchIcon} />
        <input
          ref={input}
          type="search"
          enterKeyHint="search"
          placeholder={t('מקומות, הזמנות, מסלול ועוד')}
          aria-label={t('חיפוש בטיול')}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </label>
      {q.trim().length >= 2 && !groups.length && <p className="empty">{t('אין תוצאות ל"{q}"', { q: q.trim() })}</p>}
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
