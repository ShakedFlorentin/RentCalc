import { Fragment, useEffect, useState } from 'react'
import { Check, Download, Link as LinkIcon, Mail, Map as MapIcon, Paperclip, Pencil, Plus, Users, Wand2 } from 'lucide-react'
import { supabase } from '../supabase'
import { BOOKING_KINDS, BOOKING_TABS, TOGETHER, type Booking, type Member, type Trip } from '../types'
import { aiError, couplesOf, errorText, normName, fmtDateTime, fromInputDateTime, mapsUrl, mutate, replan, safeUrl, toInputDateTime, useTripTable } from '../lib'
import { Empty, Field, LoadNote, Sheet, Tabs, useRemembered } from '../ui'
import { BOOKING_ICON, Icon } from '../icons'

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
  // by date, then whose; bookings with no date go last
  const items = shown
    .filter((b) => kindOf(b) === current)
    .sort((a, b) => (a.starts_at ?? '~').localeCompare(b.starts_at ?? '~') || (a.who ?? '').localeCompare(b.who ?? ''))

  return (
    <div className="stack">
      <Tabs
        label="סוג הזמנה"
        tabs={Object.fromEntries(tabs.map((k) => [k, { label: BOOKING_TABS[k], icon: BOOKING_ICON[k] }]))}
        current={current}
        counts={Object.fromEntries(tabs.map((k) => [k, count(k)]))}
        onPick={pick}
      />
      <button className="secondary" onClick={() => setImporting(true)}>
        <Icon as={Mail} /> הוספה מאישור הזמנה
      </button>
      {couples.length > 1 && (
        <div className="chips scroll">
          <button className={'chip' + (!whose ? ' on' : '')} onClick={() => setWhose('')}>
            הכל
          </button>
          {couples.map((c) => (
            <button key={c} className={'chip' + (whose === c ? ' on' : '')} onClick={() => setWhose(c)}>
              {c}
            </button>
          ))}
          <button className={'chip' + (whose === 'group' ? ' on' : '')} onClick={() => setWhose('group')}>
            <Icon as={Users} /> של כולם
          </button>
        </div>
      )}
      {error && <LoadNote onRetry={reload} />}
      {!loading && !error && items.length === 0 && (
        <Empty>
          אין {BOOKING_TABS[current]}
          {whose && ' בסינון הזה'}. אפשר להוסיף מאישור הזמנה או ידנית.
        </Empty>
      )}
      <div className="stack">
        {items.map((b) => (
          <Fragment key={b.id}>
              <div className="card booking" onClick={() => setEdit(b)}>
                <div className="row spread">
                  <b>
                    <Icon as={BOOKING_ICON[b.kind] ?? BOOKING_ICON.other} /> {b.title}
                  </b>
                  {/* the whole card opens the editor; the pencil says so (the document has its own button below) */}
                  <span className="muted booking-edit" aria-hidden="true">
                    <Icon as={Pencil} />
                  </span>
                </div>
                {couples.length > 1 && (
                  <div className={'who-tag' + (b.who ? ' apart' : '')}>{b.who ?? <WhoAll />}</div>
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
                {(b.location || safeUrl(b.url) || b.file_path) && (
                <div className="row" onClick={(e) => e.stopPropagation()}>
                  {b.location && (
                    <a className="pill" href={mapsUrl(b.location)} target="_blank" rel="noreferrer">
                      <Icon as={MapIcon} /> מפה
                    </a>
                  )}
                  {safeUrl(b.url) && (
                    <a className="pill" href={safeUrl(b.url)} target="_blank" rel="noreferrer">
                      <Icon as={LinkIcon} /> קישור
                    </a>
                  )}
                  {b.file_path && <DocButtons path={b.file_path} />}
                </div>
                )}
              </div>
          </Fragment>
        ))}
      </div>
      <button className="fab" aria-label="הזמנה חדשה" onClick={() => setEdit({ kind: current, who: myCouple })}>
        <Plus size={28} strokeWidth={2} aria-hidden="true" />
      </button>
      {edit && (
        <BookingForm
          trip={trip}
          couples={couples}
          booking={edit}
          onClose={() => setEdit(null)}
          onImport={() => {
            setEdit(null)
            setImporting(true)
          }}
        />
      )}
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
    alert(navigator.onLine ? 'אי אפשר לפתוח את הקובץ' : 'אין חיבור, והמסמך לא שמור לאופליין')
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
        <Icon as={Paperclip} /> מסמך
        {/* saved on the phone: a tick inside the button rather than a line of its own that pushed the row onto two lines */}
        {saved && <Icon as={Check} label="שמור בטלפון, נפתח גם בלי אינטרנט" />}
      </button>
      {saved ? null : (
        saved === false && (
          <button className="pill" disabled={busy} onClick={save}>
            {busy ? (
              'שומר…'
            ) : (
              <>
                <Icon as={Download} /> שמירה לאופליין
              </>
            )}
          </button>
        )
      )}
    </>
  )
}

/** Remove a stored document unless another booking in the trip still points at it (one confirmation can feed several). */
async function removeDocIfUnused(tripId: string, path: string, exceptId: string) {
  const { data, error } = await supabase
    .from('bookings')
    .select('id')
    .eq('trip_id', tripId)
    .eq('file_path', path)
    .neq('id', exceptId)
    .limit(1)
  // if we can't tell, keep the file: an orphan is better than a broken attachment
  if (error || (data?.length ?? 0) > 0) return
  await supabase.storage.from('docs').remove([path])
}

function BookingForm(props: {
  trip: Trip
  couples: string[]
  booking: Partial<Booking>
  onClose: () => void
  onImport: () => void
}) {
  const tripId = props.trip.id
  const [f, setF] = useState<Partial<Booking>>(props.booking)
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [readNote, setReadNote] = useState('')

  /** Claude reads the attached confirmation and fills the form; the file stays attached. */
  const readFile = async () => {
    if (!file) return
    setReading(true)
    setReadNote('')
    let data: { bookings?: Extracted[] } | null = null
    try {
      const res = await supabase.functions.invoke('parse-booking', {
        body: { text: '', file: { data: await toBase64(file), media_type: file.type } },
      })
      if (res.error) setReadNote(await aiError(res.error, 'לא הצלחתי לקרוא את הקובץ. אפשר למלא ידנית.'))
      data = res.data
    } catch {
      setReadNote('לא הצלחתי לקרוא את הקובץ. אפשר למלא ידנית.')
    }
    setReading(false)
    const found = data?.bookings ?? []
    if (!found.length) {
      if (data) setReadNote('לא מצאתי הזמנה בקובץ הזה. אפשר למלא ידנית.')
      return
    }
    const b = found[0]
    setF((prev) => ({
      ...prev,
      kind: BOOKING_KINDS[b.kind] ? b.kind : prev.kind,
      title: b.title || prev.title,
      starts_at: wallClock(b.starts_at, b.kind === 'hotel' ? '15:00' : '00:00') ?? prev.starts_at,
      ends_at: wallClock(b.ends_at, b.kind === 'hotel' ? '11:00' : '00:00') ?? prev.ends_at,
      confirmation: b.confirmation || prev.confirmation,
      location: b.location || prev.location,
      url: safeUrl(b.url) ?? prev.url,
      notes: prev.notes || b.notes,
    }))
    setReadNote(
      found.length > 1
        ? `מילאתי את הראשונה מתוך ${found.length} ההזמנות בקובץ. בדקו ושמרו, או הוסיפו את כולן דרך "הוספה מאישור הזמנה".`
        : 'מילאתי את הפרטים מהקובץ. בדקו ושמרו.',
    )
  }
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
    const { error } = await (f.id ? supabase.from('bookings').update(row).eq('id', f.id) : supabase.from('bookings').insert(row))
    const ok = !error
    if (error?.code === '23505') alert('כבר יש הזמנה כזו: אותו מספר אישור באותה שעה, או אותו שם, שעה וזוג.')
    else if (error) alert('שגיאה: ' + error.message)
    if (ok) {
      // the old attachment goes only once the row points at the new one
      if (file && f.file_path && f.id) await removeDocIfUnused(tripId, f.file_path, f.id)
    } else if (file && filePath) {
      await supabase.storage.from('docs').remove([filePath])
    }
    setBusy(false)
    if (ok) props.onClose()
  }

  const remove = async () => {
    if (!f.id || !confirm('למחוק את ההזמנה?')) return
    if (!(await mutate(supabase.from('bookings').delete().eq('id', f.id)))) return
    // the database announces new and changed bookings to the planner, not deleted ones
    replan(tripId)
    if (f.file_path) await removeDocIfUnused(tripId, f.file_path, f.id)
    props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכת הזמנה' : 'הזמנה חדשה'} onClose={props.onClose}>
      {!f.id && (
        <button className="secondary" onClick={props.onImport}>
          <Icon as={Mail} /> יש אישור הזמנה? מוסיפים אוטומטית מקובץ או ממייל
        </button>
      )}
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
      {file && (
        <button className="secondary" onClick={readFile} disabled={reading}>
          <Icon as={Wand2} /> {reading ? 'קורא את הקובץ…' : 'קריאת הקובץ ומילוי הפרטים'}
        </button>
      )}
      {readNote && (
        <p className="small" role="status">
          {readNote}
        </p>
      )}
      <button className="primary" onClick={save} disabled={busy || !f.title?.trim()}>
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

/** Same stored time, whatever the timestamp's formatting ("…T07:00:00Z" vs "…07:00:00+00:00"). */
function sameTime(a: string | null, b: string | null) {
  return a === b || (!!a && !!b && Date.parse(a) === Date.parse(b))
}

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
  const [done, setDone] = useState<{ kind: string; title: string }[] | null>(null)
  const [skipped, setSkipped] = useState(0)
  const [docLost, setDocLost] = useState(false)
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
      setErr(await aiError(error, 'לא הצלחתי לקרוא את האישור. אפשר לנסות שוב או להוסיף ידנית.'))
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

    // the same confirmation imported by two people (or twice) adds nothing the second time
    const { data: have, error: haveErr } = await supabase
      .from('bookings')
      .select('kind, title, starts_at, confirmation, who')
      .eq('trip_id', trip.id)
    if (haveErr) {
      setErr(errorText(haveErr.message))
      setBusy(false)
      return
    }
    // another couple's booking with the same title and time is theirs, not a duplicate (unless it is the same code)
    const isDup = (b: (typeof bookings)[number], list: { kind: string; title: string; starts_at: string | null; confirmation: string | null; who: string | null }[]) =>
      list.some(
        (h) =>
          h.kind === b.kind &&
          sameTime(h.starts_at, b.starts_at) &&
          ((!!b.confirmation && h.confirmation === b.confirmation) ||
            (normName(h.title) === normName(b.title) && (h.who ?? null) === (b.who ?? null))),
      )
    // the parser can also repeat itself within one reply
    const fresh: typeof bookings = []
    for (const b of bookings) if (!isDup(b, have ?? []) && !isDup(b, fresh)) fresh.push(b)
    const skipped = bookings.length - fresh.length
    if (!fresh.length) {
      setErr(skipped > 1 ? 'כל ההזמנות באישור הזה כבר קיימות.' : 'ההזמנה הזו כבר קיימת.')
      setBusy(false)
      return
    }

    // keep the original confirmation with the booking
    let filePath: string | null = null
    let lost = false
    if (file) {
      const ext = file.name.includes('.') ? file.name.split('.').pop() : 'bin'
      filePath = `${trip.id}/${crypto.randomUUID()}.${ext}`
      const up = await supabase.storage.from('docs').upload(filePath, file, { contentType: file.type })
      if (up.error) {
        filePath = null
        lost = true
      }
    }
    const ok = await mutate(
      supabase.from('bookings').insert(
        fresh.map((b) => ({ trip_id: trip.id, ...b, file_path: filePath })),
      ),
    )
    if (ok) {
      setSkipped(skipped)
      setDocLost(lost)
      setDone(fresh.map((b) => ({ kind: b.kind, title: b.title })))
    }
    setBusy(false)
  }

  if (done) {
    return (
      <Sheet title={done.length > 1 ? `נוספו ${done.length} הזמנות` : 'ההזמנה נוספה'} onClose={onClose}>
        {done.map((d, n) => (
          <div key={n} dir="auto">
            <Icon as={BOOKING_ICON[d.kind] ?? BOOKING_ICON.other} /> {d.title}
          </div>
        ))}
        {docLost && <p className="msg">המסמך לא נשמר וההזמנות נוספו בלעדיו. אפשר לצרף אותו בעריכת ההזמנה.</p>}
        {skipped > 0 && <p className="small">{skipped === 1 ? 'הזמנה אחת כבר הייתה קיימת ולא נוספה שוב.' : `${skipped} הזמנות כבר היו קיימות ולא נוספו שוב.`}</p>}
        <p className="muted small">לחיצה על הזמנה פותחת אותה לעריכה. מלונות מופיעים גם בלילות שלהם במסלול.</p>
        <button className="primary" onClick={onClose}>
          סגירה
        </button>
      </Sheet>
    )
  }

  return (
    <Sheet title="הוספה מאישור הזמנה" onClose={onClose}>
      <p className="muted small">
        מדביקים את מייל האישור (Booking, Agoda, חברת תעופה…) או מצרפים PDF / צילום מסך, וההזמנה נוספת לבד.
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

function WhoAll() {
  return (
    <>
      <Icon as={Users} /> {TOGETHER}
    </>
  )
}

function WhoField(props: { value: string; couples: string[]; onChange: (who: string) => void }) {
  return (
    <Field label="של מי">
      <select value={props.value} onChange={(e) => props.onChange(e.target.value)}>
        <option value="">של כולם</option>
        {props.couples.map((c) => (
          <option key={c} value={c}>
            {c}
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
