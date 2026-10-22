import { useState } from 'react'
import { supabase } from '../supabase'
import { CATEGORIES, type Place, type Trip } from '../types'
import { mapsUrl, mutate, useTripTable } from '../lib'
import { Empty, Field, Sheet } from '../ui'

export default function Places({ trip, me }: { trip: Trip; me: string }) {
  const { rows, loading } = useTripTable<Place>('places', trip.id)
  const [city, setCity] = useState('')
  const [cat, setCat] = useState('')
  const [edit, setEdit] = useState<Partial<Place> | null>(null)
  const [planning, setPlanning] = useState<Place | null>(null)

  const cities = [...new Set(rows.map((p) => p.city).filter(Boolean))] as string[]
  const shown = rows
    .filter((p) => (!city || p.city === city) && (!cat || p.category === cat))
    .sort((a, b) => Number(a.visited) - Number(b.visited))

  return (
    <div className="stack">
      <p className="muted small">כל מה ששמעתם עליו ורוצים לנסות – מסעדות, אטרקציות, חנויות</p>
      <div className="chips scroll">
        <button className={'chip' + (!city ? ' on' : '')} onClick={() => setCity('')}>
          כל הערים
        </button>
        {cities.map((c) => (
          <button key={c} className={'chip' + (city === c ? ' on' : '')} onClick={() => setCity(c)}>
            {c}
          </button>
        ))}
      </div>
      <div className="chips scroll">
        <button className={'chip' + (!cat ? ' on' : '')} onClick={() => setCat('')}>
          הכל
        </button>
        {Object.entries(CATEGORIES).map(([k, v]) => (
          <button key={k} className={'chip' + (cat === k ? ' on' : '')} onClick={() => setCat(k)}>
            {v}
          </button>
        ))}
      </div>

      {!loading && shown.length === 0 && <Empty>אין מקומות ברשימה</Empty>}
      {shown.map((p) => (
        <div key={p.id} className={'item card' + (p.visited ? ' done' : '')}>
          <button
            className="check"
            aria-label="היינו"
            onClick={() => mutate(supabase.from('places').update({ visited: !p.visited }).eq('id', p.id))}
          >
            {p.visited ? '✓' : ''}
          </button>
          <div className="item-body" onClick={() => setEdit(p)}>
            <div className="item-title">{p.name}</div>
            <div className="muted small">
              {CATEGORIES[p.category]?.split(' ')[0]} {p.city}
              {p.added_by && ` · הוסיף/ה ${p.added_by}`}
            </div>
            {p.notes && <div className="notes">{p.notes}</div>}
          </div>
          <div className="col">
            <a className="icon" href={p.url || mapsUrl(p.name + ' ' + (p.city ?? ''))} target="_blank" rel="noreferrer">
              🗺️
            </a>
            <button className="icon" onClick={() => setPlanning(p)} aria-label="הוספה למסלול">
              🗓️
            </button>
          </div>
        </div>
      ))}

      <button className="fab" onClick={() => setEdit({ category: 'food', city: city || null })}>
        ＋
      </button>
      {edit && <PlaceForm tripId={trip.id} me={me} place={edit} onClose={() => setEdit(null)} />}
      {planning && <AddToDay trip={trip} place={planning} onClose={() => setPlanning(null)} />}
    </div>
  )
}

function PlaceForm(props: { tripId: string; me: string; place: Partial<Place>; onClose: () => void }) {
  const [f, setF] = useState<Partial<Place>>(props.place)
  const set = (k: keyof Place) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.name?.trim()) return
    const row = {
      trip_id: props.tripId,
      name: f.name.trim(),
      city: f.city || null,
      category: f.category ?? 'other',
      url: f.url || null,
      notes: f.notes || null,
    }
    const ok = await mutate(
      f.id
        ? supabase.from('places').update(row).eq('id', f.id)
        : supabase.from('places').insert({ ...row, added_by: props.me }),
    )
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (f.id && confirm('למחוק?') && (await mutate(supabase.from('places').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכת מקום' : 'מקום חדש'} onClose={props.onClose}>
      <Field label="שם">
        <input value={f.name ?? ''} onChange={set('name')} dir="auto" autoFocus />
      </Field>
      <div className="row">
        <Field label="עיר">
          <input value={f.city ?? ''} onChange={set('city')} list="cities" />
        </Field>
        <Field label="סוג">
          <select value={f.category} onChange={set('category')}>
            {Object.entries(CATEGORIES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <datalist id="cities">
        {['טוקיו', 'קיוטו', 'אוסקה', 'נארה', 'הקונה', 'ניקו', 'הירושימה'].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Field label="קישור (Google Maps / אתר / טיקטוק)">
        <input type="url" value={f.url ?? ''} onChange={set('url')} dir="ltr" />
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

function AddToDay(props: { trip: Trip; place: Place; onClose: () => void }) {
  const [day, setDay] = useState(1)
  const [time, setTime] = useState('')

  const add = async () => {
    const ok = await mutate(
      supabase.from('itinerary_items').insert({
        trip_id: props.trip.id,
        day,
        time: time || null,
        title: props.place.name,
        location: props.place.name + ' ' + (props.place.city ?? ''),
        notes: props.place.notes,
        category: props.place.category,
      }),
    )
    if (ok) props.onClose()
  }

  return (
    <Sheet title={`הוספת "${props.place.name}" למסלול`} onClose={props.onClose}>
      <div className="row">
        <Field label="יום">
          <select value={day} onChange={(e) => setDay(+e.target.value)}>
            {Array.from({ length: props.trip.num_days }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                יום {i + 1}
              </option>
            ))}
          </select>
        </Field>
        <Field label="שעה (לא חובה)">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
      </div>
      <button className="primary" onClick={add}>
        הוספה
      </button>
    </Sheet>
  )
}
