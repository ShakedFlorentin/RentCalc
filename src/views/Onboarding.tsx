import { useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { readCache, writeCache } from '../lib'
import { neverOf } from '../prefs'
import { t } from '../i18n'
import type { Answers, InterestKind, Profile } from '../types'
import { Icon } from '../icons'
import { Check, ChevronRight } from 'lucide-react'
import '../styles/onboard.css'

/**
 * This person's questionnaire row (profiles), kept on the phone like the trip's data so Discover opens filtered with
 * no network. `profile` is undefined until the first answer (no saved copy yet), null when there is no row, and
 * `failed` says the server couldn't be asked.
 */
export function useProfile(userId: string) {
  const key = 'profile:' + userId
  const [profile, setProfile] = useState<Profile | null | undefined>(() => {
    const c = readCache<Profile | null>(key)
    return c ? c.data : undefined
  })
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    supabase
      .from('profiles')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!live) return
        // offline is not "never answered": keep the saved copy, or carry on without one
        if (error) {
          setFailed(true)
          setProfile((p) => (p === undefined ? null : p))
          return
        }
        writeCache(key, data)
        setProfile(data as Profile | null)
      })
    return () => {
      live = false
    }
  }, [key, userId])
  const saved = (p: Profile) => {
    writeCache(key, p)
    setProfile(p)
  }
  return { profile, failed, saved }
}

type Opt<T> = { id: T; label: string; sub?: string }

const WITH: Opt<Answers['with'][number]>[] = [
  { id: 'partner', label: t('בן או בת זוג') },
  { id: 'baby', label: t('תינוק עד גיל שנתיים') },
  { id: 'kids', label: t('ילדים 3–12') },
  { id: 'friends', label: t('חברים') },
  { id: 'solo', label: t('לבד') },
]
const CITIES: Opt<Answers['cities'][number]>[] = [
  { id: 'tokyo', label: t('טוקיו') },
  { id: 'kyoto', label: t('קיוטו') },
  { id: 'osaka', label: t('אוסקה') },
  { id: 'nara', label: t('נארה') },
  { id: 'daytrip', label: t('טיולי יום מחוץ לערים') },
]
const KINDS: Opt<InterestKind>[] = [
  { id: 'food', label: t('מסעדות') },
  { id: 'cafe', label: t('בתי קפה וקינוחים') },
  { id: 'sights', label: t('מקדשים וגנים') },
  { id: 'views', label: t('תצפיות') },
  { id: 'shopping', label: t('קניות ושווקים') },
  { id: 'experience', label: t('חוויות'), sub: t('אקווריומים, מוזיאונים, פארקי שעשועים') },
  { id: 'nightlife', label: t('ברים וחיי לילה') },
]
const LEVELS: Opt<Answers['interest'][InterestKind]>[] = [
  { id: 'love', label: t('ממש אוהבים') },
  { id: 'ok', label: t('אפשר') },
  { id: 'no', label: t('לא בשבילנו') },
]
// question 4 asks what they eat; whatever is left unticked is saved as `never`
const EATS: Opt<Answers['never'][number]>[] = [
  { id: 'chicken', label: t('עוף') },
  { id: 'beef', label: t('בקר') },
  { id: 'pork', label: t('חזיר') },
  { id: 'fish', label: t('דגים') },
  { id: 'seafood', label: t('פירות ים'), sub: t('שרימפס, קלמרי, תמנון, צדפות') },
]
const LOVES: Opt<Answers['loves'][number]>[] = [
  { id: 'ramen', label: t('ראמן') },
  { id: 'sushi', label: t('סושי') },
  { id: 'yakiniku', label: t('יקיניקו ווואגיו') },
  { id: 'street', label: t('אוכל רחוב') },
  { id: 'sweets', label: t('קינוחים ומאצ׳ה') },
  { id: 'izakaya', label: t('איזקאיה') },
  { id: 'chef', label: t('ארוחת שף'), sub: t('אומקסה, קאיסקי') },
]
const BUDGETS: Opt<Answers['budget']>[] = [
  { id: 1500, label: t('עד ¥1,500'), sub: t('כ־40 ₪') },
  { id: 5000, label: t('עד ¥5,000'), sub: t('כ־130 ₪') },
  { id: 15000, label: t('עד ¥15,000'), sub: t('כ־400 ₪') },
  { id: null, label: t('לא משנה') },
]
const PACES: Opt<Answers['pace']>[] = [
  { id: 'relaxed', label: t('רגוע'), sub: t('5–6 שעות של פעילויות') },
  { id: 'balanced', label: t('מאוזן'), sub: t('7–8 שעות') },
  { id: 'packed', label: t('אינטנסיבי'), sub: t('9 שעות ומעלה') },
]
const MAX_LOVES = 3

