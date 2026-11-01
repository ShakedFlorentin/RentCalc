import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { BedDouble, Check, ChevronLeft, ChevronRight, CircleAlert, Footprints, Heart, MapPin, Navigation, Pencil, PlaneLanding, Plus, Route, Undo2, Users } from 'lucide-react'
import { supabase } from '../supabase'
import { CATEGORIES, CITY_HE, TOGETHER, WHO_OPTIONS, type Booking, type Candidate, type DayInfo, type Member, type Place, type PlanSummary, type Trip } from '../types'
import { cityLabel, couplesOf, currentDay, dayDate, keepRanges, dayOption, dayParts, fmtDayLong, mutate, replan, useMediaIndex, useTripTable, withMedia } from '../lib'
import { isEn, t } from '../i18n'
import { Empty, Field, Sheet, useRemembered } from '../ui'
import { CARD_ICON, Icon } from '../icons'
import { CardFull } from './Swipe'
import {
  ARRIVAL,
  dayEntries,
  hop,
  tokyoArrival,
  hotelNights,
  nightLines,
  navUrl,
  visible,
  ymd,
  type Entry,
  type PlanItem,
  type WhoMode,
} from './planUtils'
import '../styles/plan.css'

type Props = { trip: Trip; day: number; setDay: (d: number) => void; members?: Member[]; userId?: string }

const MODES: Record<WhoMode, string> = { mine: t('שלנו'), group: t('של כולם'), all: t('הכל') }

