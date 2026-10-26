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
})

const SYSTEM = `You are the voice translator in a travel app used by two Israeli couples on a trip to Japan in December.
The text is one utterance from speech recognition, so it may lack punctuation or contain a misheard word: translate what the speaker most likely meant.
- Hebrew to Japanese: natural, polite spoken Japanese (desu/masu), the way a guest speaks to a shop assistant, waiter, hotel clerk or station staff. Put the Hepburn romaji of your Japanese in "romaji".
- Japanese to Hebrew: natural, everyday spoken Hebrew. "romaji" is an empty string.
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

/**
 * Lets a request spend the Claude key only for a signed-in member of a trip who is under today's cap, and records
 * the call. Returns the client for the key lookup, or the response to send instead.
 */
async function admit(req: Request, fn: string, json: (body: unknown, status?: number) => Response) {
  // the anon key is also a valid JWT, so check there is a signed-in user behind the request
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return json({ error: 'not signed in' }, 401)
  const { count: trips } = await supabase
    .from('members')
    .select('trip_id', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
  if (!trips) return json({ error: 'not a trip member' }, 403)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count: used } = await admin
    .from('ai_usage')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', auth.user.id)
    .eq('fn', fn)
    .gte('at', since)
  if ((used ?? 0) >= DAILY_LIMIT) return json({ error: 'daily limit reached' }, 429)
  await admin.from('ai_usage').insert({ user_id: auth.user.id, fn })
  return admin
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

  const admin = await admit(req, 'translate', json)
  if (admin instanceof Response) return admin

  const client = new Anthropic({ apiKey: await anthropicKey(admin) })
  try {
    const response = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 1000,
      // a translation needs no reasoning: thinking off keeps it fast and cheap (Haiku allows it at effort low)
      thinking: { type: 'disabled' },
      output_config: { effort: 'low', format: zodOutputFormat(Translation) },
      system: SYSTEM,
      messages: [{ role: 'user', content: `${from === 'he' ? 'Hebrew to Japanese' : 'Japanese to Hebrew'}:\n${text}` }],
    })
    if (response.stop_reason === 'refusal' || !response.parsed_output) return json({ error: 'could not translate' }, 422)
    const { translation, romaji } = response.parsed_output
    return json({ translation, romaji: from === 'he' ? romaji : '' })
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is missing or invalid' }, 500)
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'busy, try again in a minute' }, 429)
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}` }, 502)
    throw error
  }
})
