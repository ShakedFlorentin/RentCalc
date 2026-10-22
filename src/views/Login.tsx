import { FormEvent, useState } from 'react'
import { supabase } from '../supabase'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setMsg('')
    if (mode === 'in') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setMsg('אימייל או סיסמה שגויים (אם נרשמת עכשיו – אשר/י את המייל קודם)')
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.href },
      })
      if (error) setMsg(error.message)
      else if (!data.session) setMsg('נשלח אליך מייל אישור – לחצ/י על הקישור ואז התחבר/י')
    }
    setBusy(false)
  }

  return (
    <div className="login">
      <div className="hinomaru" />
      <h1>הטיול ליפן 🇯🇵</h1>
      <p className="muted">מתכננים ועוקבים יחד</p>
      <form onSubmit={submit} className="card">
        <input type="email" placeholder="אימייל" value={email} onChange={(e) => setEmail(e.target.value)} required dir="ltr" />
        <input
          type="password"
          placeholder="סיסמה (6 תווים לפחות)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={6}
          required
          dir="ltr"
        />
        <button className="primary" disabled={busy}>
          {mode === 'in' ? 'התחברות' : 'הרשמה'}
        </button>
        {msg && <p className="msg">{msg}</p>}
      </form>
      <button className="link" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'אין לך משתמש? להרשמה' : 'כבר רשום/ה? להתחברות'}
      </button>
    </div>
  )
}
