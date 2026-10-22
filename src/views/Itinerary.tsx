import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { CATEGORIES, TOGETHER, WHO_OPTIONS, type DayInfo, type ItineraryItem, type Trip } from '../types'
import { dayDate, fmtDay, mapsUrl, mutate, useTripTable } from '../lib'
import { Empty, Field, Sheet } from '../ui'
import { byTime } from './Home'

type Props = { trip: Trip; day: number; setDay: (d: number) => void }

export default function Itinerary({ trip, day, setDay }: Props) {
  const { rows: days } = useTripTable<DayInfo>('day_info', trip.id, 'day')
  const { rows: items } = useTripTable<ItineraryItem>('itinerary_items', trip.id, 'sort')
  const [editItem, setEditItem] = useState<Partial<ItineraryItem> | null>(null)
  const [editDay, setEditDay] = useState(false)
  const stripRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    stripRef.current?.querySelector('.active')?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [day])

  const info = days.find((d) => d.day === day)
  const dayItems = items.filter((i) => i.day === day).sort(byTime)

  return (
    <div className="stack">
      <div className="day-strip" ref={stripRef}>
        {Array.from({ length: trip.num_days }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            className={'day-chip' + (d === day ? ' active' : '') + (days.find((x) => x.day === d)?.who ? ' apart' : '')}
            onClick={() => setDay(d)}
          >
            <b>{d}</b>
            <span>{days.find((x) => x.day === d)?.city ?? ''}</span>
            <span className="small">{fmtDay(dayDate(trip.start_date, d))}</span>
          </button>
        ))}
      </div>

      <section className="card day-head" onClick={() => setEditDay(true)}>
        <div className="row spread">
          <h2>
            יום {day} {info?.city ? `· ${info.city}` : ''}
          </h2>
          <span className="muted small">✏️</span>
        </div>
        {trip.start_date && <div className="muted">{fmtDay(dayDate(trip.start_date, day))}</div>}
        <div className={'who-tag' + (info?.who ? ' apart' : '')}>{info?.who ? `👤 רק ${info.who}` : `👥 ${TOGETHER}`}</div>
        {info?.hotel && <div style={{ whiteSpace: 'pre-line' }}>🏨 {info.hotel}</div>}
        {info?.notes && <div className="notes">{info.notes}</div>}
      </section>

      {dayItems.length === 0 && <Empty>אין עדיין תוכניות ליום הזה</Empty>}
      {dayItems.map((i) => (
        <div key={i.id} className={'item card' + (i.done ? ' done' : '')}>
          <button
            className="check"
            aria-label="בוצע"
            onClick={() => mutate(supabase.from('itinerary_items').update({ done: !i.done }).eq('id', i.id))}
          >
            {i.done ? '✓' : ''}
          </button>
          <div className="item-body" onClick={() => setEditItem(i)}>
            <div className="item-title">
              {i.time && <span className="time">{i.time}</span>}
              {i.title}
            </div>
            <div className="muted small">{CATEGORIES[i.category] ?? i.category}</div>
            {i.notes && <div className="notes">{i.notes}</div>}
          </div>
          {i.location && (
            <a className="icon" href={mapsUrl(i.location)} target="_blank" rel="noreferrer" aria-label="מפה">
              🗺️
            </a>
          )}
        </div>
      ))}

      <button className="fab" aria-label="פעילות חדשה" onClick={() => setEditItem({ day, category: 'sight' })}>
        ＋
      </button>

      {editItem && (
        <ItemForm tripId={trip.id} numDays={trip.num_days} item={editItem} onClose={() => setEditItem(null)} />
      )}
      {editDay && <DayForm tripId={trip.id} day={day} info={info} onClose={() => setEditDay(false)} />}
    </div>
  )
}

function ItemForm(props: { tripId: string; numDays: number; item: Partial<ItineraryItem>; onClose: () => void }) {
  const [f, setF] = useState<Partial<ItineraryItem>>(props.item)
  const set = (k: keyof ItineraryItem) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

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
                יום {i + 1}
              </option>
            ))}
          </select>
        </Field>
      </div>
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

function DayForm(props: { tripId: string; day: number; info?: DayInfo; onClose: () => void }) {
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
    <Sheet title={`יום ${props.day}`} onClose={props.onClose}>
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
