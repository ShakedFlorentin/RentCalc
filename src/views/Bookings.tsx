import { Fragment, useEffect, useState } from 'react'
import { supabase } from '../supabase'
import { BOOKING_KINDS, BOOKING_TABS, TOGETHER, type Booking, type Member, type Trip } from '../types'
import { aiError, couplesOf, fmtDateTime, fromInputDateTime, mapsUrl, mutate, toInputDateTime, useTripTable } from '../lib'
import { Empty, Field, LoadNote, Sheet, Tabs, useRemembered } from '../ui'

type Props = { trip: Trip; members: Member[]; userId: string }

export default function Bookings({ trip, members, userId }: Props) {
  const tripId = trip.id
  const [importing, setImporting] = useState(false)
  const { rows, loading, error, reload } = useTripTable<Booking>('bookings', tripId, 'starts_at')
  const [edit, setEdit] = useState<Partial<Booking> | null>(null)
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null
  // '' = everything, 'group' = the whole group's bookings, or a couple's name (their own plus the group's)
  const [whose, setWhose] = useState('')
  const shown = rows.filter((b) => !whose || (whose === 'group' ? !b.who : !b.who || b.who === whose))
  const kindOf = (b: Booking) => (BOOKING_TABS[b.kind] ? b.kind : 'other')
  const count = (k: string) => shown.filter((b) => kindOf(b) === k).length
  const tabs = Object.keys(BOOKING_TABS).filter((k, i) => i < 4 || rows.some((b) => kindOf(b) === k))
  const [tab, pick] = useRemembered('bookingsTab', 'flight')
  const current = tabs.includes(tab) ? tab : 'flight'
  // rows come sorted by start time; keep each couple's bookings together (the group's first)
  const items = shown.filter((b) => kindOf(b) === current).sort((a, b) => (a.who ?? '').localeCompare(b.who ?? ''))

  return (
    <div className="stack">
      <Tabs
        label="סוג הזמנה"
        tabs={Object.fromEntries(tabs.map((k) => [k, BOOKING_TABS[k]]))}
        current={current}
        counts={Object.fromEntries(tabs.map((k) => [k, count(k)]))}
        onPick={pick}
      />
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
      {error && <LoadNote onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <Empty>
          אין עדיין {BOOKING_TABS[current].split(' ').slice(1).join(' ')}
          {whose && ' בסינון הזה'}. אפשר להוסיף מאישור הזמנה או עם ＋
        </Empty>
      )}
      <div className="stack">
        {items.map((b, i) => (
          <Fragment key={b.id}>
            {/* with no couple filter, head each couple's run of bookings */}
            {couples.length > 1 && !whose && (i === 0 || b.who !== items[i - 1].who) && (
              <div className="area-title">{b.who ? `💑 ${b.who}` : `👥 ${TOGETHER}`}</div>
            )}
              <div className="card booking" onClick={() => setEdit(b)}>
                <div className="row spread">
                  <b>{BOOKING_KINDS[b.kind]?.split(' ')[0]} {b.title}</b>
                  {b.file_path && <span title="קובץ מצורף">📎</span>}
                </div>
                {couples.length > 1 && whose && (
                  <div className={'who-tag' + (b.who ? ' apart' : '')}>{b.who ? `💑 ${b.who}` : `👥 ${TOGETHER}`}</div>
                )}
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
                  {b.file_path && <DocButtons path={b.file_path} />}
                </div>
              </div>
          </Fragment>
        ))}
      </div>
      <button className="fab" aria-label="הזמנה חדשה" onClick={() => setEdit({ kind: current, who: myCouple })}>
        ＋
      </button>
      {edit && <BookingForm trip={trip} couples={couples} booking={edit} onClose={() => setEdit(null)} />}
      {importing && <ImportSheet trip={trip} couples={couples} myCouple={myCouple} onClose={() => setImporting(false)} />}
    </div>
  )
}

// Booking documents are saved in Cache Storage so they open with no network (underground, in the air). The key is
// only a unique URL-shaped name: nothing is ever fetched from it. Paths are uuids, so a saved copy never goes stale.
const docKey = (path: string) => new URL('__doc/' + path.split('/').map(encodeURIComponent).join('/'), document.baseURI).href

async function savedDoc(path: string) {
  try {
    return (await (await caches.open('docs')).match(docKey(path))) ?? null
  } catch {
    return null
  }
}

async function saveDoc(path: string) {
  try {
    const { data } = await supabase.storage.from('docs').createSignedUrl(path, 600)
    if (!data) return false
    const res = await fetch(data.signedUrl)
    if (!res.ok) return false
    await (await caches.open('docs')).put(docKey(path), res)
    return true
  } catch {
    return false
  }
}

async function openFile(path: string) {
  // open the tab synchronously so mobile popup blockers allow it
  const win = window.open('', '_blank')
  const go = (href: string) => (win ? (win.location.href = href) : (location.href = href))
  const saved = await savedDoc(path)
  if (saved) {
    const href = URL.createObjectURL(await saved.blob())
    go(href)
    setTimeout(() => URL.revokeObjectURL(href), 10 * 60 * 1000)
    return
  }
  const { data, error } = await supabase.storage.from('docs').createSignedUrl(path, 600)
  if (error || !data) {
    win?.close()
    alert(navigator.onLine ? 'לא ניתן לפתוח את הקובץ' : 'אין חיבור, והמסמך לא נשמר לאופליין')
  } else go(data.signedUrl)
}

