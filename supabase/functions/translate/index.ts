// Translates one spoken sentence between Hebrew and Japanese for the trip's voice translator.
// The Claude key comes from the ANTHROPIC_API_KEY secret or Supabase Vault (anthropic_api_key).
import Anthropic from 'npm:@anthropic-ai/sdk@1.1.0'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk@1.1.0/helpers/zod'
import { z } from 'npm:zod@4'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const Translation = z.object({
  translation: z.string(),
  // Latin letters for Japanese output, so the speaker can say it themselves; empty for Hebrew output
  romaji: z.string(),
  // the Japanese put back into Hebrew, so the speaker sees what the other side will hear; empty for Hebrew output
  back: z.string(),
})

const SYSTEM = `You are the voice translator in a travel app used by two Israeli couples on a trip to Japan in December.
The text is one utterance from speech recognition. Translate it faithfully: the same content and the same intent, nothing added, nothing left out, nothing softened or explained. Fix only an obvious recognition slip (a misheard word that makes no sense) and missing punctuation. Keep tense, person and mood exactly: present stays present.
Speech recognition never writes a question mark, and in Hebrew a yes/no question is worded exactly like a statement. So when the utterance reads naturally as a question to the person in front of the speaker (e.g. "אפשר לשלם בכרטיס", "יש לכם שולחן לארבעה", "עכשיו זה עובד", "זה חריף"), translate it as a question (in Japanese, ending in か); anything starting with "האם" is a question.
- Hebrew to Japanese: polite spoken Japanese (desu/masu form), but do not add greetings, apologies or phrases the speaker did not say. Put the Hepburn romaji of your Japanese in "romaji", and translate your Japanese back into Hebrew, literally, in "back".
- Japanese to Hebrew: natural, everyday spoken Hebrew. "romaji" and "back" are empty strings.
Context that may matter: some of the travellers keep kosher style (no pork and no seafood; fish with scales is fine), and one couple has a 5-month-old baby.
Keep names of people, places, hotels and dishes as they are. Translate only; do not answer, explain or add anything.`

// one utterance; a long one is a stuck recording, not a sentence
const MAX_CHARS = 600
// Claude calls per user per 24 hours; translation is a conversation, so it gets more room than the other tools
const DAILY_LIMIT = 200

/** The Claude key: a function secret if one is set, otherwise the copy kept in Supabase Vault. */
async function anthropicKey(admin: SupabaseClient) {
  const env = Deno.env.get('ANTHROPIC_API_KEY')
  if (env) return env
  const { data } = await admin.rpc('get_anthropic_key')
  return (data as string | null) ?? undefined
}

/** The user id the token claims, unverified: only used to start lookups that getUser() then confirms. */
function claimedUser(authorization: string) {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1]
    return (JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))).sub as string) ?? null
  } catch {
    return null
  }
}

/**
 * Lets a request spend the Claude key only for a signed-in member of a trip who is under today's cap, and records
 * the call. Returns the key and the call's record, or the response to send instead.
 * A translation waits on this, so the lookups run together in one round trip instead of one after another: the
 * token's claimed user starts them, and nothing is spent unless getUser() confirms that same user.
 */
async function admit(req: Request, fn: string, json: (body: unknown, status?: number) => Response) {
  const authorization = req.headers.get('Authorization') ?? ''
  const claimed = claimedUser(authorization)
  if (!claimed) return json({ error: 'not signed in' }, 401)
  // the anon key is also a valid JWT, so check there is a signed-in user behind the request
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
  })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const [{ data: auth }, { count: trips }, { count: used }, key] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('members').select('trip_id', { count: 'exact', head: true }).eq('user_id', claimed),
    admin.from('ai_usage').select('*', { count: 'exact', head: true }).eq('user_id', claimed).eq('fn', fn).gte('at', since),
    anthropicKey(admin),
  ])
  if (!auth.user || auth.user.id !== claimed) return json({ error: 'not signed in' }, 401)
  if (!trips) return json({ error: 'not a trip member' }, 403)
  if ((used ?? 0) >= DAILY_LIMIT) return json({ error: 'daily limit reached' }, 429)
  // recorded alongside the Claude call rather than before it; the caller awaits it with the call
  const record = admin.from('ai_usage').insert({ user_id: claimed, fn })
  return { key, record }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // check the request before admit(), so a malformed one doesn't use up the daily quota
  const body = (await req.json().catch(() => null)) as { text?: unknown; from?: unknown } | null
  const text = typeof body?.text === 'string' ? body.text.trim() : ''
  const from = body?.from === 'he' || body?.from === 'ja' ? body.from : null
  if (!text || !from) return json({ error: 'nothing to translate' }, 400)
  if (text.length > MAX_CHARS) return json({ error: 'text too long' }, 413)

  const t0 = performance.now()
  const admitted = await admit(req, 'translate', json)
  if (admitted instanceof Response) return admitted
  const t1 = performance.now()

  const client = new Anthropic({ apiKey: admitted.key })
  try {
    const [response] = await Promise.all([client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      // a translation needs no reasoning: thinking off keeps it fast and cheap (Haiku allows it at effort low)
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: zodOutputFormat(Translation) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${from === 'he' ? 'Hebrew to Japanese' : 'Japanese to Hebrew'}:\n${text}` }],
    }), admitted.record])
    const t2 = performance.now()
    if (response.stop_reason === 'refusal' || !response.parsed_output) return json({ error: 'could not translate' }, 422)
    const { translation, romaji, back } = response.parsed_output
    // where the time went, for the app's technical details
    const ms = { checks: Math.round(t1 - t0), claude: Math.round(t2 - t1) }
    return json({ translation, romaji: from === 'he' ? romaji : '', back: from === 'he' ? back : '', ms })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is missing or invalid' }, 500)
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'busy, try again in a minute' }, 429)
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}` }, 502)
    throw error
  }
})
