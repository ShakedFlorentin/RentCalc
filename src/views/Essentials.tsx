import { useEffect, useState } from 'react'
import { supabase } from '../supabase'
import type { Booking, Essential, Member, Trip } from '../types'
import { TOGETHER } from '../types'
import { couplesOf, mutate, useTripTable } from '../lib'
import { isEn, t } from '../i18n'
import { Empty, Field, LoadNote, Sheet } from '../ui'
import { PHRASES, type Phrase } from '../phrases'
import { Icon, type LucideIcon } from '../icons'
import { Baby, Car, Copy, Lightbulb, Luggage, MapPin, Snowflake, Utensils, ExternalLink, FileText, Hotel, Phone, Pin, Plus, ReceiptText, ShieldAlert, ShieldCheck, StickyNote, Users, X, Check } from 'lucide-react'
import '../styles/info.css'

type Props = { trip: Trip; members: Member[]; userId: string }

const KINDS: Record<Essential['kind'], { label: string; icon: LucideIcon }> = {
  hotel: { label: t('מלונות'), icon: Hotel },
  phone: { label: t('טלפונים'), icon: Phone },
  insurance: { label: t('ביטוח'), icon: ShieldCheck },
  document: { label: t('מסמכים'), icon: FileText },
  note: { label: t('הערות'), icon: StickyNote },
  other: { label: t('אחר'), icon: Pin },
}
const KIND_ORDER = Object.keys(KINDS) as Essential['kind'][]

