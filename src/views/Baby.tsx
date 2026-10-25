import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import type { ChecklistItem, Member, Trip } from '../types'
import { mutate, useTripTable } from '../lib'
import { Empty, LoadNote } from '../ui'
import { PHRASES } from '../phrases'
import { PhraseList } from './Essentials'
import { Icon, type LucideIcon } from '../icons'
import { Baby as BabyIcon, Check, Droplets, Luggage, Milk, ShoppingCart, Plus, Sparkles, Stethoscope, Train, Trash2, Languages, Plane } from 'lucide-react'
import '../styles/info.css'

type Props = { trip: Trip; members: Member[]; userId: string }

// 5 months old, milk only, three winter weeks in Japan
const PRESET = [
  'דרכון לתינוק (בתוקף, ועותק שלו בטלפון)',
  'לוודא שהתינוק מכוסה בביטוח הנסיעות',
  'תמ"ל מהארץ: בערך 100–120 גרם ליום, כלומר כ-2–2.5 ק"ג לשלושה שבועות (לפי המנה שלו). את השאר אפשר לקנות ביפן, אבל לא מחליפים מותג פתאום',
  'מתקן מנות לאבקה (קופסה עם תאים) להכנה מהירה בדרך',
  '4–5 בקבוקים + פטמות רזרביות + מברשת בקבוקים וסבון עדין',
  'ערכת עיקור לנסיעה (שקיות למיקרוגל או קופסה מתקפלת)',
  'תרמוס טוב למים חמים, למלא כל בוקר וערב',
  'קומקום נסיעות 100–240V למקרה שאין קומקום בחדר (ביפן החשמל 100V, אז קומקום רגיל מתחמם לאט)',
  'מנשא ארגונומי (לרכבות ולמדרגות הוא הרבה יותר נוח מעגלה)',
  'טיולון קומפקטי שמתקפל ביד אחת + כיסוי גשם ורוח',
  'אוברול חם, 5–6 בגדי גוף ארוכים, כובע, כפפות וגרביים (חם בפנים ובתחבורה, קר בחוץ, אז שכבות)',
  'שמיכה / שק שינה חם לעגלה ולמנשא',
  'חיתולים ומגבונים ל-3–4 הימים הראשונים (אחר כך קונים בדראגסטור)',
  'שקיות לחיתולים משומשים (כמעט אין פחים ברחוב, לוקחים איתנו עד המלון)',
  'משחה לאזור החיתול + קרם לחות',
  'אקמול / נורופן לתינוקות לפי הנחיית רופא הילדים (מינון לפי משקל) + מד חום',
  'שואב נזלת / מי מלח, למקרה של הצטננות באוויר היבש',
  'מוצץ (אם משתמש) + מחזיק מוצץ, משחק קטן וספר בד',
  'בגדים להחלפה ומגבת קטנה בתיק היומי',
]

