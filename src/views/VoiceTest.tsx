import { useEffect, useRef, useState } from 'react'
import { Copy, Mic, Square, Volume2 } from 'lucide-react'
import { Icon } from '../icons'

/*
 * A trial before building translation: does the phone's own speech recognition work in this app (Safari and,
 * the open question, the home-screen app), in Hebrew and in Japanese, and does it have voices to read back?
 * One tap starts recording, a second tap stops it. Nothing leaves the phone except what Safari itself sends to
 * Apple for dictation; no Claude call is made here.
 */

type Lang = 'he-IL' | 'ja-JP'
const LANGS: { id: Lang; label: string }[] = [
  { id: 'he-IL', label: 'עברית' },
  { id: 'ja-JP', label: '日本語' },
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
}
const Recognizer = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition })
  .SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition

const ERRORS: Record<string, string> = {
  'not-allowed': 'אין הרשאה למיקרופון. אפשר לאשר בהגדרות > ספארי > מיקרופון.',
  'service-not-allowed': 'ספארי חוסם זיהוי דיבור כאן. זה בדיוק מה שבודקים: קורה לפעמים כשהאפליקציה פתוחה ממסך הבית.',
  network: 'אין חיבור. זיהוי הדיבור צריך אינטרנט.',
  'no-speech': 'לא נשמע דיבור. נסו שוב קרוב יותר לטלפון.',
  'audio-capture': 'לא נמצא מיקרופון.',
  'language-not-supported': 'השפה הזאת לא נתמכת בזיהוי בטלפון הזה.',
}

const standalone = () =>
  (navigator as unknown as { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches

export default function VoiceTest() {
  const [lang, setLang] = useState<Lang>('he-IL')
  const [listening, setListening] = useState(false)
  const [text, setText] = useState('')
  const [interim, setInterim] = useState('')
  const [error, setError] = useState('')
  const [endedAlone, setEndedAlone] = useState(false)
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([])
  const rec = useRef<Recognition | null>(null)
  const stopping = useRef(false)

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

  const toggle = () => {
    if (listening) {
      stopping.current = true
      rec.current?.stop()
      return
    }
    if (!Recognizer) return
    setText('')
    setInterim('')
    setError('')
    setEndedAlone(false)
    stopping.current = false
    const r = new Recognizer()
    r.lang = lang
    r.continuous = true
    r.interimResults = true
    // every event carries the whole session's results, so rebuild both parts from the start each time;
    // adding only the changed ones repeats words when Safari resends a result it already finalised
    r.onresult = (e) => {
      let final = ''
      let live = ''
      for (let i = 0; i < e.results.length; i++) {
        const res = e.results[i]
        if (res.isFinal) final += res[0].transcript
        else live += res[0].transcript
      }
      setText(final)
      setInterim(live)
    }
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `שגיאה: ${e.error}`)
    }
    // Safari can end a session on its own after a pause; worth knowing before relying on a second tap to stop
    r.onend = () => {
      setListening(false)
      setInterim('')
      if (!stopping.current) setEndedAlone(true)
    }
    rec.current = r
    try {
      r.start()
      setListening(true)
    } catch (err) {
      setError(`לא הצלחתי להתחיל: ${(err as Error).message}`)
    }
  }

  const say = () => {
    const u = new SpeechSynthesisUtterance(text)
    u.lang = lang
    const v = voices.find((x) => x.lang.replace('_', '-').startsWith(lang.slice(0, 2)))
    if (v) u.voice = v
    speechSynthesis.cancel()
    speechSynthesis.speak(u)
  }

  const voiceFor = (code: string) =>
    voices.filter((v) => v.lang.replace('_', '-').startsWith(code)).map((v) => v.name).slice(0, 3).join(', ') || 'אין'
  const report = [
    `זיהוי דיבור: ${Recognizer ? 'קיים' : 'לא קיים'}`,
    `נפתח מ: ${standalone() ? 'מסך הבית' : 'ספארי'}`,
    `קול בעברית: ${voiceFor('he')}`,
    `קול ביפנית: ${voiceFor('ja')}`,
    `שפה אחרונה: ${lang}`,
    `תוצאה: ${text || '(ריק)'}`,
    error && `שגיאה: ${error}`,
    endedAlone && 'ההקלטה נעצרה לבד לפני הלחיצה השנייה',
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <section className="info-sec">
      <h2 className="info-h">
        <Icon as={Mic} /> בדיקת תרגום קולי
      </h2>
      <div className="card voice-test">
        <p className="muted small">
          לחיצה אחת מתחילה הקלטה, לחיצה שנייה עוצרת. בודקים שהטלפון מזהה עברית ויפנית כאן באפליקציה, לפני שבונים תרגום.
        </p>
        <div className="segmented" role="radiogroup" aria-label="שפת הדיבור">
          {LANGS.map((l) => (
            <button
              key={l.id}
              role="radio"
              aria-checked={lang === l.id}
              className={lang === l.id ? 'on' : ''}
              disabled={listening}
              onClick={() => setLang(l.id)}
            >
              {l.label}
            </button>
          ))}
        </div>
        {Recognizer ? (
          <button className={'rec-btn' + (listening ? ' on' : '')} aria-pressed={listening} onClick={toggle}>
            <Icon as={listening ? Square : Mic} size="1.75rem" />
            <span>{listening ? 'עצירה' : 'התחלת הקלטה'}</span>
          </button>
        ) : (
          <p className="msg">זיהוי דיבור לא קיים בדפדפן הזה.</p>
        )}
        <div className="voice-out" lang={lang} dir="auto" aria-live="polite">
          {text}
          {interim && <span className="muted"> {interim}</span>}
          {!text && !interim && <span className="muted">{listening ? 'מקשיב…' : 'מה שתגידו יופיע כאן'}</span>}
        </div>
        {error && (
          <p className="msg" role="alert">
            {error}
          </p>
        )}
        {endedAlone && !error && <p className="muted small">ההקלטה נעצרה לבד אחרי שקט, לפני הלחיצה השנייה.</p>}
        <div className="row nowrap">
          <button className="secondary" disabled={!text || listening || !('speechSynthesis' in window)} onClick={say}>
            <Icon as={Volume2} /> השמעה
          </button>
          <button className="secondary" onClick={() => navigator.clipboard.writeText(report).then(() => alert('הועתק. אפשר להדביק לי בצ׳אט'))}>
            <Icon as={Copy} /> העתקה
          </button>
        </div>
        <pre className="voice-report">{report}</pre>
      </div>
    </section>
  )
}