/** A booking's document: open it, and keep a copy on the phone (saved automatically when online). */
function DocButtons({ path }: { path: string }) {
  const [saved, setSaved] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    setSaved(await saveDoc(path))
    setBusy(false)
  }

  useEffect(() => {
    let live = true
    savedDoc(path).then(async (hit) => {
      if (!live) return
      setSaved(!!hit)
      // a few small PDFs per trip, so saving without asking is cheap and the document is there when it's needed
      if (!hit && navigator.onLine) {
        const ok = await saveDoc(path)
        if (live) setSaved(ok)
      }
    })
    return () => {
      live = false
    }
  }, [path])

  return (
    <>
      <button className="pill" onClick={() => openFile(path)}>
        📎 מסמך
      </button>
      {saved ? (
        <span className="small muted">✓ נשמר לאופליין</span>
      ) : (
        saved === false && (
          <button className="pill" disabled={busy} onClick={save}>
            {busy ? 'שומר…' : '📥 שמירה לאופליין'}
          </button>
        )
      )}
    </>
  )
}

function BookingForm(props: { trip: Trip; couples: string[]; booking: Partial<Booking>; onClose: () => void }) {
  const tripId = props.trip.id
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
      const path = `${tripId}/${crypto.randomUUID()}.${ext}`
      const { error } = await supabase.storage.from('docs').upload(path, file, { contentType: file.type })
      if (error) {
        alert('העלאת הקובץ נכשלה: ' + error.message)
        setBusy(false)
        return
      }
      filePath = path
    }
    const row = {
      trip_id: tripId,
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
    if (ok) {
      // the old attachment goes only once the row points at the new one
      if (file && f.file_path) await supabase.storage.from('docs').remove([f.file_path])
      if (row.kind === 'hotel') await fillHotelNights(props.trip, [row])
    } else if (file && filePath) {
      await supabase.storage.from('docs').remove([filePath])
    }
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

/** A local time from the reader as a stored timestamp; a bare date gets `time`. */
function wallClock(v: string | null, time: string) {
  if (!v) return null
  const m = v.match(/^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/)
  return m ? fromInputDateTime(`${m[1]}T${m[2] ?? time}`) : null
}

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
    try {
      if (file) payload.file = { data: await toBase64(file), media_type: file.type }
    } catch {
      setErr('לא הצלחתי לקרוא את הקובץ. אפשר לנסות קובץ אחר או להדביק את הטקסט.')
      setBusy(false)
      return
    }
    const { data, error } = await supabase.functions.invoke('parse-booking', { body: payload })
    if (error || !data?.bookings) {
      setErr(aiError(error, 'לא הצלחתי לקרוא את האישור. אפשר לנסות שוב או להוסיף ידנית.'))
      setBusy(false)
      return
    }
    // times come back as local wall-clock "YYYY-MM-DDTHH:mm", sometimes as a bare date
    const bookings = (data.bookings as Extracted[]).map((b) => ({
      ...b,
      starts_at: wallClock(b.starts_at, b.kind === 'hotel' ? '15:00' : '00:00'),
      ends_at: wallClock(b.ends_at, b.kind === 'hotel' ? '11:00' : '00:00'),
      who: who || null,
    }))
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
        bookings.map((b) => ({ trip_id: trip.id, ...b, file_path: filePath })),
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

/**
 * Write each hotel on the trip nights it covers (needs the trip start date). A couple's hotel becomes its own line,
 * "couple: hotel", so the two couples' hotels sit side by side on nights they stay apart.
 */
async function fillHotelNights(trip: Trip, bookings: Pick<Booking, 'kind' | 'title' | 'starts_at' | 'ends_at' | 'who'>[]) {
  if (!trip.start_date) return
  const day1 = Date.parse(trip.start_date + 'T00:00:00Z')
  const nights = new Map<number, { who: string | null; title: string }[]>()
  for (const b of bookings) {
    if (b.kind !== 'hotel' || !b.starts_at || !b.ends_at) continue
    const first = Math.round((Date.parse(b.starts_at.slice(0, 10) + 'T00:00:00Z') - day1) / 86400000) + 1
    const last = Math.round((Date.parse(b.ends_at.slice(0, 10) + 'T00:00:00Z') - day1) / 86400000)
    for (let d = Math.max(first, 1); d <= Math.min(last, trip.num_days); d++)
      nights.set(d, [...(nights.get(d) ?? []), { who: b.who, title: b.title }])
  }
  if (!nights.size) return
  const { data: existing } = await supabase.from('day_info').select('day, hotel').eq('trip_id', trip.id)
  const rows = [...nights].map(([day, stays]) => {
    let lines: string[] = ((existing?.find((r) => r.day === day)?.hotel as string | null) ?? '').split('\n').filter(Boolean)
    for (const s of stays) {
      // the group's hotel replaces the night; a couple's replaces only that couple's line
      if (!s.who) lines = [s.title]
      else lines = [...lines.filter((l) => !l.replace(/^💑\s*/, '').startsWith(`${s.who}:`)), `${s.who}: ${s.title}`]
    }
    return { trip_id: trip.id, day, hotel: lines.join('\n') }
  })
  const { error } = await supabase.from('day_info').upsert(rows)
  if (error) alert('ההזמנה נשמרה, אבל לא הצלחתי לרשום את המלון בימים במסלול: ' + error.message)
}