export default function Baby({ trip }: Props) {
  const tripId = trip.id
  const { rows, loading, error, reload } = useTripTable<ChecklistItem>('checklist_items', tripId)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const items = rows.filter((r) => r.list === 'baby').sort((a, b) => Number(a.done) - Number(b.done))
  const doneCount = items.filter((i) => i.done).length

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (!text.trim()) return
    if (await mutate(supabase.from('checklist_items').insert({ trip_id: tripId, list: 'baby', text: text.trim() }))) setText('')
  }
  const addPreset = async () => {
    setBusy(true)
    await mutate(supabase.from('checklist_items').insert(PRESET.map((t) => ({ trip_id: tripId, list: 'baby', text: t }))))
    setBusy(false)
  }

  return (
    <div className="stack">
      <section className="info-sec">
        <h2 className="info-h"><Icon as={Luggage} /> מה לארוז לתינוק</h2>
        {items.length > 0 && (
          <div className="progress">
            <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
            <span>
              {doneCount}/{items.length}
            </span>
          </div>
        )}
        <form className="add-row" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="להוסיף…" />
          <button className="primary" aria-label="הוספה"><Icon as={Plus} size="1.25em" /></button>
        </form>
        {error && <LoadNote onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <>
            <Empty>הרשימה ריקה</Empty>
            <button className="secondary" onClick={addPreset} disabled={busy}>
              <Icon as={Sparkles} /> להוסיף רשימה מוכנה
            </button>
          </>
        )}
        {items.map((i) => (
          <div key={i.id} className={'item card slim' + (i.done ? ' done' : '')}>
            <button
              className="check"
              aria-label={i.done ? 'לבטל סימון' : 'לסמן כבוצע'}
              onClick={() => mutate(supabase.from('checklist_items').update({ done: !i.done }).eq('id', i.id))}
            >
              {i.done ? <Icon as={Check} size="1em" strokeWidth={3} /> : null}
            </button>
            <div className="item-body">{i.text}</div>
            <button
              className="icon faint"
              aria-label="מחיקה"
              onClick={() => confirm(`למחוק את "${i.text}"?`) && mutate(supabase.from('checklist_items').delete().eq('id', i.id))}
            >
              <Icon as={Trash2} size="1.25em" />
            </button>
          </div>
        ))}
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={Plane} /> ביפן עם תינוק</h2>
        {TIPS.map((t) => (
          <details key={t.title} className="card tip">
            <summary>
              <span>
                <Icon as={t.icon} /> {t.title}
              </span>
            </summary>
            <ul>
              {t.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={Languages} /> משפטים לתינוק</h2>
        <p className="muted small info-note">לוחצים כדי להציג במסך מלא.</p>
        <PhraseList phrases={PHRASES.filter((p) => p.baby)} />
      </section>
    </div>
  )
}

const TIPS: { title: string; icon: LucideIcon; points: string[] }[] = [
  {
    title: 'חדרי הנקה ותינוקות',
    icon: BabyIcon,
    points: [
      'יש בכלבו, בקניונים, בתחנות גדולות ובשדות תעופה. מחפשים שלט 授乳室 (junyūshitsu) או ベビールーム (bebī rūmu), או סמל של בקבוק ותינוק.',
      'בכלבו הם בדרך כלל בקומת הילדים או ליד השירותים. לא מוצאים? שואלים בדלפק המידע (案内所) או את עובדי התחנה.',
      'בדרך כלל יש שולחן החתלה וכיסא, ובחלקם גם נקודת מים חמים להכנת תמ"ל. כל מקום שונה, אז לא לסמוך על זה.',
      'בשירותים רב-שימושיים ברוב תחנות הרכבת והמטרו יש שולחן החתלה.',
    ],
  },
  {
    title: 'קניית תמ"ל וחיתולים',
    icon: ShoppingCart,
    points: [
      'דראגסטורים (Matsumoto Kiyoshi, Sundrug ועוד) וחנויות תינוקות כמו Akachan Honpo (赤ちゃん本舗) מוכרים תמ"ל, חיתולים ומגבונים.',
      'ב-Akachan Honpo יש החזר מס לתיירים בקנייה מעל 5,000 ין (לא כולל מע"מ), בדלפק ייעודי בחנות. בודקים בסניף.',
      'תמ"ל יפני: Meiji Hohoemi (ほほえみ) ו-Morinaga, באבקה, בקופסאות או בקוביות. ההרכב והמינון שונים משל הארץ, אז מתייעצים עם רופא הילדים לפני שמחליפים מותג.',
      'חיתולים (Merries, Moony, Pampers) נמכרים לפי משקל. לוקחים את המידה לפי הקילוגרמים, לא לפי הגיל.',
    ],
  },
  {
    title: 'תמ"ל נוזלי מוכן לשתייה',
    icon: Milk,
    points: [
      'קיים ביפן מאז 2019: Meiji Hohoemi Raku Raku Milk (ほほえみ らくらくミルク) ועוד, ממותגים כמו Glico. אין צורך לערבב או לחמם.',
      'נמכר בדראגסטורים, בחנויות תינוקות ובאינטרנט. יקר יותר מאבקה, אבל נוח לטיסה, לרכבת וליום עמוס.',
      'שופכים לבקבוק ולא מאכילים ישר מהפחית. אם מחממים, לא על להבה ולא במיקרוגל.',
      'לפני הקנייה בודקים שזה מתאים לגיל שלו (לפי האריזה). הזמינות משתנה, כדאי לחפש בדראגסטור גדול.',
    ],
  },
  {
    title: 'מים חמים',
    icon: Droplets,
    points: [
      'תמ"ל מכינים עם מים ב-70 מעלות ומעלה, ואז מקררים. תרמוס מלא בבוקר הוא הפתרון הכי אמין.',
      'בחדרי תינוקות בקניונים ובכלבו לפעמים יש מים חמים (בערך 70–80 מעלות), וגם בשדות התעופה ובפארקי שעשועים.',
      'בקונביניות מוכרים לפעמים מים חמים בבקבוק (白湯), אבל זה מוצר ולא שירות חינם.',
      'במלון מבקשים קומקום בקבלה אם אין בחדר, ומראים את כרטיס "מים חמים לחלב של התינוק" למטה.',
    ],
  },
  {
    title: 'עגלה ברכבות ובתחנות',
    icon: Train,
    points: [
      'המעליות בתחנות קיימות, אבל לפעמים בקצה הרחוק של הרציף ובכמה חילופים. משאירים זמן נוסף במעבר.',
      'עם עגלה משתמשים במעלית ולא במדרגות נעות. בקהל גדול מקפלים ונושאים אותו במנשא.',
      'מחוץ לשעות העומס: בערך 7:30–9:00 ו-17:00–19:00 הרכבות בטוקיו עמוסות מאוד, ובעגלה זה קשה.',
      'קרונות קדמיים ואחוריים בדרך כלל פחות עמוסים. באוטובוסים בקיוטו קשה עם עגלה, ולכן מנשא עדיף.',
      'ב-Google Maps אפשר לבחור מסלול נגיש כדי למצוא תחנות ויציאות עם מעלית.',
    ],
  },
  {
    title: 'חירום רפואי לתינוק',
    icon: Stethoscope,
    points: [
      'חום גבוה, קשיי נשימה או תינוק שלא מגיב: 119 (חינם). אומרים 救急 (kyūkyū) ו-赤ちゃん (akachan). בהרבה ערים מחברים מתורגמן, לא מנתקים.',
      '#8000 הוא קו ייעוץ טלפוני של אחיות לילדים, בערבים ובלילות ובסופי שבוע וחגים (השעות משתנות לפי המחוז). הוא לא נותן אבחנה, ובעיקר ביפנית. אין הבטחה לאנגלית, ולכן מבקשים מצוות המלון להתקשר.',
      'ל-Japan Visitor Hotline (050-3816-2787, 24 שעות באנגלית) אפשר להתקשר ולשאול איפה לפנות ואיזה בית חולים מתאים.',
      'מספר חירום של חברת הביטוח שומרים בעמוד "חשוב", וקודם מתקשרים אליהם לפני טיפול יקר.',
    ],
  },
]
