import { useState } from 'react'
import { supabase } from '../supabase'
import { BOOKING_KINDS, type Booking } from '../types'
import { fmtDateTime, fromInputDateTime, mapsUrl, mutate, toInputDateTime, useTripTable } from '../lib'
import { Empty, Field, Sheet } from '../ui'

export default function Bookings({ tripId }: { tripId: string }) {
  const { rows, loading } = useTripTable<Booking>('bookings', tripId, 'starts_at')
  const [edit, setEdit] = useState<Partial<Booking> | null>(null)

  return (
    <div className="stack">
      <p className="muted small">טיסות, מלונות, כרטיסים ומסמכים – הכל במקום אחד. השעות הן לפי השעון המקומי במקום.</p>
      {!loading && rows.length === 0 && <Empty>עוד אין הזמנות. לחצו על ＋ כדי להוסיף</Empty>}
      {rows.map((b) => (
        <div key={b.id} className="card booking" onClick={() => setEdit(b)}>
          <div className="row spread">
            <b>{BOOKING_KINDS[b.kind]?.split(' ')[0]} {b.title}</b>
            {b.file_path && <span title="קובץ מצורף">📎</span>}
          </div>
          {b.starts_at && (
            <div className="muted small">
              {fmtDateTime(b.starts_at)}
              {b.ends_at && ` ← ${fmtDateTime(b.ends_at)}`}
            </div>
          )}
          {b.confirmation && (
            <div className="small">
              אישור: <b className="code" dir="ltr">{b.confirmation}</b>
            </div>
          )}
          <div className="row" onClick={(e) => e.stopPropagation()}>
            {b.location && (
              <a className="pill" href={mapsUrl(b.location)} target="_blank" rel="noreferrer">
                🗺️ מפה
              </a>
            )}
            {b.url && (
              <a className="pill" href={b.url} target="_blank" rel="noreferrer">
                🔗 קישור
              </a>
            )}
            {b.file_path && (
              <button className="pill" onClick={() => openFile(b.file_path!)}>
                📎 מסמך
              </button>
            )}
          </div>
        </div>
      ))}
      <button className="fab" aria-label="הזמנה חדשה" onClick={() => setEdit({ kind: 'flight' })}>
        ＋
      </button>
      {edit && <BookingForm tripId={tripId} booking={edit} onClose={() => setEdit(null)} />}
    </div>
  )
}

async function openFile(path: string) {
  // open the tab synchronously so mobile popup blockers allow it
  const win = window.open('', '_blank')
  const { data, error } = await supabase.storage.from('docs').createSignedUrl(path, 600)
  if (error || !data) {
    win?.close()
    alert('לא ניתן לפתוח את הקובץ')
  } else if (win) win.location.href = data.signedUrl
  else location.href = data.signedUrl
}

function BookingForm(props: { tripId: string; booking: Partial<Booking>; onClose: () => void }) {
  const [f, setF] = useState<Partial<Booking>>(props.booking)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (k: keyof Booking) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  const save = async () => {
    if (!f.title?.trim()) return
    setBusy(true)
    let filePath = f.file_path ?? null
    if (file) {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      const path = `${props.tripId}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('docs').upload(path, file, { contentType: file.type })
      if (error) {
        alert('העלאת הקובץ נכשלה: ' + error.message)
        setBusy(false)
        return
      }
      if (filePath) await supabase.storage.from('docs').remove([filePath])
      filePath = path
    }
    const row = {
      trip_id: props.tripId,
      kind: f.kind ?? 'other',
      title: f.title.trim(),
      starts_at: f.starts_at || null,
      ends_at: f.ends_at || null,
      confirmation: f.confirmation || null,
      location: f.location || null,
      url: f.url || null,
      notes: f.notes || null,
      file_path: filePath,
    }
    const ok = await mutate(
      f.id ? supabase.from('bookings').update(row).eq('id', f.id) : supabase.from('bookings').insert(row),
    )
    setBusy(false)
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (!f.id || !confirm('למחוק את ההזמנה?')) return
    if (f.file_path) await supabase.storage.from('docs').remove([f.file_path])
    if (await mutate(supabase.from('bookings').delete().eq('id', f.id))) props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכת הזמנה' : 'הזמנה חדשה'} onClose={props.onClose}>
      <Field label="סוג">
        <select value={f.kind} onChange={set('kind')}>
          {Object.entries(BOOKING_KINDS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="כותרת">
        <input value={f.title ?? ''} onChange={set('title')} placeholder="למשל: אל על TLV → NRT" />
      </Field>
      <Field label="התחלה / צ׳ק-אין / המראה">
        <input
          type="datetime-local"
          value={toInputDateTime(f.starts_at ?? null)}
          onChange={(e) => setF({ ...f, starts_at: fromInputDateTime(e.target.value) })}
        />
      </Field>
      <Field label="סיום / צ׳ק-אאוט / נחיתה">
        <input
          type="datetime-local"
          value={toInputDateTime(f.ends_at ?? null)}
          onChange={(e) => setF({ ...f, ends_at: fromInputDateTime(e.target.value) })}
        />
      </Field>
      <Field label="מספר אישור">
        <input value={f.confirmation ?? ''} onChange={set('confirmation')} dir="ltr" />
      </Field>
      <Field label="כתובת / מיקום">
        <input value={f.location ?? ''} onChange={set('location')} dir="auto" />
      </Field>
      <Field label="קישור">
        <input type="url" value={f.url ?? ''} onChange={set('url')} dir="ltr" />
      </Field>
      <Field label="הערות">
        <textarea value={f.notes ?? ''} onChange={set('notes')} rows={3} />
      </Field>
      <Field label={f.file_path ? 'החלפת מסמך (PDF / תמונה)' : 'מסמך מצורף (PDF / תמונה)'}>
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      <button className="primary" onClick={save} disabled={busy}>
        {busy ? 'שומר…' : 'שמירה'}
      </button>
      {f.id && (
        <button className="danger" onClick={remove}>
          מחיקה
        </button>
      )}
    </Sheet>
  )
}
