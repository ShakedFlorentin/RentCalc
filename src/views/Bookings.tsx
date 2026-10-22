import { useState } from 'react'
import { supabase } from '../supabase'
import { BOOKING_KINDS, TOGETHER, type Booking, type Member, type Trip } from '../types'
import { couplesOf, fmtDateTime, fromInputDateTime, mapsUrl, mutate, toInputDateTime, useTripTable } from '../lib'
import { Empty, Field, Sheet } from '../ui'

type Props = { trip: Trip; members: Member[]; userId: string }

export default function Bookings({ trip, members, userId }: Props) {
  const tripId = trip.id
  const [importing, setImporting] = useState(false)
  const { rows, loading } = useTripTable<Booking>('bookings', tripId, 'starts_at')
  const [edit, setEdit] = useState<Partial<Booking> | null>(null)
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // '' = everything, 'group' = the whole group's bookings, or a couple's name (their own plus the group's)
  const [whose, setWhose] = useState('')
  const shown = rows.filter((b) => !whose || (whose === 'group' ? !b.who : !b.who || b.who === whose))
  // one section per booking kind, in the order of BOOKING_KINDS; rows are already sorted by start time
  const sections = Object.keys(BOOKING_KINDS)
    .map((k) => ({
      kind: k,
      // each couple's bookings together (the group's first), by time within each
      items: shown
        .filter((b) => (BOOKING_KINDS[b.kind] ? b.kind : 'other') === k)
        .sort((a, b) => (a.who ?? '').localeCompare(b.who ?? '')),
    }))
    .filter((s) => s.items.length)

  return (
    <div className="stack">
      <p className="muted small">טיסות, מלונות, כרטיסים ומסמכים – הכל במקום אחד. השעות הן לפי השעון המקומי במקום.</p>
      <button className="secondary" onClick={() => setImporting(true)}>
        📩 הוספה מאישור הזמנה (מייל / PDF / צילום מסך)
      </button>
      {couples.length > 1 && (
        <div className="chips scroll">
          <button className={'chip' + (!whose ? ' on' : '')} onClick={() => setWhose('')}>
            הכל
          </button>
          {couples.map((c) => (
            <button key={c} className={'chip' + (whose === c ? ' on' : '')} onClick={() => setWhose(c)}>
              💑 {c}
            </button>
          ))}
          <button className={'chip' + (whose === 'group' ? ' on' : '')} onClick={() => setWhose('group')}>
            👥 של כולם
          </button>
        </div>
      )}
      {!loading && rows.length === 0 && <Empty>עוד אין הזמנות. לחצו על ＋ כדי להוסיף</Empty>}
      {sections.map((s) => (
        <section key={s.kind} className="stack">
          <h2 className="group-title">
            {BOOKING_KINDS[s.kind]} <span className="muted small">{s.items.length}</span>
          </h2>
          {s.items.map((b) => (
            <div key={b.id} className="card booking" onClick={() => setEdit(b)}>
              <div className="row spread">
                <b>{BOOKING_KINDS[b.kind]?.split(' ')[0]} {b.title}</b>
                {b.file_path && <span title="קובץ מצורף">📎</span>}
              </div>
              {couples.length > 1 && <div className={'who-tag' + (b.who ? ' apart' : '')}>{b.who ? `💑 ${b.who}` : `👥 ${TOGETHER}`}</div>}
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
        </section>
      ))}
      <button className="fab" aria-label="הזמנה חדשה" onClick={() => setEdit({ kind: 'flight' })}>
        ＋
      </button>
      {edit && <BookingForm tripId={tripId} couples={couples} booking={edit} onClose={() => setEdit(null)} />}
      {importing && <ImportSheet trip={trip} couples={couples} myCouple={myCouple} onClose={() => setImporting(false)} />}
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

function BookingForm(props: { tripId: string; couples: string[]; booking: Partial<Booking>; onClose: () => void }) {
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
      who: f.who || null,
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
      {props.couples.length > 1 && <WhoField value={f.who ?? ''} couples={props.couples} onChange={(who) => setF({ ...f, who })} />}
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

type Extracted = Pick<Booking, 'kind' | 'title' | 'starts_at' | 'ends_at' | 'confirmation' | 'location' | 'url' | 'notes'>

/** Paste a confirmation email or attach its PDF/screenshot; Claude reads it and the bookings are added. */
function ImportSheet(props: { trip: Trip; couples: string[]; myCouple: string | null; onClose: () => void }) {
  const { trip, onClose } = props
  // a confirmation usually covers one couple, so start from the importer's
  const [who, setWho] = useState(props.myCouple ?? '')
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string[] | null>(null)
  const [err, setErr] = useState('')

  const run = async () => {
    if (!text.trim() && !file) return
    setBusy(true)
    setErr('')
    const payload: { text: string; file?: { data: string; media_type: string } } = { text }
    if (file) payload.file = { data: await toBase64(file), media_type: file.type }
    const { data, error } = await supabase.functions.invoke('parse-booking', { body: payload })
    if (error || !data?.bookings) {
      setErr('לא הצלחתי לקרוא את האישור. אפשר לנסות שוב או להוסיף ידנית.')
      setBusy(false)
      return
    }
    const bookings = data.bookings as Extracted[]
    if (!bookings.length) {
      setErr('לא מצאתי הזמנה בטקסט הזה.')
      setBusy(false)
      return
    }

    // keep the original confirmation with the booking
    let filePath: string | null = null
    if (file) {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      filePath = `${trip.id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('docs').upload(filePath, file, { contentType: file.type })
      if (up.error) filePath = null
    }
    const ok = await mutate(
      supabase.from('bookings').insert(
        bookings.map((b) => ({
          trip_id: trip.id,
          ...b,
          starts_at: b.starts_at ? fromInputDateTime(b.starts_at.slice(0, 16)) : null,
          ends_at: b.ends_at ? fromInputDateTime(b.ends_at.slice(0, 16)) : null,
          file_path: filePath,
          who: who || null,
        })),
      ),
    )
    if (ok) {
      await fillHotelNights(trip, bookings)
      setDone(bookings.map((b) => `${BOOKING_KINDS[b.kind]?.split(' ')[0] ?? ''} ${b.title}`))
    }
    setBusy(false)
  }

  if (done) {
    return (
      <Sheet title="נוסף! ✅" onClose={onClose}>
        {done.map((d) => (
          <div key={d} dir="auto">
            {d}
          </div>
        ))}
        <p className="muted small">אפשר ללחוץ על הזמנה כדי לתקן פרטים. מלונות נכתבו גם בלילות שלהם במסלול.</p>
        <button className="primary" onClick={onClose}>
          סגירה
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title="הוספה מאישור הזמנה" onClose={onClose}>
      <p className="muted small">
        מדביקים את המייל של האישור (Booking, Agoda, חברת תעופה…) או מצרפים PDF / צילום מסך. Claude קורא את הפרטים
        וההזמנה נוספת אוטומטית.
      </p>
      {props.couples.length > 1 && <WhoField value={who} couples={props.couples} onChange={setWho} />}
      <Field label="טקסט האישור">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} dir="auto" placeholder="להדביק כאן…" />
      </Field>
      <Field label="או קובץ">
        <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </Field>
      {err && <p className="msg">{err}</p>}
      <button className="primary" onClick={run} disabled={busy || (!text.trim() && !file)}>
        {busy ? 'קורא את האישור…' : 'קריאה והוספה'}
      </button>
    </Sheet>
  )
}

function WhoField(props: { value: string; couples: string[]; onChange: (who: string) => void }) {
  return (
    <Field label="של מי">
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">👥 של כולם</option>
        {props.couples.map((c) => (
          <option key={c} value={c}>
            💑 {c}
          </option>
        ))}
      </select>
    </Field>
  )
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}

/** Write each hotel's name on the trip days it covers (needs the trip start date). */
async function fillHotelNights(trip: Trip, bookings: Extracted[]) {
  if (!trip.start_date) return
  const day1 = Date.parse(trip.start_date + 'T00:00:00Z')
  const rows: { trip_id: string; day: number; hotel: string }[] = []
  for (const b of bookings) {
    if (b.kind !== 'hotel' || !b.starts_at || !b.ends_at) continue
    const first = Math.round((Date.parse(b.starts_at.slice(0, 10) + 'T00:00:00Z') - day1) / 86400000) + 1
    const last = Math.round((Date.parse(b.ends_at.slice(0, 10) + 'T00:00:00Z') - day1) / 86400000)
    for (let d = Math.max(first, 1); d <= Math.min(last, trip.num_days); d++) rows.push({ trip_id: trip.id, day: d, hotel: b.title })
  }
  if (rows.length) await supabase.from('day_info').upsert(rows)
}