/** The answers so far: a single choice not made yet is undefined (budget's "doesn't matter" is null). */
type Draft = Omit<Answers, 'interest' | 'kosher' | 'budget' | 'pace'> & {
  interest: Partial<Answers['interest']>
  budget?: Answers['budget']
  pace?: Answers['pace']
}

const QUESTIONS: { title: string; hint?: string; ready: (d: Draft) => boolean }[] = [
  { title: t('עם מי אתם נוסעים?'), hint: t('אפשר לבחור כמה'), ready: (d) => d.with.length > 0 },
  { title: t('אילו ערים בתוכנית?'), hint: t('אפשר לבחור כמה'), ready: (d) => d.cities.length > 0 },
  { title: t('כמה כל סוג מקום מעניין אתכם?'), ready: (d) => KINDS.every((k) => d.interest[k.id]) },
  { title: t('מה אתם אוכלים?'), hint: t('מסמנים את כל מה שאוכלים'), ready: () => true },
  { title: t('מה הכי מושך אתכם באוכל ביפן?'), hint: t('עד שלושה'), ready: (d) => d.loves.length > 0 },
  { title: t('כמה מוכנים להוציא על ארוחה, לאדם?'), ready: (d) => d.budget !== undefined },
  { title: t('איזה קצב יום מתאים לכם?'), ready: (d) => !!d.pace },
]

type Props = {
  userId: string
  /** the saved answers, when opened again from settings */
  initial?: Partial<Answers> | null
  onDone: (p: Profile) => void
  /** from settings only: a new person has to answer before the app opens */
  onClose?: () => void
}

