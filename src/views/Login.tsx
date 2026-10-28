import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'
import { t } from '../i18n'

// Accounts are created for the group up front; each logs in with just their name, in Hebrew or English.
const ACCOUNTS: Record<string, string> = {
  שקד: 'shaked', // he-only
  shaked: 'shaked',
  מאור: 'maor', // he-only
  maor: 'maor',
  אלמוג: 'almog', // he-only
  almog: 'almog',
  שניר: 'snir', // he-only
  snir: 'snir',
}

/**
 * The account's email for what was typed, or null when no one in the group has that name. A full name works
 * ("שקד פלורנטין"), and so do capitals, stray spaces and niqqud; an email address is taken as it is.
 */
export function toEmail(typed: string) {
  const n = typed.trim().toLowerCase()
  if (n.includes('@')) return n
  const first = n.normalize('NFKD').replace(/[֑-ׇ]/g, '').split(/\s+/)[0] // he-only
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
      setMsg(t('לא מכירים את השם. אפשר שקד, מאור, אלמוג או שניר.'))
      return
    }
    setBusy(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (!error) return
    // tell apart the cases a person can act on: no signal, too many tries, and a wrong password
    if (error.name === 'AuthRetryableFetchError' || !navigator.onLine) setMsg(t('אין אינטרנט. נסו שוב כשיש קליטה.'))
    else if (error.status === 429) setMsg(t('יותר מדי ניסיונות. חכו דקה ונסו שוב.'))
    else if (email.endsWith('@japantrip.app')) setMsg(t('הסיסמה לא נכונה.'))
    else setMsg(t('אימייל או סיסמה לא נכונים.'))
  }

  return (
    <div className="login">
      <div className="hinomaru" />
      <h1>{t('הטיול ליפן')}</h1>
      <p className="muted">{t('מסלול, הזמנות והוצאות במקום אחד')}</p>
      <form onSubmit={submit} className="card">
        <input
          placeholder={t('שם (שקד / מאור / אלמוג / שניר)')}
          aria-label={t('שם')}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
        <input
          type="password"
          placeholder={t('סיסמה')}
          aria-label={t('סיסמה')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          dir="ltr"
        />
        <button className="primary" disabled={busy}>
          {busy ? t('מתחברים…') : t('התחברות')}
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
