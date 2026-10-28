import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import type { ChecklistItem, Member, Trip } from '../types'
import { mutate, useTripTable } from '../lib'
import { t } from '../i18n'
import { LoadNote } from '../ui'
import { PHRASES } from '../phrases'
import { PhraseList } from './Essentials'
import { Icon, type LucideIcon } from '../icons'
import { Baby as BabyIcon, Check, Droplets, Luggage, Milk, ShoppingCart, Plus, Sparkles, Stethoscope, Train, Trash2, Languages, Plane } from 'lucide-react'
import '../styles/info.css'

type Props = { trip: Trip; members: Member[]; userId: string }

// 5 months old, milk only, three winter weeks in Japan
const PRESET = [
  t('דרכון לתינוק (בתוקף) ועותק שלו בטלפון'),
  t('לוודא שהתינוק בביטוח הנסיעות'),
  t('תמ"ל מהארץ: בערך 100-120 גרם ליום, כלומר כ-2-2.5 ק"ג לשלושה שבועות (לפי המנה שלו). את השאר אפשר לקנות ביפן, אבל לא מחליפים מותג פתאום'),
  t('מתקן מנות לאבקה (קופסה עם תאים) להכנה מהירה בדרך'),
  t('4-5 בקבוקים + פטמות רזרביות + מברשת בקבוקים וסבון עדין'),
  t('ערכת עיקור לנסיעה (שקיות למיקרוגל או קופסה מתקפלת)'),
  t('תרמוס טוב למים חמים, למלא כל בוקר וערב'),
  t('קומקום נסיעות 100-240V למקרה שאין קומקום בחדר (ביפן החשמל 100V, אז קומקום רגיל מתחמם לאט)'),
  t('מנשא ארגונומי (לרכבות ולמדרגות הוא הרבה יותר נוח מעגלה)'),
  t('טיולון קומפקטי שמתקפל ביד אחת + כיסוי גשם ורוח'),
  t('אוברול חם, 5-6 בגדי גוף ארוכים, כובע, כפפות וגרביים (חם בפנים ובתחבורה, קר בחוץ, אז שכבות)'),
  t('שמיכה / שק שינה חם לעגלה ולמנשא'),
  t('חיתולים ומגבונים ל-3-4 הימים הראשונים (אחר כך קונים בדראגסטור)'),
  t('שקיות לחיתולים משומשים (כמעט אין פחים ברחוב, לוקחים איתנו עד המלון)'),
  t('משחה לאזור החיתול + קרם לחות'),
  t('אקמול / נורופן לתינוקות לפי הנחיית רופא הילדים (מינון לפי משקל) + מד חום'),
  t('שואב נזלת / מי מלח, למקרה של הצטננות באוויר היבש'),
  t('מוצץ (אם משתמש) + מחזיק מוצץ, משחק קטן וספר בד'),
  t('בגדים להחלפה ומגבת קטנה בתיק היומי'),
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
    await mutate(supabase.from('checklist_items').insert(PRESET.map((text) => ({ trip_id: tripId, list: 'baby', text }))))
    setBusy(false)
  }

  return (
    <div className="stack">
      <section className="info-sec">
        <h2 className="info-h"><Icon as={Luggage} /> {t('מה לארוז לתינוק')}</h2>
        {items.length > 0 && (
          <div className="progress">
            <div style={{ width: `${(doneCount / items.length) * 100}%` }} />
            <span>
              {doneCount}/{items.length}
            </span>
          </div>
        )}
        <form className="add-row" onSubmit={add}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('הוספה…')} />
          <button className="primary" aria-label={t('הוספה')}><Icon as={Plus} size="1.25em" /></button>
        </form>
        {error && <LoadNote onRetry={reload} />}
        {!loading && !error && items.length === 0 && (
          <>
            <button className="secondary" onClick={addPreset} disabled={busy}>
              <Icon as={Sparkles} /> {t('הוספת רשימה מוכנה')}
            </button>
          </>
        )}
        {items.map((i) => (
          <div key={i.id} className={'item card slim' + (i.done ? ' done' : '')}>
            <button
              className="check"
              aria-label={i.done ? t('ביטול סימון') : t('סימון כבוצע')}
              onClick={() => mutate(supabase.from('checklist_items').update({ done: !i.done }).eq('id', i.id))}
            >
              {i.done ? <Icon as={Check} size="1em" strokeWidth={3} /> : null}
            </button>
            <div className="item-body">{i.text}</div>
            <button
              className="icon faint"
              aria-label={t('מחיקה')}
              onClick={() => confirm(t('למחוק את "{title}"?', { title: i.text })) && mutate(supabase.from('checklist_items').delete().eq('id', i.id))}
            >
              <Icon as={Trash2} size="1.25em" />
            </button>
          </div>
        ))}
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={Plane} /> {t('ביפן עם תינוק')}</h2>
        {TIPS.map((tip) => (
          <details key={tip.title} className="card tip">
            <summary>
              <span>
                <Icon as={tip.icon} /> {tip.title}
              </span>
            </summary>
            <ul>
              {tip.points.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </details>
        ))}
      </section>

      <section className="info-sec">
        <h2 className="info-h"><Icon as={Languages} /> {t('משפטים לתינוק')}</h2>
        <p className="muted small info-note">{t('לוחצים כדי להציג במסך מלא.')}</p>
        <PhraseList phrases={PHRASES.filter((p) => p.baby)} />
      </section>
    </div>
  )
}

