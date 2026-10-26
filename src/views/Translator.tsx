import { useEffect, useRef, useState } from 'react'
import { Copy, Languages, Mic, Square, Volume2 } from 'lucide-react'
import { supabase } from '../supabase'
import { Icon } from '../icons'

/*
 * Voice translator between Hebrew and Japanese. Tap the language you are speaking, speak, tap again: the phone's
 * own speech recognition writes it down, Claude Haiku translates it (edge function `translate`), and the phone
 * reads the translation aloud in the other language. Recognition and speech are on the phone; only the text goes
 * to the server.
 */

type Lang = 'he-IL' | 'ja-JP'
const LANGS: { id: Lang; label: string; other: Lang }[] = [
  { id: 'he-IL', label: 'עברית', other: 'ja-JP' },
  { id: 'ja-JP', label: '日本語', other: 'he-IL' },
]

// the Web Speech API still ships prefixed in Safari and has no TypeScript types in lib.dom
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onsoundstart: (() => void) | null
  onspeechstart: (() => void) | null
}
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition

const ERRORS: Record<string, string> = {
  'not-allowed': 'אין הרשאה למיקרופון. אפשר לאשר בהגדרות > ספארי > מיקרופון.',
  'service-not-allowed': 'ספארי חוסם זיהוי דיבור כאן.',
  network: 'אין חיבור. זיהוי הדיבור צריך אינטרנט.',
  'no-speech': 'לא נשמע דיבור. נסו שוב קרוב יותר לטלפון.',
  'audio-capture': 'לא נמצא מיקרופון.',
  'language-not-supported': 'השפה הזאת לא נתמכת בזיהוי בטלפון הזה.',
}

const standalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

/** Why a translation failed, in words a traveller can act on. */
async function translateError(error: unknown) {
  const res = (error as { context?: Response } | null)?.context
  const body = await res?.clone().json().catch(() => null)
  if (res?.status === 429)
    return /daily limit/.test(body?.error ?? '') ? 'הגעתם למגבלה היומית (200 תרגומים ביום לכל אחד).' : 'השירות עמוס. נסו שוב בעוד דקה.'
  if (!navigator.onLine) return 'אין חיבור לאינטרנט.'
  return `התרגום לא הצליח${res?.status ? ` (${res.status}${body?.error ? `: ${body.error}` : ''})` : ''}.`
}

