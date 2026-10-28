import { Fragment, useEffect, useRef, useState } from 'react'
import { BedDouble, Check, CircleAlert, Navigation, Pencil, PlaneLanding, Plus, Users } from 'lucide-react'
import { supabase } from '../supabase'
import { CATEGORIES, TOGETHER, WHO_OPTIONS, type Booking, type DayInfo, type Member, type Place, type PlanSummary, type Trip } from '../types'
import { couplesOf, dayDate, keepRanges, dayOption, dayParts, fmtDayLong, mutate, replan, useTripTable } from '../lib'
import { Empty, Field, Sheet, useRemembered } from '../ui'
import { Icon } from '../icons'
import {
  ARRIVAL,
  dayEntries,
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

const MODES: Record<WhoMode, string> = { mine: 'שלנו', group: 'של כולם', all: 'הכל' }

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
  const stripRef = useRef<HTMLDivElement>(null)
  const summary = usePlanSummary(trip.id, items)

  useEffect(() => {
    stripRef.current?.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [day])

  const info = days.find((d) => d.day === day)
  const date = trip.start_date ? ymd(dayDate(trip.start_date, day)!) : ''
  const entries = dayEntries(items, bookings, day, date, mode, myCouple)
  // on a day with several owners, "הכל" reads as one section per owner (the group first)
  const owners = [...new Set(entries.map((e) => e.who))].sort((a, b) => (a ?? '').localeCompare(b ?? ''))
  const sections = mode === 'all' && owners.length > 1 ? owners : [undefined]
  const arrivals = entries.filter((e) => e.key.endsWith(':arr'))
  // a day only one couple is in Japan is that couple's plan by default
  const defaultWho = info?.who ?? null
  const warnings = new Map(summary?.warnings.map((w) => [w.item_id, w.text]))
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
              <span className="small">{days.find((x) => x.day === d)?.city ?? ''}</span>
            </button>
          )
        })}
      </div>

      <section className="card day-head" onClick={() => setEditDay(true)}>
        <div className="row spread">
          <h2>
            {trip.start_date ? fmtDayLong(dayDate(trip.start_date, day)) : `יום ${day}`} {info?.city ? `· ${info.city}` : ''}
          </h2>
          <Icon className="muted" as={Pencil} />
        </div>
        <div className={'who-tag' + (info?.who ? ' apart' : '')}>{info?.who ? (
            `רק ${info.who}`
          ) : (
            <>
              <Icon as={Users} /> {TOGETHER}
            </>
          )}
        </div>
        {hotelNights(nightLines(info?.hotel ?? null, bookings, date, couples).filter((l) => visible(l.who, mode, myCouple))).map((l) => (
          <div key={l.text}>
            <Icon as={BedDouble} /> {l.who && mode === 'all' && <span className="muted small">{l.who}: </span>}
            {l.text}
          </div>
        ))}
        {info?.notes && <div className="notes">{keepRanges(info.notes)}</div>}
      </section>

      {couples.length > 1 && (
        <div className="segmented" role="group" aria-label="של מי התוכנית">
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

      {entries.length === 0 && <Empty>אין תוכניות ליום הזה</Empty>}
      {sections.map((owner) => (
        <Fragment key={owner ?? 'all'}>
          {owner !== undefined && (
            <h3 className="plan-owner">
              {owner ? (
                owner
              ) : (
                <>
                  <Icon as={Users} /> {TOGETHER}
                </>
              )}
            </h3>
          )}
          {entries
            .filter((e) => owner === undefined || e.who === owner)
            .map((e) => (
              <EntryRow key={e.key} e={e} onEdit={setEditItem} warning={e.item && warnings.get(e.item.id)} />
            ))}
        </Fragment>
      ))}

      {spare.length > 0 && <Spare trip={trip} day={day} spare={spare} />}

      <button className="fab" aria-label="פעילות חדשה" onClick={() => setEditItem({ day, category: 'sight', who: defaultWho })}>
        <Plus size={28} strokeWidth={2} aria-hidden="true" />
      </button>

      {editItem && (
        <ItemForm tripId={trip.id} start={trip.start_date} numDays={trip.num_days} couples={couples} item={editItem} onClose={() => setEditItem(null)} />
      )}
      {editDay && (
        <DayForm
          tripId={trip.id}
          day={day}
          title={trip.start_date ? fmtDayLong(dayDate(trip.start_date, day)) : `יום ${day}`}
          info={info}
          onClose={() => setEditDay(false)}
        />
      )}
    </div>
  )
}

