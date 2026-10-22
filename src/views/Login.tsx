import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'

// Accounts are created for the group up front; each logs in with just their name.
const HEBREW_NAMES: Record<string, string> = { שקד: 'shaked', מאור: 'maor', אלמוג: 'almog', שניר: 'snir' }

function toEmail(name: string) {
  const n = name.trim().toLowerCase()
  if (n.includes('@')) return n
  return `${HEBREW_NAMES[n] ?? n}@japantrip.app`
}

export default function Login() {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    const { error } = await supabase.auth.signInWithPassword({ email: toEmail(name), password })
    if (error) setMsg('שם או סיסמה שגויים')
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="hinomaru" />
      <h1>הטיול ליפן</h1>
      <p className="muted">מסלול, הזמנות והוצאות במקום אחד</p>
      <form onSubmit={submit} className="card">
        <input
          placeholder="שם (שקד / מאור / אלמוג / שניר)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="username"
          autoCapitalize="none"
          required
        />
        <input
          type="password"
          placeholder="סיסמה"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
          dir="ltr"
        />
        <button className="primary" disabled={busy}>
          התחברות
        </button>
        {msg && <p className="msg">{msg}</p>}
      </form>
    </div>
  )
}
