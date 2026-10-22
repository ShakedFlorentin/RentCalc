import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Booking, Essential, Member, Trip } from '../types'
import { TOGETHER } from '../types'
import { couplesOf, mutate, useTripTable } from '../lib'
import { Empty, Field, LoadNote, Sheet } from '../ui'
import { PHRASES, type Phrase } from '../phrases'
import '../styles/info.css'

type Props = { trip: Trip; members: Member[]; userId: string }

const KINDS: Record<Essential['kind'], string> = {
  hotel: '🏨 מלונות',
  phone: '📞 טלפונים',
  insurance: '🛡️ ביטוח',
  document: '📄 מסמכים',
  note: '📝 הערות',
  other: '📌 אחר',
}
const KIND_ORDER = Object.keys(KINDS) as Essential['kind'][]

const telHref = (v: string) => 'tel:' + v.replace(/[^\d+]/g, '')
// a phone value is worth a call button only when it is mostly digits
const looksLikePhone = (v: string) => /^[\d+\-\s()]{6,}$/.test(v.trim())

export default function Essentials({ trip, members, userId }: Props) {
  const { rows, loading, error, reload } = useTripTable<Essential>('essentials', trip.id, 'sort')
  const [edit, setEdit] = useState<Partial<Essential> | null>(null)
  const [show, setShow] = useState<Essential | null>(null)
  const [note, setNote] = useState('')
  const couples = couplesOf(members)
  const myCouple = members.find((m) => m.user_id === userId)?.couple ?? null

  const importHotels = async () => {
    setNote('')
    const { data, error } = await supabase.from('bookings').select('*').eq('trip_id', trip.id).eq('kind', 'hotel')
    if (error) return setNote('לא הצלחתי לקרוא את ההזמנות: ' + error.message)
    const have = new Set(rows.filter((r) => r.kind === 'hotel').map((r) => r.title.trim().toLowerCase()))
    let sort = Math.max(0, ...rows.map((r) => r.sort)) + 1
    const fresh = (data as Booking[])
      .filter((b) => !have.has(b.title.trim().toLowerCase()))
      .map((b) => ({ trip_id: trip.id, kind: 'hotel', title: b.title.trim(), value: b.location, who: b.who, sort: sort++ }))
    if (!fresh.length) return setNote('אין מלונות חדשים להוסיף מההזמנות.')
    if (await mutate(supabase.from('essentials').insert(fresh))) setNote(`נוספו ${fresh.length} מלונות ✅`)
  }

  return (
    <div className="stack">
      <section className="info-sec">
        <h2 className="info-h">🚨 חירום ביפן</h2>
        <div className="sos-row">
          <a className="sos police" href="tel:110">
            <b>110</b>
            <span>משטרה</span>
          </a>
          <a className="sos ambulance" href="tel:119">
            <b>119</b>
            <span>אמבולנס / כבאים</span>
          </a>
        </div>
        <p className="muted small info-note">השיחה חינם. בחירום אמיתי מתקשרים קודם לכאן; בהרבה ערים 119 מחברים מתורגמן באנגלית, אז לא מנתקים.</p>

        <div className="card info-card">
          <div className="info-title">Japan Visitor Hotline (JNTO)</div>
          <div className="muted small">24 שעות, כל השנה, באנגלית (גם סינית וקוריאנית). עוזרים בתאונה, מחלה ואסון טבע, ואפשר לשאול איפה לפנות.</div>
          <div className="row">
            <a className="pill" href="tel:+815038162787" dir="ltr">
              📞 050-3816-2787
            </a>
            <a className="pill soft" href="https://www.japan.travel/en/plan/hotline/" target="_blank" rel="noreferrer">
              האתר
            </a>
          </div>
        </div>

        <div className="card info-card">
          <div className="info-title">שגרירות ישראל בטוקיו</div>
          <div className="small" dir="ltr" lang="en">
            3 Niban-cho, Chiyoda-ku, Tokyo 102-0084
          </div>
          <div className="muted small">מרכזייה. קבלת קהל קונסולרית ימים ב׳–ו׳ 10:00–13:00 (שעון יפן), סגור בחגי ישראל. בלי מספר חירום מאומת אחרי שעות העבודה, אז בלילה פונים קודם ל-110/119.</div>
          <div className="row">
            <a className="pill" href="tel:+81332640911" dir="ltr">
              📞 03-3264-0911
            </a>
            <a className="pill soft" href="https://new.embassies.gov.il/japan/en/contacts" target="_blank" rel="noreferrer">
              האתר
            </a>
          </div>
        </div>
      </section>

      <section className="info-sec">
        <h2 className="info-h">🧾 הפרטים שלנו</h2>
        <div className="row">
          <button className="secondary" onClick={importHotels}>
            🏨 ייבוא מלונות מההזמנות
          </button>
        </div>
        {note && (
          <p className="muted small" role="status">
            {note}
          </p>
        )}
        {error && <LoadNote onRetry={reload} />}
        {!loading && !error && rows.length === 0 && (
          <Empty>
            כאן שומרים כתובות מלונות ביפנית, מספרי פוליסה, טלפונים ומסמכים. אפשר להוסיף עם ＋ או לייבא את המלונות מההזמנות.
          </Empty>
        )}
        {KIND_ORDER.map((k) => {
          const items = rows.filter((r) => (KINDS[r.kind] ? r.kind : 'other') === k)
          if (!items.length) return null
          return (
            <div key={k} className="stack">
              <div className="area-title">{KINDS[k]}</div>
              {items.map((r) => (
                <EssentialCard key={r.id} item={r} onEdit={() => setEdit(r)} onShow={() => setShow(r)} />
              ))}
            </div>
          )
        })}
      </section>

      <section className="info-sec">
        <h2 className="info-h">🗣️ ביפנית</h2>
        <p className="muted small info-note">לוחצים על כרטיס כדי להציג אותו במסך מלא למי שמולכם.</p>
        <PhraseList phrases={PHRASES} />
      </section>

      <div className="info-end" aria-hidden="true" />
      <button className="fab" aria-label="פרט חדש" onClick={() => setEdit({ kind: 'hotel', who: myCouple })}>
        ＋
      </button>
      {edit && <EditSheet trip={trip} couples={couples} rows={rows} item={edit} onClose={() => setEdit(null)} />}
      {show && (
        <ShowFull
          small="この住所までお願いします。"
          big={show.value ?? show.title}
          sub={show.title}
          onClose={() => setShow(null)}
        />
      )}
    </div>
  )
}