export default function Translator() {
  const [lang, setLang] = useState<Lang>('he-IL')
  const [listening, setListening] = useState(false)
  const [heard, setHeard] = useState('')
  const [interim, setInterim] = useState('')
  const [translation, setTranslation] = useState<{ text: string; romaji: string; lang: Lang } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const [log, setLog] = useState<string[]>([])
  const [spoke, setSpoke] = useState('')
  const rec = useRef<Recognition | null>(null)
  const stopping = useRef(false)
  const live = useRef(false)
  const unlocked = useRef(false)
  const t0 = useRef(0)
  const watchdog = useRef<ReturnType<typeof setTimeout>>()
  const forceStop = useRef<ReturnType<typeof setTimeout>>()
  // a timed trail of what the recognizer reported, for the technical details
  const note = (what: string) => setLog((l) => [...l, `${((performance.now() - t0.current) / 1000).toFixed(1)}s ${what}`])
  const reset = () => {
    clearTimeout(watchdog.current)
    clearTimeout(forceStop.current)
    live.current = false
    setListening(false)
    setInterim('')
  }

  // voices load late in Safari; listen until they arrive
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const load = () => setVoices(speechSynthesis.getVoices())
    load()
    speechSynthesis.addEventListener('voiceschanged', load)
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', load)
      rec.current?.abort()
    }
  }, [])

  // read aloud in the text's own language: kana or kanji in Japanese, anything else in Hebrew. Prefer an exact
  // voice (ja-JP), then any voice of the language; without one Safari reads in the phone's own language
  const say = (text: string) => {
    if (!text || !('speechSynthesis' in window)) return
    const as: Lang = /[぀-ヿ一-鿿]/.test(text) ? 'ja-JP' : 'he-IL'
    const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-')
    const all = speechSynthesis.getVoices()
    const v = all.find((x) => norm(x) === as) ?? all.find((x) => norm(x).startsWith(as.slice(0, 2)))
    const u = new SpeechSynthesisUtterance(text)
    u.lang = as
    if (v) u.voice = v
    setSpoke(`${as}, קול: ${v ? `${v.name} (${norm(v)})` : 'לא נמצא, ברירת מחדל'}`)
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  const translate = async (text: string, from: Lang) => {
    const to = from === 'he-IL' ? 'ja-JP' : 'he-IL'
    setBusy(true)
    note('שולח לתרגום')
    const { data, error } = await supabase.functions.invoke('translate', { body: { text, from: from.slice(0, 2) } })
    setBusy(false)
    if (error || !data?.translation) {
      note('התרגום נכשל')
      setError(await translateError(error))
      return
    }
    note('התקבל תרגום')
    setTranslation({ text: data.translation, romaji: data.romaji ?? '', lang: to })
    say(data.translation)
  }

  // each language is its own button: a tap starts recording in it, a second tap on the same one stops
  const toggle = (from: Lang) => {
    // iPhone reads aloud only after a tap has started speech once; the translation arrives later, so start an
    // empty utterance now, while this tap counts
    if (!unlocked.current && 'speechSynthesis' in window) {
      speechSynthesis.speak(new SpeechSynthesisUtterance(''))
      unlocked.current = true
    }
    if (listening) {
      stopping.current = true
      note('נלחץ עצירה')
      const r = rec.current
      r?.stop()
      // a recognizer that never really started may never end: free the button regardless. Tied to this
      // recognizer, so a quick stop-and-start can't let it cut the next recording short
      forceStop.current = setTimeout(() => {
        if (!live.current || rec.current !== r) return
        r?.abort()
        note('לא נגמר תוך שנייה וחצי, עצרתי בכוח')
        reset()
      }, 1500)
      return
    }
    if (!Recognizer) return
    speechSynthesis?.cancel()
    setLang(from)
    setHeard('')
    setInterim('')
    setTranslation(null)
    setError('')
    setLog([])
    clearTimeout(forceStop.current)
    stopping.current = false
    t0.current = performance.now()
    const r = new Recognizer()
    r.lang = from
    r.continuous = true
    r.interimResults = true
    // every event carries the whole session's results, so rebuild both parts from the start each time;
    // adding only the changed ones repeats words when Safari resends a result it already finalised
    let final = ''
    let pending = ''
    r.onstart = () => note('התחיל')
    r.onaudiostart = () => {
      clearTimeout(watchdog.current)
      note('המיקרופון נפתח')
    }
    r.onsoundstart = () => note('נשמע קול')
    r.onspeechstart = () => note('זוהה דיבור')
    r.onresult = (e) => {
      final = ''
      pending = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += res[0].transcript
        else pending += res[0].transcript
      }
      setHeard(final)
      setInterim(pending)
    }
    r.onerror = (e) => {
      note(`שגיאה: ${e.error}`)
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `שגיאה: ${e.error}`)
    }
    // whatever was heard when recording ends, by a tap or by Safari after a pause, goes to translation; words
    // still pending at the stop count too, since Safari doesn't always finalise the last one
    r.onend = () => {
      note('נגמר')
      reset()
      if (rec.current !== r) return
      const said = (final + pending).trim()
      setHeard(said)
      if (said) translate(said, from)
    }
    rec.current = r
    try {
      note('קריאה ל-start')
      r.start()
      live.current = true
      setListening(true)
      // the microphone should open within a moment; if it doesn't, say so instead of waiting forever
      watchdog.current = setTimeout(() => {
        if (!live.current || rec.current !== r) return
        note('המיקרופון לא נפתח תוך 4 שניות')
        setError('המיקרופון לא נפתח. סגרו את האפליקציה ופתחו מחדש, ונסו שוב.')
        r.abort()
        reset()
      }, 4000)
    } catch (err) {
      note(`start נכשל: ${(err as Error).message}`)
      setError(`לא הצלחתי להתחיל: ${(err as Error).message}`)
    }
  }

  const voiceFor = (code: string) =>
    voices.filter((v) => v.lang.replace('_', '-').startsWith(code)).map((v) => v.name).slice(0, 3).join(', ') || 'אין'
  const report = [
    `זיהוי דיבור: ${Recognizer ? 'קיים' : 'לא קיים'}`,
    `נפתח מ: ${standalone() ? 'מסך הבית' : 'ספארי'}`,
    `קול בעברית: ${voiceFor('he')}`,
    `קול ביפנית: ${voiceFor('ja')}`,
    `שפה אחרונה: ${lang}`,
    `נשמע: ${heard || '(ריק)'}`,
    translation && `תרגום: ${translation.text}`,
    error && `שגיאה: ${error}`,
    spoke && `השמעה אחרונה: ${spoke}`,
    log.length > 0 && `אירועים:\n${log.join('\n')}`,
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <section className="info-sec">
      <h2 className="info-h">
        <Icon as={Languages} /> תרגום קולי
      </h2>
      <div className="card voice-test">
        <p className="muted small">לוחצים על השפה שמדברים בה, מדברים, ולוחצים שוב. התרגום מופיע ומוקרא בשפה השנייה.</p>
        {Recognizer ? (
          <div className="rec-row">
            {LANGS.map((l) => {
              const on = listening && lang === l.id
              return (
                <button
                  key={l.id}
                  className={'rec-btn' + (on ? ' on' : '')}
                  aria-pressed={on}
                  aria-label={on ? `עצירה ותרגום מ${l.label}` : `דיבור ב${l.label}`}
                  disabled={(listening && !on) || busy}
                  onClick={() => toggle(l.id)}
                >
                  <Icon as={on ? Square : Mic} size="1.5rem" />
                  <span lang={l.id}>{on ? 'עצירה' : l.label}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="msg">זיהוי דיבור לא קיים בדפדפן הזה.</p>
        )}
        <div className="voice-out" aria-live="polite">
          {(heard || interim) && (
            <p className="voice-heard muted" lang={lang} dir="auto">
              {heard}
              {interim && ` ${interim}`}
            </p>
          )}
          {busy && <p className="muted">מתרגם…</p>}
          {translation && (
            <>
              <p className="voice-translation" lang={translation.lang} dir="auto">
                {translation.text}
              </p>
              {translation.romaji && (
                <p className="voice-romaji muted" lang="ja-Latn" dir="ltr">
                  {translation.romaji}
                </p>
              )}
            </>
          )}
          {!heard && !interim && !busy && !translation && (
            <p className="muted">{listening ? 'מקשיב…' : 'התרגום יופיע כאן'}</p>
          )}
        </div>
        {error && (
          <p className="msg" role="alert">
            {error}
          </p>
        )}
        <button className="secondary" disabled={!translation || listening} onClick={() => translation && say(translation.text)}>
          <Icon as={Volume2} /> השמעה שוב
        </button>
        <details className="voice-details">
          <summary>פרטים טכניים</summary>
          <pre className="voice-report">{report}</pre>
          <button className="link" onClick={() => navigator.clipboard.writeText(report).then(() => alert('הועתק. אפשר להדביק לי בצ׳אט'))}>
            <Icon as={Copy} /> העתקת הפרטים
          </button>
        </details>
      </div>
    </section>
  )
}
