// Creates an account for someone with an invite. Supabase's own sign-up would email a confirmation link, and the
// project's built-in mail only reaches the team's own addresses, so an invited friend would never get it: the invite
// already vouches for them, so the account is made here, confirmed, and the app signs in with the password right away.
// The auth.users trigger still checks the invite (unused, not expired) and marks it used.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  // code: what the app words for the person (invite_invalid, email_exists, weak_password, bad_request, failed)
  const reply = (status: number, code: string) =>
    new Response(JSON.stringify(status < 300 ? { ok: true } : { error: code }), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  const body = (await req.json().catch(() => null)) as { invite?: unknown; email?: unknown; password?: unknown; name?: unknown } | null
  const invite = typeof body?.invite === 'string' ? body.invite.trim().toUpperCase() : ''
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : ''
  const password = typeof body?.password === 'string' ? body.password : ''
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : ''
  if (!invite || invite.length > 40 || !EMAIL.test(email) || email.length > 200 || !name) return reply(400, 'bad_request')
  if (password.length < 8 || password.length > 200) return reply(422, 'weak_password')

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  // a used or expired invite gets a clear answer before an account is even tried
  const { data: inv } = await admin
    .from('invites')
    .select('code')
    .eq('code', invite)
    .is('used_by', null)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()
  if (!inv) return reply(410, 'invite_invalid')

  const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { invite, name } })
  if (!error) return reply(201, 'ok')
  console.error('sign-up failed', error.status, error.code, error.message)
  if (error.code === 'email_exists' || error.code === 'user_already_exists' || /already (been )?registered/i.test(error.message)) return reply(409, 'email_exists')
  if (error.code === 'weak_password') return reply(422, 'weak_password')
  // the trigger refused the invite (taken a moment ago)
  if (/invitation|database error/i.test(error.message)) return reply(410, 'invite_invalid')
  return reply(500, 'failed')
})
