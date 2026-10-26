import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'

// Accounts are created for the group up front; each logs in with just their name, in Hebrew or English.
const ACCOUNTS: Record<string, string> = {
  שקד: 'shaked',
  shaked: 'shaked',
  מאור: 'maor',
  maor: 'maor',
  אלמוג: 'almog',
  almog: 'almog',
  שניר: 'snir',
  snir: 'snir',
}

/**
 * The account's email for what was typed, or null when no one in the group has that name. A full name works
 * ("שקד פלורנטין"), and so do capitals, stray spaces and niqqud; an email address is taken as it is.
 */
export function toEmail(typed: string) {
  const n = typed.trim().toLowerCase()
  if (n.includes('@')) return n
  const first = n.normalize('NFKD').replace(/[֑-ׇ]/g, '').split(/\s+/)[0]
  return ACCOUNTS[first] ? `${ACCOUNTS[first]}@japantrip.app` : null
}

export default function Login() {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setMsg('')
    const email = toEmail(name)
    if (!email) {
      setMsg('לא מכירים את השם הזה. מתחברים בתור שקד, מאור, אלמוג או שניר.')
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (!error) return
    // tell apart the cases a person can act on: no signal, too many tries, and a wrong password
    if (error.name === 'AuthRetryableFetchError' || !navigator.onLine) setMsg('אין חיבור לאינטרנט. נסו שוב כשיש קליטה.')
    else if (error.status === 429) setMsg('יותר מדי ניסיונות. חכו דקה ונסו שוב.')
    else if (email.endsWith('@japantrip.app')) setMsg('הסיסמה לא נכונה.')
    else setMsg('אימייל או סיסמה לא נכונים.')
  }

  return (
    <div className="login">
      <div className="hinomaru" />
      <h1>הטיול ליפן</h1>
      <p className="muted">מסלול, הזמנות והוצאות במקום אחד</p>
      <form onSubmit={submit} className="card">
        <input
          placeholder="שם (שקד / מאור / אלמוג / שניר)"
          aria-label="שם"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
        <input
          type="password"
          placeholder="סיסמה"
          aria-label="סיסמה"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          dir="ltr"
        />
        <button className="primary" disabled={busy}>
          {busy ? 'מתחברים…' : 'התחברות'}
        </button>
        {msg && (
          <p className="msg" role="alert">
            {msg}
          </p>
        )}
      </form>
    </div>
  )
}