export default function Itinerary({ trip, day, setDay, members = [], userId }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<PlanItem>('itinerary_items', trip.id, 'sort')
  const { rows: bookings } = useTripTable<Booking>('bookings', trip.id, 'starts_at')
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // "שלנו" always includes the group's items, so nothing everyone does is ever hidden
  const [saved, setMode] = useRemembered('planWho', 'mine')
  const mode: WhoMode = saved === 'group' || saved === 'all' ? saved : 'mine'
  const [editItem, setEditItem] = useState<Partial<PlanItem> | null>(null)
  const [editDay, setEditDay] = useState(false)
  // the item whose sheet is open: what the place is and what else is around it
  const [openId, setOpenId] = useState<string | null>(null)
  const stripRef = useRef<HTMLDivElement>(null)
  const summary = usePlanSummary(trip.id, items)
  // the card behind a place item, with the same text and media the swipe game shows
  const { rows: places } = useTripTable<Place>('places', trip.id)
  const { rows: rawCards } = useTripTable<Candidate>('candidates', trip.id)
  const media = useMediaIndex()
  const cards = useMemo(() => rawCards.map((c) => withMedia(c, media)), [rawCards, media])
  const placeOf = (i?: PlanItem) => (i?.place_id ? places.find((p) => p.id === i.place_id) : undefined)
  const cardOf = (p?: Place) => (p?.candidate_id ? cards.find((c) => c.id === p.candidate_id) : undefined)
  /** Where a plan item is, from its place or that place's card; bookings and places without one have none. */
  const pointOf = (e: Entry) => {
    const p = placeOf(e.item)
    const c = cardOf(p)
    const lat = p?.lat ?? c?.lat
    const lng = p?.lng ?? c?.lng
    return lat != null && lng != null ? { lat, lng } : null
  }

  useEffect(() => {
    stripRef.current?.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [day])

  const info = days.find((d) => d.day === day)
  // a day that has passed: a place nobody ticked can go back to the planner for a day still ahead
  const today = currentDay(trip.start_date, trip.num_days)
  const past = today != null && day < today
  const missed = async (i: PlanItem) => {
    if (!(await mutate(supabase.from('itinerary_items').delete().eq('id', i.id)))) return
    // a new place to the planner again, not one somebody took out
    await mutate(supabase.from('places').update({ auto_planned: false }).eq('id', i.place_id!))
    replan(trip.id)
  }
  const date = trip.start_date ? ymd(dayDate(trip.start_date, day)!) : ''
  const entries = dayEntries(items, bookings, day, date, mode, myCouple)
  // on a day with several owners, "הכל" reads as one section per owner (the group first)
  const owners = [...new Set(entries.map((e) => e.who))].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
  const sections = mode === 'all' && owners.length > 1 ? owners : [undefined]
  const arrivals = entries.filter((e) => e.key.endsWith(':arr'))
  const opened = openId ? entries.find((e) => e.item?.id === openId) : undefined
  // a day only one couple is in Japan is that couple's plan by default
  const defaultWho = info?.who ?? null
  const warnings = new Map(summary?.warnings.map((w) => [w.item_id, warningText(w)]))
  // the planner's own items are keyed by place: what its final check found on them
  const issues = new Map(summary?.issues?.map((x) => [x.place_id, ISSUE[x.kind]]))
  // places you liked in today's city that didn't fit into any day: ready to swap in
  const dayCities = (info?.city ?? '').split(' / ').filter(Boolean)
  const spare = (summary?.unplanned ?? []).filter(
    (u) => (u.reason === 'full' || u.reason === 'closed') && !!u.city && dayCities.includes(u.city) && visible(u.who, mode, myCouple),
  )

  return (
    <div className="stack">
      <div className="day-strip" ref={stripRef}>
        {Array.from({ length: trip.num_days }, (_, i) => i + 1).map((d) => {
          // the date and weekday lead; the trip's day number only stands in when there is no start date
          const parts = dayParts(dayDate(trip.start_date, d))
          return (
            <button
              key={d}
              className={'day-chip' + (d === day ? ' active' : '') + (days.find((x) => x.day === d)?.who ? ' apart' : '')}
              onClick={() => setDay(d)}
            >
              <span className="day-chip-weekday">{parts?.weekday ?? ''}</span>
              <b>{parts?.date ?? d}</b>
              <span className="small">{cityLabel(days.find((x) => x.day === d)?.city)}</span>
            </button>
          )
        })}
      </div>

      <section className="card day-head" onClick={() => setEditDay(true)}>
        <div className="row spread">
          <h2>
            {trip.start_date ? fmtDayLong(dayDate(trip.start_date, day)) : t('יום {day}', { day })} {info?.city ? `· ${cityLabel(info.city)}` : ''}
          </h2>
          <Icon className="muted" as={Pencil} />
        </div>
        <div className={'who-tag' + (info?.who ? ' apart' : '')}>{info?.who ? (
            t('רק {who}', { who: t(info.who) })
          ) : (
            <>
              <Icon as={Users} /> {t(TOGETHER)}
            </>
          )}
        </div>
        {hotelNights(nightLines(info?.hotel ?? null, bookings, date, couples).filter((l) => visible(l.who, mode, myCouple))).map((l) => (
          <div key={l.text}>
            <Icon as={BedDouble} /> {l.who && mode === 'all' && <span className="muted small">{t(l.who)}: </span>}
            {l.text}
          </div>
        ))}
        {info?.notes && <div className="notes">{keepRanges(info.notes)}</div>}
      </section>

      {couples.length > 1 && (
        <div className="segmented" role="group" aria-label={t('של מי התוכנית')}>
          {(Object.keys(MODES) as WhoMode[]).map((m) => (
            <button key={m} className={mode === m ? 'on' : ''} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {MODES[m]}
            </button>
          ))}
        </div>
      )}

      {arrivals.map((e) => (
        <ArrivalCard key={e.key} entry={e} />
      ))}

      {entries.length === 0 && <Empty>{t('אין תוכניות ליום הזה')}</Empty>}
      {sections.map((owner) => (
        <Fragment key={owner ?? 'all'}>
          {owner !== undefined && (
            <h3 className="plan-owner">
              {owner ? (
                t(owner)
              ) : (
                <>
                  <Icon as={Users} /> {t(TOGETHER)}
                </>
              )}
            </h3>
          )}
          {entries
            .filter((e) => owner === undefined || e.who === owner)
            .map((e, n, list) => (
              <Fragment key={e.key}>
                {/* how far the next stop is, as the planner counted it */}
                {n > 0 && <Hop from={list[n - 1]} to={e} pointOf={pointOf} />}
                <EntryRow
                  e={e}
                  kind={cardOf(placeOf(e.item))?.serves}
                  onOpen={(i) => setOpenId(i.id)}
                  onEdit={setEditItem}
                  warning={e.item && (warnings.get(e.item.id) ?? (e.item.auto && e.item.place_id ? issues.get(e.item.place_id) : undefined))}
                  onMissed={past && e.item?.place_id && !e.item.done ? missed : undefined}
                />
              </Fragment>
            ))}
        </Fragment>
      ))}

      {spare.length > 0 && <Spare trip={trip} day={day} spare={spare} places={places} />}

      <button className="fab" aria-label={t('פעילות חדשה')} onClick={() => setEditItem({ day, category: 'sight', who: defaultWho })}>
        <Plus size={28} strokeWidth={2} aria-hidden="true" />
      </button>

      {opened && (
        <ItemSheet
          e={opened}
          place={placeOf(opened.item)}
          card={cardOf(placeOf(opened.item))}
          cards={cards}
          places={places}
          onEdit={(i) => {
            setOpenId(null)
            setEditItem(i)
          }}
          onClose={() => setOpenId(null)}
        />
      )}
      {editItem && (
        <ItemForm tripId={trip.id} start={trip.start_date} numDays={trip.num_days} couples={couples} item={editItem} onClose={() => setEditItem(null)} />
      )}
      {editDay && (
        <DayForm
          tripId={trip.id}
          day={day}
          title={trip.start_date ? fmtDayLong(dayDate(trip.start_date, day)) : t('יום {day}', { day })}
          info={info}
          onClose={() => setEditDay(false)}
        />
      )}
    </div>
  )
}

/** One line of the day: a plan item you can tick, open and edit, or a booking moment that is read-only here. */
function EntryRow(props: {
  e: Entry
  /** what the card says it serves: "food" alone doesn't tell a cake shop from a ramen counter */
  kind?: string | null
  onOpen: (i: PlanItem) => void
  onEdit: (i: PlanItem) => void
  warning?: string
  onMissed?: (i: PlanItem) => void
}) {
  const { e, kind, onOpen, onEdit, warning, onMissed } = props
  const i = e.item
  return (
    <div className={'item card' + (i ? '' : ' plan-booking') + (e.done ? ' done' : '')}>
      {i ? (
        <button
          className="check"
          aria-label={t('בוצע')}
          aria-pressed={i.done}
          onClick={() => mutate(supabase.from('itinerary_items').update({ done: !i.done }).eq('id', i.id))}
        >
          {i.done && <Check size="1em" strokeWidth={3} aria-hidden="true" />}
        </button>
      ) : (
        <span className="plan-icon" aria-hidden="true">
          <Icon as={e.icon} size="1.375rem" />
        </span>
      )}
      <div className="item-body" onClick={i ? () => onOpen(i) : undefined} style={i ? undefined : { cursor: 'default' }}>
        <div className="item-title">
          {/* the planner's time is a rough guess: it shows as such until someone sets one */}
          {e.time && (i?.auto ? <span className="time approx" title={t('שעה משוערת')}>~{e.time}</span> : <span className="time">{e.time}</span>)}
          {e.title}
        </div>
        <div className="muted small plan-meta">
          <span className="plan-kind">
            {i ? CATEGORIES[i.category] ?? i.category : t('הזמנה')}
            {kind && <> · {keepRanges(firstSentence(kind))}</>}
          </span>
          {e.who && <span className="who-pill">{t(e.who)}</span>}
        </div>
        {/* the planner's notes are one short line (and a baby line when it matters); people's own notes can run long */}
        {e.sub && <div className={'notes' + (i?.auto ? ' plan-auto-notes' : ' plan-notes')}>{keepRanges(e.sub)}</div>}
        {warning && (
          <div className="plan-warn">
            <Icon as={CircleAlert} /> {warning}
          </div>
        )}
        {(e.location || i) && (
          <div className="item-actions">
            {e.location && <NavLink to={e.location} />}
            {i && (
              <button
                className="action"
                onClick={(ev) => {
                  ev.stopPropagation()
                  onEdit(i)
                }}
              >
                <Icon as={Pencil} /> {t('עריכה')}
              </button>
            )}
            {i && onMissed && (
              <button
                className="action"
                onClick={(ev) => {
                  ev.stopPropagation()
                  onMissed(i)
                }}
              >
                <Icon as={Undo2} /> {t('לא הגענו')}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

type Point = { lat: number; lng: number }
const at = (p: Point) => `${p.lat},${p.lng}`

/**
 * The way between two stops in a row, as a range of minutes: on foot nearby, a ride further (train, bus or taxi).
 * A tap opens the real route from the one to the other in Google Maps.
 */
function Hop({ from, to, pointOf }: { from: Entry; to: Entry; pointOf: (e: Entry) => Point | null }) {
  const a = pointOf(from)
  const b = pointOf(to)
  const h = a && b ? hop(a, b) : null
  if (!a || !b || !h) return null
  // kept left to right, or Hebrew turns 5–10 into 10–5
  const range = `\u2066${h.from}–${h.to}\u2069`
  // the names Maps knows the places by; the coordinates when a stop has none
  const url = navUrl(to.location || at(b), from.location || at(a), h.walk ? 'walking' : 'transit')
  return (
    <a className="plan-hop muted small" href={url} target="_blank" rel="noreferrer">
      <Icon as={h.walk ? Footprints : Route} /> {h.walk ? t('{range} דק׳ הליכה', { range }) : t('{range} דק׳ נסיעה', { range })}
      <Icon as={ChevronLeft} className="plan-hop-go flip-ltr" />
    </a>
  )
}

/** Directions to a plan item; a tap here leaves the row alone (the row opens its sheet). */
function NavLink({ to }: { to: string }) {
  return (
    <a className="action nav-btn" href={navUrl(to)} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
      <Icon as={Navigation} /> {t('ניווט')}
    </a>
  )
}

type Near = { key: string; name: string; line: string | null; icon: Entry['icon']; mins: number | null; liked: boolean; card?: Candidate }

/**
 * A plan item opened: the place's card and what else there is around it (liked places first, then the rest of the
 * deck), or for a hand-written activity its own notes. A nearby card opens in the same sheet.
 */
function ItemSheet(props: {
  e: Entry
  place?: Place
  card?: Candidate
  cards: Candidate[]
  places: Place[]
  onEdit: (i: PlanItem) => void
  onClose: () => void
}) {
  const { e, place, card, cards, places } = props
  const i = e.item!
  const [peek, setPeek] = useState<Candidate | null>(null)
  const top = useRef<HTMLDivElement>(null)
  const nearRef = useRef<HTMLElement>(null)
  // a nearby card (and the way back) starts at its top, not where the list was scrolled to
  useEffect(() => {
    top.current?.closest('.sheet-body')?.scrollTo(0, 0)
  }, [peek])
  const near = useMemo(() => nearby(card, place, cards, places), [card, place, cards, places])
  const where = (c: { city: string | null; area: string | null }) =>
    [cityLabel(c.city ? CITY_HE[c.city] ?? c.city : null), c.area].filter(Boolean).join(' · ')

  if (peek)
    return (
      <Sheet title={peek.name} onClose={props.onClose}>
        <div ref={top} className="card-full">
          <button className="link plan-back" onClick={() => setPeek(null)}>
            <Icon as={ChevronRight} className="flip-ltr" /> {t('חזרה')} · <bdi>{e.title}</bdi>
          </button>
          <div className="muted small">{where(peek)}</div>
          <CardFull c={peek} />
        </div>
      </Sheet>
    )

  return (
    <Sheet title={e.title} onClose={props.onClose}>
      <div ref={top} className="card-full">
        <div className="muted small">
          {[e.time, CATEGORIES[i.category] ?? i.category, where(card ?? place ?? { city: null, area: null })].filter(Boolean).join(' · ')}
        </div>
        <div className="item-actions">
          {e.location && <NavLink to={e.location} />}
          <button className="action" onClick={() => props.onEdit(i)}>
            <Icon as={Pencil} /> {t('עריכה')}
          </button>
          {/* the card can run long: what is around it is one tap away, not a long scroll */}
          {near.length > 0 && (
            <button className="action" onClick={() => nearRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <Icon as={MapPin} /> {near.length === 1 ? t('מקום אחד באזור') : t('{n} מקומות באזור', { n: near.length })}
            </button>
          )}
        </div>
        {e.sub && <p className={'notes' + (i.auto ? ' plan-auto-notes' : '')}>{keepRanges(e.sub)}</p>}
        {card ? (
          <CardFull c={card} />
        ) : (
          place?.notes && place.notes !== e.sub && <p dir="auto">{keepRanges(place.notes)}</p>
        )}
        {!card && !place?.notes && !e.sub && <p className="muted">{t('אין הערות. אפשר להוסיף בעריכה.')}</p>}
      </div>
      {near.length > 0 && (
        <section className="plan-near" ref={nearRef}>
          <h3>{t('מה עוד יש באזור')}</h3>
          <div className="card list-card">
            {near.map((n) => {
              const body = (
                <>
                  <Icon as={n.icon} />
                  <span className="plan-near-text">
                    <b dir="auto">
                      {n.name}
                      {n.liked && <Icon as={Heart} className="plan-near-liked" label={t('ברשימה שלכם')} />}
                    </b>
                    {n.line && <span className="muted small">{keepRanges(n.line)}</span>}
                  </span>
                  {n.mins != null && <span className="muted small plan-near-mins">{t('{n} דק׳ הליכה', { n: n.mins })}</span>}
                </>
              )
              return n.card ? (
                <button key={n.key} className="plan-near-row" onClick={() => setPeek(n.card!)}>
                  {body}
                </button>
              ) : (
                <div key={n.key} className="plan-near-row">
                  {body}
                </div>
              )
            })}
          </div>
        </section>
      )}
    </Sheet>
  )
}

/** Within this, as the crow flies, a place counts as "around here" even in another area name. */
const NEAR_METERS = 1200

/** Liked places and cards around a place: within NEAR_METERS, or in the same area when a side has no coordinates. */
function nearby(card: Candidate | undefined, place: Place | undefined, cards: Candidate[], places: Place[]): Near[] {
  const at = card ?? place
  if (!at) return []
  // cards keep the city as a key ("tokyo"), places in Hebrew: compare in Hebrew
  const cityOf = (c: string | null) => (c ? CITY_HE[c] ?? c : '')
  const here = { lat: at.lat, lng: at.lng, area: norm(at.area), city: cityOf(at.city) }
  const liked = new Set(places.map((p) => p.candidate_id).filter(Boolean))
  const close = (o: { lat: number | null; lng: number | null; area: string | null; city: string | null }) => {
    const m = here.lat != null && here.lng != null && o.lat != null && o.lng != null ? meters(here.lat, here.lng, o.lat, o.lng) : null
    // coordinates decide when both sides have them: an area name can be loose; without them, the same area counts
    const ok = m != null ? m <= NEAR_METERS : !!here.area && norm(o.area) === here.area && cityOf(o.city) === here.city
    // ~80 m a minute, and streets are about a third longer than the straight line
    return ok ? { mins: m == null ? null : Math.max(1, Math.round((m * 1.3) / 80)) } : null
  }
  const out: Near[] = []
  for (const c of cards) {
    if (c.id === card?.id || c.id === place?.candidate_id) continue
    const n = close(c)
    if (n) out.push({ key: c.id, name: c.name, line: whatItIs(c), icon: CARD_ICON[c.category] ?? CARD_ICON.sight, liked: liked.has(c.id), card: c, ...n })
  }
  // places someone added by hand have no card: they still belong on the list
  for (const p of places) {
    if (p.candidate_id || p.id === place?.id) continue
    const n = close(p)
    if (n) out.push({ key: p.id, name: p.name, line: p.notes ? firstSentence(p.notes) : null, icon: CARD_ICON[p.category] ?? CARD_ICON.sight, liked: true, ...n })
  }
  return out.sort((a, b) => Number(b.liked) - Number(a.liked) || (a.mins ?? 99) - (b.mins ?? 99)).slice(0, 8)
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()

/** Great-circle distance in meters. */
function meters(lat1: number, lng1: number, lat2: number, lng2: number) {
  const r = Math.PI / 180
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

/** A card in one line: what it serves, or what you do there. */
function whatItIs(c: Candidate) {
  const s = c.serves || c.todo || c.special || c.plan_line
  return s ? firstSentence(s) : null
}

/** The first sentence of a card's text; the row cuts it further with an ellipsis. */
function firstSentence(s: string) {
  return s.split(/(?<=[.!?])\s/)[0].replace(/\.$/, '').trim()
}

/** The planner's last word on the trip; refreshed whenever the plan changes, and the planner asked to run once a visit. */
function usePlanSummary(tripId: string, items: PlanItem[]) {
  const [summary, setSummary] = useState<PlanSummary | null>(null)
  useEffect(() => {
    // once per visit: it also runs after every swipe and booking, this catches anything that slipped by
    const key = 'replanned:' + tripId
    try {
      if (sessionStorage.getItem(key)) return
      sessionStorage.setItem(key, '1')
    } catch {
      // no session storage: ask anyway
    }
    replan(tripId)
  }, [tripId])
  useEffect(() => {
    supabase
      .from('plan_state')
      .select('summary')
      .eq('trip_id', tripId)
      .maybeSingle()
      .then(({ data }) => data?.summary && setSummary(data.summary as PlanSummary))
  }, [tripId, items])
  return summary
}

/** Liked places in this city that the plan had no room for (or that are closed on its days), each one tap from today. */
function Spare({ trip, day, spare, places }: { trip: Trip; day: number; spare: PlanSummary['unplanned']; places: Place[] }) {
  const add = async (u: PlanSummary['unplanned'][number]) => {
    const p = places.find((x) => x.id === u.place_id)
    await mutate(
      supabase.from('itinerary_items').insert({
        trip_id: trip.id,
        day,
        title: u.name,
        // a stand-in: the database puts the card's address here (trigger itinerary_item_address)
        location: [u.name, p?.area, p?.city].filter(Boolean).join(', '),
        category: p?.category ?? 'sight',
        place_id: u.place_id,
        who: u.who,
      }),
    )
  }
  return (
    <details className="card spare">
      <summary>
        {spare.length === 1
          ? t('עוד מקום אחד שאהבתם בעיר ולא נכנס למסלול')
          : t('עוד {n} מקומות שאהבתם בעיר ולא נכנסו למסלול', { n: spare.length })}
      </summary>
      <ul>
        {spare.map((u) => (
          <li key={u.place_id}>
            <span>
              <bdi>{u.name}</bdi>
              {u.who && <span className="who-pill">{t(u.who)}</span>}
              {u.reason === 'closed' && <span className="muted small"> · {t('סגור בימים האלה')}</span>}
            </span>
            <button className="action" onClick={() => add(u)}>
              <Icon as={Plus} /> {t('ליום הזה')}
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}

function ArrivalCard({ entry }: { entry: Entry }) {
  const b = entry.booking!
  const airport = tokyoArrival(b)
  if (!airport) return null
  const a = ARRIVAL[airport]
  return (
    <details className="card arrival" open>
      <summary>
        <Icon as={PlaneLanding} /> {t('נחיתה ב{airport}', { airport: a.name })} · <span className="time">{entry.time}</span>
        {b.who && <span className="who-pill">{t(b.who)}</span>}
      </summary>
      <ul>
        {a.steps.map((s) => (
          <li key={s.text}>
            <Icon as={s.icon} />
            <span>{s.text}</span>
          </li>
        ))}
      </ul>
    </details>
  )
}

function ItemForm(props: { tripId: string; start: string | null; numDays: number; couples: string[]; item: Partial<PlanItem>; onClose: () => void }) {
  const [f, setF] = useState<Partial<PlanItem>>(props.item)
  const set = (k: keyof PlanItem) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.title?.trim()) return
    const row = {
      trip_id: props.tripId,
      day: Number(f.day),
      time: f.time || null,
      title: f.title.trim(),
      location: f.location || null,
      notes: f.notes || null,
      category: f.category ?? 'sight',
      who: f.who || null,
    }
    const ok = await mutate(
      f.id ? supabase.from('itinerary_items').update(row).eq('id', f.id) : supabase.from('itinerary_items').insert(row),
    )
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (f.id && confirm(t('למחוק?')) && (await mutate(supabase.from('itinerary_items').delete().eq('id', f.id))))
      props.onClose()
  }

  return (
    <Sheet title={f.id ? t('עריכת פעילות') : t('פעילות חדשה')} onClose={props.onClose}>
      <Field label={t('מה עושים?')}>
        <input value={f.title ?? ''} onChange={set('title')} autoFocus />
      </Field>
      <div className="row">
        <Field label={t('שעה')}>
          <input type="time" value={f.time ?? ''} onChange={set('time')} />
        </Field>
        <Field label={t('יום')}>
          <select value={f.day} onChange={set('day')}>
            {Array.from({ length: props.numDays }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {dayOption(props.start, i + 1)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {props.couples.length > 0 && (
        <Field label={t('של מי')}>
          <select value={f.who ?? ''} onChange={set('who')}>
            <option value="">{t(TOGETHER)}</option>
            {[...new Set([...props.couples, ...(f.who ? [f.who] : [])])].map((c) => (
              <option key={c} value={c}>
                {t('רק {who}', { who: t(c) })}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('סוג')}>
        <select value={f.category} onChange={set('category')}>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('מיקום (לחיפוש במפות)')}>
        <input value={f.location ?? ''} onChange={set('location')} dir="auto" />
      </Field>
      <Field label={t('הערות')}>
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={3} />
      </Field>
      <button className="primary" onClick={save}>
        {t('שמירה')}
      </button>
      {f.id && (
        <button className="danger" onClick={remove}>
          {t('מחיקה')}
        </button>
      )}
    </Sheet>
  )
}

function DayForm(props: { tripId: string; day: number; title: string; info?: DayInfo; onClose: () => void }) {
  const [city, setCity] = useState(props.info?.city ?? '')
  const [hotel, setHotel] = useState(props.info?.hotel ?? '')
  const [notes, setNotes] = useState(props.info?.notes ?? '')
  const [who, setWho] = useState(props.info?.who ?? '')

  const save = async () => {
    const ok = await mutate(
      supabase.from('day_info').upsert({
        trip_id: props.tripId,
        day: props.day,
        city: city || null,
        hotel: hotel || null,
        notes: notes || null,
        who: who || null,
      }),
    )
    if (ok) props.onClose()
  }

  return (
    <Sheet title={props.title} onClose={props.onClose}>
      <Field label={t('עיר')}>
        <input value={city} onChange={(e) => setCity(e.target.value)} />
      </Field>
      <Field label={t('מי ביפן')}>
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{t(TOGETHER)}</option>
          {[...new Set([...WHO_OPTIONS, ...(who ? [who] : [])])].map((w) => (
            <option key={w} value={w}>
              {t('רק {who}', { who: t(w) })}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t('לינה')}>
        <input value={hotel} onChange={(e) => setHotel(e.target.value)} />
      </Field>
      <Field label={t('הערות ליום')}>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>
      <button className="primary" onClick={save}>
        {t('שמירה')}
      </button>
    </Sheet>
  )
}

/** A planner warning in the app's language: the Hebrew text, or English words built from what it found. */
const ISSUE: Record<NonNullable<PlanSummary['issues']>[number]['kind'], string> = {
  overlap: t('חופף לתוכנית אחרת'),
  tight: t('אין מספיק זמן להגיע לכאן מהקודם'),
  hours: t('מחוץ לשעות הפתיחה'),
  meals: t('קרוב מדי לארוחה הקודמת'),
}

function warningText(w: PlanSummary['warnings'][number]) {
  if (!isEn || !w.kind) return w.text
  if (w.kind === 'closed_date') return 'Closed on this date'
  if (w.kind === 'closed_weekday') return `Closed on ${new Date(Date.UTC(2026, 10, 1 + (w.weekday ?? 0))).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })}s`
  return `Open only ${w.opens}–${w.closes}`
}