function EssentialCard(props: { item: Essential; onEdit: () => void; onShow: () => void }) {
  const { item } = props
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.value ?? '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard is blocked in some browsers; the value is still on screen to select
      alert('לא הצלחתי להעתיק. אפשר לסמן את הטקסט ידנית.')
    }
  }
  return (
    <div className="card info-card" onClick={props.onEdit}>
      <div className="row spread nowrap">
        <div className="info-title">{item.title}</div>
        <span className={'who-tag' + (item.who ? ' apart' : '')}>{item.who ? `💑 ${item.who}` : `👥 ${TOGETHER}`}</span>
      </div>
      {item.value && <div className="info-value" dir="auto">{item.value}</div>}
      {item.value && (
        <div className="row" onClick={(e) => e.stopPropagation()}>
          <button className="pill" onClick={copy}>
            {copied ? 'הועתק ✓' : '📋 העתקה'}
          </button>
          {item.kind === 'hotel' && (
            <button className="pill" onClick={props.onShow}>
              🚕 להראות לנהג
            </button>
          )}
          {item.kind === 'phone' && looksLikePhone(item.value) && (
            <a className="pill" href={telHref(item.value)} dir="ltr">
              📞 חיוג
            </a>
          )}
          {/^https?:\/\//.test(item.value.trim()) && (
            <a className="pill" href={item.value.trim()} target="_blank" rel="noreferrer">
              🔗 פתיחה
            </a>
          )}
        </div>
      )}
    </div>
  )
}

function EditSheet(props: { trip: Trip; couples: string[]; rows: Essential[]; item: Partial<Essential>; onClose: () => void }) {
  const [f, setF] = useState<Partial<Essential>>(props.item)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!f.title?.trim()) return
    setBusy(true)
    const row = {
      trip_id: props.trip.id,
      kind: f.kind ?? 'other',
      title: f.title.trim(),
      value: f.value?.trim() || null,
      who: f.who || null,
    }
    const ok = await mutate(
      f.id
        ? supabase.from('essentials').update(row).eq('id', f.id)
        : supabase.from('essentials').insert({ ...row, sort: Math.max(0, ...props.rows.map((r) => r.sort)) + 1 }),
    )
    setBusy(false)
    if (ok) props.onClose()
  }
  const remove = async () => {
    if (f.id && confirm(`למחוק את "${f.title}"?`) && (await mutate(supabase.from('essentials').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? 'עריכה' : 'פרט חדש'} onClose={props.onClose}>
      <Field label="סוג">
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Essential['kind'] })}>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KINDS[k]}
            </option>
          ))}
        </select>
      </Field>
      {props.couples.length > 1 && (
        <Field label="של מי">
          <select value={f.who ?? ''} onChange={(e) => setF({ ...f, who: e.target.value })}>
            <option value="">👥 של כולם</option>
            {props.couples.map((c) => (
              <option key={c} value={c}>
                💑 {c}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label="כותרת">
        <input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="למשל: Hotel Gracery Shinjuku" />
      </Field>
      <Field label={f.kind === 'hotel' ? 'כתובת (עדיף ביפנית)' : 'תוכן (כתובת, מספר, קישור…)'}>
        <textarea rows={4} dir="auto" value={f.value ?? ''} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </Field>
      <button className="primary" onClick={save} disabled={busy || !f.title?.trim()}>
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

/** A full-screen card to hold up to someone: a phrase, or an address for a taxi driver. */
export function ShowFull(props: { small: string; big: string; sub?: string; onClose: () => void }) {
  const { onClose } = props
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])
  // long addresses and sentences need a smaller size to stay on one screen
  const size = props.big.length > 60 ? 'xs' : props.big.length > 28 ? 's' : ''
  return (
    <div className="show-full" role="dialog" aria-modal="true" onClick={onClose}>
      <button className="show-close" aria-label="סגירה">
        ✕
      </button>
      <div className={'show-big ' + size} lang="ja" dir="ltr">
        {props.big}
      </div>
      {props.sub && (
        <div className="show-sub" dir="auto">
          {props.sub}
        </div>
      )}
      <div className="show-small" dir="auto">
        {props.small}
      </div>
    </div>
  )
}

export function PhraseList({ phrases }: { phrases: Phrase[] }) {
  const [open, setOpen] = useState<Phrase | null>(null)
  return (
    <>
      {phrases.map((p) => (
        <button key={p.id} className="card phrase" onClick={() => setOpen(p)}>
          <span className="phrase-he">{p.he}</span>
          <span className="phrase-ja" lang="ja" dir="ltr">
            {p.ja}
          </span>
          <span className="phrase-ro" dir="ltr">
            {p.romaji}
          </span>
        </button>
      ))}
      {open && <ShowFull small={open.he} big={open.ja} sub={open.romaji} onClose={() => setOpen(null)} />}
    </>
  )
}