/** One line of the day: a plan item you can tick and edit, or a booking moment that is read-only here. */
function EntryRow({ e, onEdit, warning }: { e: Entry; onEdit: (i: PlanItem) => void; warning?: string }) {
  const i = e.item
  return (
    <div className={'item card' + (i ? '' : ' plan-booking') + (e.done ? ' done' : '')}>
      {i ? (
        <button
          className="check"
          aria-label="בוצע"
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
      <div className="item-body" onClick={i ? () => onEdit(i) : undefined} style={i ? undefined : { cursor: 'default' }}>
        <div className="item-title">
          {/* the planner's time is a rough guess: it shows as such until someone sets one */}
          {e.time && (i?.auto ? <span className="time approx" title="שעה משוערת">~{e.time}</span> : <span className="time">{e.time}</span>)}
          {e.title}
        </div>
        <div className="muted small">
          {i ? CATEGORIES[i.category] ?? i.category : 'הזמנה'}
          {e.who && <span className="who-pill">{e.who}</span>}
        </div>
        {/* the planner's notes are one short line (and a baby line when it matters); people's own notes can run long */}
        {e.sub && <div className={'notes' + (i?.auto ? ' plan-auto-notes' : ' plan-notes')}>{keepRanges(e.sub)}</div>}
        {warning && (
          <div className="plan-warn">
            <Icon as={CircleAlert} /> {warning}
          </div>
        )}
        {e.location && (
          <a className="action nav-btn" href={navUrl(e.location)} target="_blank" rel="noreferrer">
            <Icon as={Navigation} /> ניווט
          </a>
        )}
      </div>
    </div>
  )
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
function Spare({ trip, day, spare }: { trip: Trip; day: number; spare: PlanSummary['unplanned'] }) {
  const { rows: places } = useTripTable<Place>('places', trip.id)
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
        עוד {spare.length} מקומות שאהבתם בעיר ולא נכנסו למסלול
      </summary>
      <ul>
        {spare.map((u) => (
          <li key={u.place_id}>
            <span>
              <bdi>{u.name}</bdi>
              {u.who && <span className="who-pill">{u.who}</span>}
              {u.reason === 'closed' && <span className="muted small"> · סגור בימים האלה</span>}
            </span>
            <button className="action" onClick={() => add(u)}>
              <Icon as={Plus} /> ליום הזה
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
        <Icon as={PlaneLanding} /> נחיתה ב{a.name} · <span className="time">{entry.time}</span>
        {b.who && <span className="who-pill">{b.who}</span>}
      </summary>
      <ul>
        {a.steps.map((t) => (
          <li key={t.text}>
            <Icon as={t.icon} />
            <span>{t.text}</span>
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
    if (f.id && confirm('למחוק?') && (await mutate(supabase.from('itinerary_items').delete().eq('id', f.id))))
      props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכת פעילות' : 'פעילות חדשה'} onClose={props.onClose}>
      <Field label="מה עושים?">
        <input value={f.title ?? ''} onChange={set('title')} autoFocus />
      </Field>
      <div className="row">
        <Field label="שעה">
          <input type="time" value={f.time ?? ''} onChange={set('time')} />
        </Field>
        <Field label="יום">
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
        <Field label="של מי">
          <select value={f.who ?? ''} onChange={set('who')}>
            <option value="">{TOGETHER}</option>
            {[...new Set([...props.couples, ...(f.who ? [f.who] : [])])].map((c) => (
              <option key={c} value={c}>
                רק {c}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="סוג">
        <select value={f.category} onChange={set('category')}>
          {Object.entries(CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="מיקום (לחיפוש במפות)">
        <input value={f.location ?? ''} onChange={set('location')} dir="auto" />
      </Field>
      <Field label="הערות">
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={3} />
      </Field>
      <button className="primary" onClick={save}>
        שמירה
      </button>
      {f.id && (
        <button className="danger" onClick={remove}>
          מחיקה
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
      <Field label="עיר">
        <input value={city} onChange={(e) => setCity(e.target.value)} />
      </Field>
      <Field label="מי ביפן">
        <select value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">{TOGETHER}</option>
          {[...new Set([...WHO_OPTIONS, ...(who ? [who] : [])])].map((w) => (
            <option key={w} value={w}>
              רק {w}
            </option>
          ))}
        </select>
      </Field>
      <Field label="לינה">
        <input value={hotel} onChange={(e) => setHotel(e.target.value)} />
      </Field>
      <Field label="הערות ליום">
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
      </Field>
      <button className="primary" onClick={save}>
        שמירה
      </button>
    </Sheet>
  )
}