// what travellers in the Israeli Japan Facebook groups wish they had known (read October 2026)
const TIPS: { title: string; icon: LucideIcon; items: string[]; links?: { label: string; href: string }[] }[] = [
  {
    title: t('מזוודות ותחבורה'),
    icon: Luggage,
    items: [
      t('שולחים את המזוודה הגדולה בין המלונות ב-takkyubin (בכל מלון ובכל קומביני) ונוסעים עם טרולי קטן. זה לוקח בערך יומיים, אז שולחים לפחות יום מראש.'),
      t('Airporter לוקח מזוודות מהמלון לשדה התעופה באותו יום, אז אפשר לטייל ביום הטיסה בלי לסחוב.'),
      t('סואיקה באפל ווטש, והשעון על יד ימין: בשערים הקורא בצד ימין. זה נוח הרבה יותר.'),
      t('גוגל מפות טוב לתחבורה ציבורית, אבל שווה גם לשאול אנשים. לא פעם יפנים פשוט הולכים איתכם עד המקום.'),
      t('מונית לשדה התעופה, הלוך וחזור, אפשר להזמין מראש דרך Booking. עבד טוב.'),
      t('ב-Sushiro ורשתות דומות השלטים רק ביפנית, אז בודקים מראש בגוגל מפות איך נראית החזית ובאיזו קומה.'),
    ],
  },
  {
    title: t('טוקיו'),
    icon: MapPin,
    items: [
      t('מתחילים ומסיימים בטוקיו. כדאי גינזה בהתחלה ואסקוסה בסוף.'),
      t('שווה סיור מודרך כבר ביום הראשון, כדי להכיר את העיר מהר.'),
      t('החדרים בטוקיו קטנים יותר מאלה שבקיוטו ובאוסקה. לא להיבהל.'),
      t('באים עם מזוודה חצי ריקה, כי הקניות זולות ומפתות.'),
      t('רואים משהו שרוצים לקנות או לעשות? עושים את זה מיד, כמעט אף פעם לא חוזרים.'),
    ],
  },
  {
    title: t('קיוטו'),
    icon: MapPin,
    items: [
      t('פושימי אינארי: העלייה עד הפסגה היא בעיקר הישג, אבל שווה. גם הילדים נהנו.'),
      t('יער הבמבוק בארשיימה לבד קטן ומאכזב. עדיף להתחיל במקדשים שבצפון ולרדת ברגל דרך הכפר השמור עד היער.'),
      t('קיבונה ואוג׳י יפים ושקטים הרבה יותר. אמאנוהשידטה ואינה, בצפון המחוז, כמעט בלי תיירים.'),
      t('גיון עם מדריך, אחרת מפספסים את רוב מה שיש שם.'),
      t('אין צורך לצאת מוקדם, 10:00 מספיק. שלושה ימים מספיקים, כולל יום בנארה.'),
    ],
  },
  {
    title: t('כשרות ובלי חזיר ופירות ים'),
    icon: Utensils,
    items: [
      t('מי ששומר כשרות מלאה מסתדר בדירה עם מטבח, עם אוכל מהארץ ועם חב״ד בשבת. מי שרק לא אוכל חזיר ופירות ים מסתדר טוב, אם בודקים מה יש בפנים.'),
      t('שלוש מלכודות: לחם עם שומן חזיר, רוטב לסלט עם משחת שרימפס או צדפות, ומרק ראמן קלאסי שמבושל מעצמות חזיר. בראמן מחפשים ציר עוף (tori paitan) או מנה טבעונית.'),
      t('מסעדות כמעט לא משנות מנות, אלא אם מבקשים מראש. ב-Isesueyoshi למשל מתאימים את כל הארוחה אם אומרים בהזמנה.'),
      t('David\'s Deli בטוקיו היא המסעדה הכשרה היחידה בעיר. בינונית ביחס למחיר.'),
      t('בתי חב״ד: שניים בטוקיו, אחד בקיוטו ואחד בקובה. נרשמים לארוחות שבת באתר שלהם. חב״ד טוקיו גם שולחים אוכל למלון ומשאילים פלטה.'),
      t('יש רשימת מוצרים כשרים שנמכרים ביפן: גלידות, עוגיות ולחם ב-7-Eleven, חלב, גבינות וסלמון מעושן. בודקים לפי הברקוד.'),
      t('בקומביני: אוניגירי עם 鮭 (סלמון), ツナマヨ (טונה במיונז), 梅 (שזיף) או 昆布 (אצה). על התווית נזהרים מ-豚 (חזיר) ומ-エビ, イカ, タコ, 貝 (שרימפס, קלמרי, תמנון, צדפות). אין להם השגחה.'),
      t('HappyCow מוצאת מקומות טבעוניים וצמחוניים בכל מקום, וזה גם פתרון בטוח בלי חזיר ופירות ים.'),
      t('במסעדה מראים את הכרטיס "לא אוכל חזיר ופירות ים" בכרטיסי המשפטים ביפנית למטה.'),
    ],
    links: [
      { label: t('חב״ד יפן'), href: 'https://www.chabad.jp/' },
      { label: t('רשימת מוצרים כשרים'), href: 'https://kosher.global/zekasher/' },
      { label: 'HappyCow', href: 'https://www.happycow.net/' },
    ],
  },
  {
    title: t('דצמבר'),
    icon: Snowflake,
    items: [
      t('קר אבל לא קיצוני בטוקיו, קיוטו ואוסקה: כמה מעלות, כמעט לא מתחת לאפס, ומעט גשם. מתלבשים בשכבות.'),
      t('גרביונים וחולצות תרמיות של Uniqlo זולים, אפשר לקנות שם.'),
      t('מתחילת דצמבר העונה שקטה: מחירים נמוכים יותר ופחות תורים.'),
      t('הערים מקושטות לחג המולד, עם שווקי כריסמס ומופעי אורות, חלקם בחינם. בערב ראש השנה יש טקסים בכל מקדש עד הלילה, ויריד.'),
      t('חלק מהעצים כבר בלי עלים, אבל יש פריחת נרקיסים ולפעמים פריחת שזיף ראשונה.'),
    ],
  },
  {
    title: t('עם תינוק'),
    icon: Baby,
    items: [
      t('עגלה קלה, כי הרבה פעמים צריך לסחוב אותה במדרגות. בגיל הזה לוקחים עגלה שהתינוק כבר רגיל לישון בה.'),
      t('עגלה עם סל אחסון, כי סוחבים מנשא, תיק החתלה וקניות.'),
      t('קשה למצוא אוכל לתינוקות. מה שאפשר, מביאים מהארץ.'),
    ],
  },
]

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
    if (error) return setNote(t('אי אפשר לקרוא את ההזמנות: {msg}', { msg: error.message }))
    const have = new Set(rows.filter((r) => r.kind === 'hotel').map((r) => r.title.trim().toLowerCase()))
    let sort = Math.max(0, ...rows.map((r) => r.sort)) + 1
    const fresh = (data as Booking[])
      .filter((b) => !have.has(b.title.trim().toLowerCase()))
      .map((b) => ({ trip_id: trip.id, kind: 'hotel', title: b.title.trim(), value: b.location, who: b.who, sort: sort++ }))
    if (!fresh.length) return setNote(t('אין מלונות חדשים בהזמנות.'))
    if (await mutate(supabase.from('essentials').insert(fresh))) setNote(fresh.length === 1 ? t('נוסף מלון אחד') : t('נוספו {n} מלונות', { n: fresh.length }))
  }

  return (
    <div className="stack">
      <section className="info-sec">
        <h2 className="info-h"><Icon as={ShieldAlert} /> {t('חירום ביפן')}</h2>
        <div className="sos-row">
          <a className="sos police" href="tel:110">
            <b>110</b>
            <span>{t('משטרה')}</span>
          </a>
          <a className="sos ambulance" href="tel:119">
            <b>119</b>
            <span>{t('אמבולנס / כבאים')}</span>
          </a>
        </div>
        <p className="muted small info-note">{t('השיחה חינם. בחירום אמיתי מתקשרים קודם לכאן. בהרבה ערים 119 מחברים מתורגמן לאנגלית, אז לא מנתקים.')}</p>
        <PhraseList phrases={PHRASES.filter((p) => p.id === 'help')} />

        <div className="card info-card">
          <div className="info-title">Japan Visitor Hotline (JNTO)</div>
          <div className="muted small">{t('24 שעות, כל השנה, באנגלית (גם סינית וקוריאנית). עוזרים בתאונה, מחלה ואסון טבע, ואפשר לשאול לאן לפנות.')}</div>
          <div className="row">
            <a className="pill" href="tel:+815038162787" dir="ltr">
              <Icon as={Phone} /> 050-3816-2787
            </a>
            <a className="pill soft" href="https://www.japan.travel/en/plan/hotline/" target="_blank" rel="noreferrer">
              {t('האתר')}
            </a>
          </div>
        </div>

        <div className="card info-card">
          <div className="info-title">{t('שגרירות ישראל בטוקיו')}</div>
          <div className="small" dir="ltr" lang="en">
            3 Niban-cho, Chiyoda-ku, Tokyo 102-0084
          </div>
          <div className="muted small">{t('מרכזייה. קבלת קהל קונסולרית בימים ב׳–ו׳')} <bdi dir="ltr">10:00–13:00</bdi> {t('(שעון יפן), סגור בחגי ישראל. אין מספר חירום ידוע אחרי שעות העבודה, אז בלילה פונים קודם ל-110/119.')}</div>
          <div className="row">
            <a className="pill" href="tel:+81332640911" dir="ltr">
              <Icon as={Phone} /> 03-3264-0911
            </a>
            <a className="pill soft" href="https://new.embassies.gov.il/japan/en/contacts" target="_blank" rel="noreferrer">
              {t('האתר')}
            </a>
          </div>
        </div>
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={ReceiptText} /> {t('הפרטים שלנו')}</h2>
        <div className="info-actions">
          <button className="secondary" onClick={() => setEdit({ kind: 'hotel', who: myCouple })}>
            <Icon as={Plus} /> {t('פרט חדש')}
          </button>
          <button className="secondary" onClick={importHotels}>
            <Icon as={Hotel} /> {t('ייבוא מלונות')}
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
            {t('כאן שומרים כתובות מלונות ביפנית, מספרי פוליסה, טלפונים ומסמכים. מוסיפים ידנית או מייבאים את המלונות מההזמנות.')}
          </Empty>
        )}
        {KIND_ORDER.map((k) => {
          const items = rows.filter((r) => (KINDS[r.kind] ? r.kind : 'other') === k)
          if (!items.length) return null
          return (
            <div key={k} className="stack">
              <div className="area-title">
                <Icon as={KINDS[k].icon} /> {KINDS[k].label}
              </div>
              {items.map((r) => (
                <EssentialCard key={r.id} item={r} onEdit={() => setEdit(r)} onShow={() => setShow(r)} />
              ))}
            </div>
          )
        })}
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={Lightbulb} /> {t('טיפים מהקבוצות')}</h2>
        <p className="muted small info-note">{t('ממטיילים שחזרו, מקבוצות היפן בפייסבוק.')}</p>
        {TIPS.map((g) => (
          <details key={g.title} className="card tip">
            <summary>
              <span>
                <Icon as={g.icon} /> {g.title}
              </span>
            </summary>
            <ul>
              {g.items.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            {g.links && (
              <div className="row">
                {g.links.map((l) => (
                  <a key={l.href} className="pill soft" href={l.href} target="_blank" rel="noreferrer">
                    <Icon as={ExternalLink} /> {l.label}
                  </a>
                ))}
              </div>
            )}
          </details>
        ))}
      </section>

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
      alert(t('ההעתקה נחסמה. אפשר לסמן את הטקסט ידנית.'))
    }
  }
  return (
    <div className="card info-card" onClick={props.onEdit}>
      <div className="row spread nowrap">
        <div className="info-title">{item.title}</div>
        <span className={'who-tag' + (item.who ? ' apart' : '')}><Icon as={Users} /> {item.who ? t(item.who) : t(TOGETHER)}</span>
      </div>
      {item.value && <div className="info-value" dir="auto">{item.value}</div>}
      {item.value && (
        <div className="row" onClick={(e) => e.stopPropagation()}>
          <button className="pill" onClick={copy}>
            {copied ? <><Icon as={Check} /> {t('הועתק')}</> : <><Icon as={Copy} /> {t('העתקה')}</>}
          </button>
          {item.kind === 'hotel' && (
            <button className="pill" onClick={props.onShow}>
              <Icon as={Car} /> {t('להראות לנהג')}
            </button>
          )}
          {item.kind === 'phone' && looksLikePhone(item.value) && (
            <a className="pill" href={telHref(item.value)} dir="ltr">
              <Icon as={Phone} /> {t('חיוג')}
            </a>
          )}
          {/^https?:\/\//.test(item.value.trim()) && (
            <a className="pill" href={item.value.trim()} target="_blank" rel="noreferrer">
              <Icon as={ExternalLink} /> {t('פתיחה')}
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
    if (f.id && confirm(t('למחוק את "{title}"?', { title: f.title ?? '' })) && (await mutate(supabase.from('essentials').delete().eq('id', f.id)))) props.onClose()
  }

  return (
    <Sheet title={f.id ? t('עריכה') : t('פרט חדש')} onClose={props.onClose}>
      <Field label={t('סוג')}>
        <select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as Essential['kind'] })}>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KINDS[k].label}
            </option>
          ))}
        </select>
      </Field>
      {props.couples.length > 1 && (
        <Field label={t('של מי')}>
          <select value={f.who ?? ''} onChange={(e) => setF({ ...f, who: e.target.value })}>
            <option value="">{t(TOGETHER)}</option>
            {props.couples.map((c) => (
              <option key={c} value={c}>
                {t(c)}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t('כותרת')}>
        <input value={f.title ?? ''} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder={t('למשל: Hotel Gracery Shinjuku')} />
      </Field>
      <Field label={f.kind === 'hotel' ? t('כתובת (עדיף ביפנית)') : t('תוכן (כתובת, מספר, קישור…)')}>
        <textarea rows={4} dir="auto" value={f.value ?? ''} onChange={(e) => setF({ ...f, value: e.target.value })} />
      </Field>
      <button className="primary" onClick={save} disabled={busy || !f.title?.trim()}>
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
      <button className="show-close" aria-label={t('סגירה')}>
        <Icon as={X} size="1.25em" />
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
          <span className="phrase-he">{isEn ? p.en : p.he}</span>
          <span className="phrase-ja" lang="ja" dir="ltr">
            {p.ja}
          </span>
          <span className="phrase-ro" dir="ltr">
            {p.romaji}
          </span>
        </button>
      ))}
      {open && <ShowFull small={isEn ? open.en : open.he} big={open.ja} sub={open.romaji} onClose={() => setOpen(null)} />}
    </>
  )
}