/** The getting-to-know-you questions, one per screen, full screen. Saving tailors the Discover deck to this person. */
export default function Onboarding({ userId, initial, onDone, onClose }: Props) {
  const [d, setD] = useState<Draft>(() => ({
    with: initial?.with ?? [],
    cities: initial?.cities ?? [],
    interest: initial?.interest ?? {},
    never: initial ? neverOf(initial) : [],
    loves: initial?.loves ?? [],
    budget: initial?.budget,
    pace: initial?.pace,
  }))
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const head = useRef<HTMLHeadingElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const last = step === QUESTIONS.length

  // each screen starts at its top, and a screen reader hears the new question
  useEffect(() => {
    box.current?.scrollTo({ top: 0 })
    head.current?.focus({ preventScroll: true })
  }, [step])

  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }))
  const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

  const save = async () => {
    const answers: Answers = {
      with: d.with,
      cities: d.cities,
      interest: d.interest as Answers['interest'],
      never: d.never,
      loves: d.loves,
      budget: d.budget ?? null,
      pace: d.pace!,
    }
    const now = new Date().toISOString()
    const row: Profile = { user_id: userId, answers, completed_at: now, updated_at: now }
    setBusy(true)
    setMsg('')
    const { error } = await supabase.from('profiles').upsert(row, { onConflict: 'user_id' })
    setBusy(false)
    if (error) return setMsg(t('לא הצלחנו לשמור. בדקו את החיבור ונסו שוב.'))
    onDone(row)
  }

  const q = QUESTIONS[step]
  const ready = last || q.ready(d)
  const next = () => (last ? save() : setStep(step + 1))

  return (
    <div className="onboard" ref={box}>
      <div className="ob-inner">
        <div className="ob-top">
          {step > 0 ? (
            <button className="ob-back" onClick={() => setStep(step - 1)} aria-label={t('חזרה')}>
              <Icon as={ChevronRight} size="1.5em" className="flip-ltr" />
            </button>
          ) : (
            <span />
          )}
          <div
            className="ob-dots"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={QUESTIONS.length + 1}
            aria-valuenow={step + 1}
            aria-label={t('התקדמות')}
          >
            {[...QUESTIONS, null].map((_, i) => (
              <span key={i} className={i < step ? 'done' : i === step ? 'now' : ''} />
            ))}
          </div>
          {onClose ? (
            <button className="ob-close" onClick={onClose}>
              {t('סגירה')}
            </button>
          ) : (
            <span />
          )}
        </div>

        <div className="ob-body">
          {step === 0 && !onClose && <p className="muted ob-intro">{t('כמה שאלות קצרות, כדי שבגילוי יופיעו רק מקומות שמתאימים לכם.')}</p>}
          <h2 ref={head} tabIndex={-1} className="ob-title" id="ob-q">
            {last ? t('זהו, סיימנו') : q.title}
          </h2>
          {!last && q.hint && <p className="muted small ob-hint">{q.hint}</p>}

          {step === 0 && (
            <Chips
              opts={WITH}
              on={d.with}
              // alone or with someone, not both
              pick={(v) => set('with', v === 'solo' ? (d.with.includes('solo') ? [] : ['solo']) : toggle(d.with.filter((x) => x !== 'solo'), v))}
            />
          )}
          {step === 1 && <Chips opts={CITIES} on={d.cities} pick={(v) => set('cities', toggle(d.cities, v))} />}
          {step === 2 && (
            <div className="ob-rows">
              {KINDS.map((k) => (
                <div key={k.id} className="ob-row">
                  <div className="ob-row-label" id={'ob-k-' + k.id}>
                    <b>{k.label}</b>
                    {k.sub && <span className="muted small">{k.sub}</span>}
                  </div>
                  <div className="segmented ob-seg" role="radiogroup" aria-labelledby={'ob-k-' + k.id}>
                    {LEVELS.map((l) => (
                      <button
                        key={l.id}
                        role="radio"
                        aria-checked={d.interest[k.id] === l.id}
                        className={d.interest[k.id] === l.id ? 'on' : ''}
                        onClick={() => set('interest', { ...d.interest, [k.id]: l.id })}
                      >
                        {l.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          {step === 3 && (
            <Chips
              opts={EATS}
              on={EATS.map((o) => o.id).filter((id) => !d.never.includes(id))}
              pick={(v) => set('never', toggle(d.never, v))}
            />
          )}
          {step === 4 && (
            <Chips
              opts={LOVES}
              on={d.loves}
              // a fourth pick is refused rather than silently dropping an earlier one
              disabled={(v) => !d.loves.includes(v) && d.loves.length >= MAX_LOVES}
              pick={(v) => set('loves', toggle(d.loves, v))}
            />
          )}
          {step === 5 && <Choice opts={BUDGETS} on={d.budget} pick={(v) => set('budget', v)} />}
          {step === 6 && <Choice opts={PACES} on={d.pace} pick={(v) => set('pace', v)} />}
          {last && (
            <div className="ob-final">
              <span className="ob-final-mark" aria-hidden="true">
                <Icon as={Check} size="2em" />
              </span>
              <p>{t('בגילוי נראה לכם רק מקומות שמתאימים, והמתאימים ביותר יופיעו ראשונים.')}</p>
              <p className="muted">{t('אפשר לשנות את התשובות בכל רגע: עוד › ההעדפות שלי.')}</p>
            </div>
          )}
        </div>

        <div className="ob-foot">
          {msg && (
            <p className="msg" role="alert">
              {msg}
            </p>
          )}
          <button className="primary" disabled={!ready || busy} onClick={next}>
            {busy ? t('שומרים…') : last ? (onClose ? t('שמירה') : t('סיום')) : t('הבא')}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Several answers: big chips that stay on when tapped. */
function Chips<T>(props: { opts: Opt<T>[]; on: T[]; pick: (v: T) => void; disabled?: (v: T) => boolean }) {
  return (
    <div className="ob-chips">
      {props.opts.map((o) => {
        const on = props.on.includes(o.id)
        return (
          <button
            key={String(o.id)}
            className={'ob-chip' + (on ? ' on' : '')}
            aria-pressed={on}
            disabled={props.disabled?.(o.id)}
            onClick={() => props.pick(o.id)}
          >
            {on && <Icon as={Check} />}
            <span>
              {o.label}
              {o.sub && <span className="ob-sub"> ({o.sub})</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** One answer: full-width rows, the chosen one ticked. */
function Choice<T>(props: { opts: Opt<T>[]; on: T | undefined; pick: (v: T) => void }) {
  return (
    <div className="ob-choices" role="radiogroup" aria-labelledby="ob-q">
      {props.opts.map((o) => {
        const on = props.on === o.id
        return (
          <button key={String(o.id)} role="radio" aria-checked={on} className={'ob-choice' + (on ? ' on' : '')} onClick={() => props.pick(o.id)}>
            <span className="ob-choice-text">
              <b>{o.label}</b>
              {o.sub && <span className="muted small">{o.sub}</span>}
            </span>
            <span className="ob-tick" aria-hidden="true">
              {on && <Icon as={Check} />}
            </span>
          </button>
        )
      })}
    </div>
  )
}