const TIPS: { title: string; icon: LucideIcon; points: string[] }[] = [
  {
    title: t('חדרי הנקה ותינוקות'),
    icon: BabyIcon,
    points: [
      t('יש בכלבו, בקניונים, בתחנות גדולות ובשדות תעופה. מחפשים שלט 授乳室 (junyūshitsu) או ベビールーム (bebī rūmu), או סמל של בקבוק ותינוק.'),
      t('בכלבו הם בדרך כלל בקומת הילדים או ליד השירותים. לא מוצאים? שואלים בדלפק המידע (案内所) או את עובדי התחנה.'),
      t('בדרך כלל יש שולחן החתלה וכיסא, ובחלקם גם מים חמים להכנת תמ"ל. כל מקום שונה, אז לא לסמוך על זה.'),
      t('בשירותים רב-שימושיים ברוב תחנות הרכבת והמטרו יש שולחן החתלה.'),
    ],
  },
  {
    title: t('קניית תמ"ל וחיתולים'),
    icon: ShoppingCart,
    points: [
      t('דראגסטורים (Matsumoto Kiyoshi, Sundrug ועוד) וחנויות תינוקות כמו Akachan Honpo (赤ちゃん本舗) מוכרים תמ"ל, חיתולים ומגבונים.'),
      t('נוטרילון לא נמכר ביפן, גם חב״ד לא מצאו פתרון, ואין שם תמ"ל מסמיך (AR). מביאים מהארץ את כל הכמות לטיול ועוד קצת רזרבה.'),
      t('החזר מס לתיירים: מנובמבר 2026 משלמים בחנות מחיר מלא ומקבלים את המס בחזרה בשדה התעופה ביציאה מיפן. שומרים קבלות ומראים את הקניות בדלפק.'),
      t('תמ"ל יפני: Meiji Hohoemi (ほほえみ) ו-Morinaga, באבקה, בקופסאות או בקוביות. ההרכב והמינון שונים משל הארץ, אז מתייעצים עם רופא הילדים לפני שמחליפים מותג.'),
      t('חיתולים (Merries, Moony, Pampers) נמכרים לפי משקל. לוקחים את המידה לפי הקילוגרמים, לא לפי הגיל.'),
    ],
  },
  {
    title: t('תמ"ל נוזלי מוכן לשתייה'),
    icon: Milk,
    points: [
      t('תמ"ל נוזלי מוכן יש ביפן מאז 2019: Meiji Hohoemi Raku Raku Milk (ほほえみ らくらくミルク) ועוד, למשל של Glico. אין צורך לערבב או לחמם.'),
      t('נמכר בדראגסטורים, בחנויות תינוקות ובאינטרנט. יקר יותר מאבקה, אבל נוח לטיסה, לרכבת וליום עמוס.'),
      t('שופכים לבקבוק ולא מאכילים ישר מהפחית. אם מחממים, לא על להבה ולא במיקרוגל.'),
      t('לפני הקנייה בודקים שזה מתאים לגיל שלו (לפי האריזה). הזמינות משתנה, כדאי לחפש בדראגסטור גדול.'),
    ],
  },
  {
    title: t('מים חמים'),
    icon: Droplets,
    points: [
      t('תמ"ל מכינים עם מים ב-70 מעלות ומעלה, ואז מקררים. תרמוס מלא בבוקר הוא הפתרון הכי אמין.'),
      t('בחדרי תינוקות בקניונים ובכלבו לפעמים יש מים חמים (בערך 70-80 מעלות), וגם בשדות התעופה ובפארקי שעשועים.'),
      t('בקומביני לפעמים מוכרים מים חמים בבקבוק (白湯), אבל זה בתשלום.'),
      t('במלון מבקשים קומקום בקבלה אם אין בחדר, ומראים את כרטיס "מים חמים לחלב של התינוק" למטה.'),
    ],
  },
  {
    title: t('עגלה ברכבות ובתחנות'),
    icon: Train,
    points: [
      t('יש מעליות בתחנות, אבל לפעמים הן בקצה הרחוק של הרציף וצריך כמה מעברים עד אליהן. משאירים זמן נוסף.'),
      t('עם עגלה לוקחים מעלית ולא מדרגות נעות. כשצפוף מקפלים את העגלה ולוקחים את התינוק במנשא.'),
      t('כדאי להימנע משעות העומס, בערך 7:30-9:00 ו-17:00-19:00. הרכבות בטוקיו עמוסות מאוד, ועם עגלה זה קשה.'),
      t('קרונות קדמיים ואחוריים בדרך כלל פחות עמוסים. באוטובוסים בקיוטו קשה עם עגלה, אז עדיף מנשא.'),
      t('ב-Google Maps אפשר לבחור מסלול נגיש כדי למצוא תחנות ויציאות עם מעלית.'),
    ],
  },
  {
    title: t('חירום רפואי לתינוק'),
    icon: Stethoscope,
    points: [
      t('חום גבוה, קשיי נשימה או תינוק שלא מגיב: 119 (חינם). אומרים 救急 (kyūkyū) ו-赤ちゃん (akachan). בהרבה ערים מחברים מתורגמן, לא מנתקים.'),
      t('#8000 הוא קו ייעוץ טלפוני של אחיות לילדים, בערבים ובלילות ובסופי שבוע וחגים (השעות משתנות לפי המחוז). אין שם אבחנה, והשיחות בעיקר ביפנית, אז מבקשים מצוות המלון להתקשר.'),
      t('ל-Japan Visitor Hotline (050-3816-2787, 24 שעות באנגלית) אפשר להתקשר ולשאול איפה לפנות ואיזה בית חולים מתאים.'),
      t('מספר חירום של חברת הביטוח שומרים בעמוד "חירום", ומתקשרים אליהם לפני טיפול יקר.'),
    ],
  },
]
