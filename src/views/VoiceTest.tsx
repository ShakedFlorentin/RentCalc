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
  onstart: (() => void) | null
  onaudiostart: (() => void) | null
  onsoundstart: (() => void) | null
  onspeechstart: (() => void) | null
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
  const [log, setLog] = useState<string[]>([])
  const [mic, setMic] = useState('')
  const [spoke, setSpoke] = useState('')
  const rec = useRef<Recognition | null>(null)
  const stopping = useRef(false)
  const live = useRef(false)
  const t0 = useRef(0)
  const watchdog = useRef<ReturnType<typeof setTimeout>>()
  // a timed trail of what the recognizer reported, so a hang shows where it stopped
  const note = (what: string) => setLog((l) => [...l, `${((performance.now() - t0.current) / 1000).toFixed(1)}s ${what}`])
  const forceStop = useRef<ReturnType<typeof setTimeout>>()
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

  // each language is its own button: a tap starts recording in it, a second tap on the same one stops
  const toggle = (to: Lang) => {
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
    setLang(to)
    setText('')
    setInterim('')
    setError('')
    setEndedAlone(false)
    setLog([])
    clearTimeout(forceStop.current)
    stopping.current = false
    t0.current = performance.now()
    const r = new Recognizer()
    r.lang = to
    r.continuous = true
    r.interimResults = true
    // every event carries the whole session's results, so rebuild both parts from the start each time;
    // adding only the changed ones repeats words when Safari resends a result it already finalised
    let heard = false
    r.onstart = () => note('התחיל')
    r.onaudiostart = () => {
      clearTimeout(watchdog.current)
      note('המיקרופון נפתח')
    }
    r.onsoundstart = () => note('נשמע קול')
    r.onspeechstart = () => note('זוהה דיבור')
    r.onresult = (e) => {
      if (!heard) note('תוצאה ראשונה')
      heard = true
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
      note(`שגיאה: ${e.error}`)
      if (e.error !== 'aborted') setError(ERRORS[e.error] ?? `שגיאה: ${e.error}`)
    }
    // Safari can end a session on its own after a pause; worth knowing before relying on a second tap to stop
    r.onend = () => {
      note('נגמר')
      reset()
      if (!stopping.current) setEndedAlone(true)
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
        setError('המיקרופון לא נפתח. ייתכן שספארי חוסם זיהוי דיבור באפליקציה ממסך הבית.')
        r.abort()
        reset()
      }, 4000)
    } catch (err) {
      note(`start נכשל: ${(err as Error).message}`)
      setError(`לא הצלחתי להתחיל: ${(err as Error).message}`)
    }
  }

  // the microphone alone, without speech recognition: if this works where recognition doesn't, recording audio
  // in the app and sending it for transcription is a way out
  const checkMic = async () => {
    setMic('בודק…')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMic('עובד')
    } catch (err) {
      setMic(`לא עובד (${(err as Error).name})`)
    }
  }

  // the voice follows the text, not the last button: kana or kanji read in Japanese, anything else in Hebrew.
  // Prefer an exact match (ja-JP), then any voice of the language; without one Safari falls back to the
  // phone's own language, which is what read Japanese in Hebrew
  const say = () => {
    const speak: Lang = /[\u3040-\u30ff\u4e00-\u9fff]/.test(text) ? 'ja-JP' : 'he-IL'
    const norm = (v: SpeechSynthesisVoice) => v.lang.replace('_', '-')
    const v = voices.find((x) => norm(x) === speak) ?? voices.find((x) => norm(x).startsWith(speak.slice(0, 2)))
    const u = new SpeechSynthesisUtterance(text)
    u.lang = speak
    if (v) u.voice = v
    setSpoke(`${speak}, קול: ${v ? `${v.name} (${norm(v)})` : 'לא נמצא, ברירת מחדל'}`)
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
    mic && `מיקרופון ישיר: ${mic}`,
    spoke && `השמעה אחרונה: ${spoke}`,
    log.length > 0 && `אירועים:\n${log.join('\n')}`,
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
          לוחצים על השפה שמדברים בה כדי להקליט, ולוחצים שוב כדי לעצור. בודקים שהטלפון מזהה עברית ויפנית כאן באפליקציה, לפני שבונים תרגום.
        </p>
        {Recognizer ? (
          <div className="rec-row">
            {LANGS.map((l) => {
              const on = listening && lang === l.id
              return (
                <button
                  key={l.id}
                  className={'rec-btn' + (on ? ' on' : '')}
                  aria-pressed={on}
                  aria-label={on ? `עצירת הקלטה ב${l.label}` : `הקלטה ב${l.label}`}
                  disabled={listening && !on}
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
        <button className="link" onClick={checkMic}>
          בדיקת מיקרופון ישירה{mic && `: ${mic}`}
        </button>
        <pre className="voice-report">{report}</pre>
      </div>
    </section>
  )
}
