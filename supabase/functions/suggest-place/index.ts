// Turns an Instagram / TikTok / Google Maps link or a place name into a researched place card.
// The Claude key comes from the ANTHROPIC_API_KEY secret or Supabase Vault (anthropic_api_key).
import Anthropic from 'npm:@anthropic-ai/sdk'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod'
import { z } from 'npm:zod@3'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const MODEL = 'claude-haiku-5-5'

const PlaceDraft = z.object({
  found: z.boolean(),
  name: z.string(),
  name_ja: z.string().nullable(),
  city: z.enum(['tokyo', 'kyoto', 'osaka', 'nara', 'daytrip']),
  area: z.string().nullable(),
  category: z.enum(['food', 'sight', 'shopping', 'nightlife', 'cafe', 'experience']),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  hype: z.string().nullable(),
  reality: z.string().nullable(),
  verdict: z.enum(['gem', 'worth_it', 'overhyped', 'trap']).nullable(),
  tabelog_score: z.number().nullable(),
  google_score: z.number().nullable(),
  price: z.string().nullable(),
  tip: z.string().nullable(),
  audience: z.enum(['baby', 'adults']),
  baby_notes: z.string().nullable(),
  sources: z.array(z.string()),
})

const RESEARCH = `You help two Israeli couples plan a ~14-day Tokyo → Kyoto → Osaka trip. One couple brings a 5-month-old baby who only drinks milk.
A member shared a place (a social-media post, a map link, or just a name). Work out exactly which real place in Japan it is, then research it:
- what it is and what people rave about online
- Tabelog score (search in Japanese too) and Google rating; only report numbers you actually see
- full address, neighbourhood and coordinates
- price level, booking/queue tips
- with a milk-only baby: stroller access, a quiet spot or private room to nurse, nursing room nearby, smoking; or why it's better as an adults-only outing
- honest verdict: hidden gem, worth it, overhyped, or tourist trap
Be concise. If you can't identify one specific place, say so.`

const EXTRACT = `Turn the research notes into the place card. Rules:
- found=false if the notes did not identify one specific real place.
- city: tokyo, kyoto, osaka, nara, or daytrip for anywhere else.
- hype, reality, tip, baby_notes: one short English sentence each.
- tabelog_score / google_score / lat / lng: only if stated in the notes, else null.
- audience: "baby" if it works with the baby, otherwise "adults".
- sources: the URLs the notes relied on.`

/** Caption of the shared post, so the model knows what it is about (posts themselves need a login). */
async function postContext(link: string) {
  try {
    if (/tiktok\.com/i.test(link)) {
      const r = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(link)}`)
      if (r.ok) {
        const o = await r.json()
        return `TikTok post by @${o.author_unique_id ?? o.author_name}: ${o.title ?? ''}`
      }
    }
    if (/instagram\.com/i.test(link)) {
      // Instagram serves Open Graph tags to link-preview crawlers
      const r = await fetch(link, { headers: { 'User-Agent': 'facebookexternalhit/1.1' } })
      if (r.ok) {
        const html = await r.text()
        const meta = (p: string) =>
          html.match(new RegExp(`<meta[^>]+property="og:${p}"[^>]+content="([^"]*)"`, 'i'))?.[1] ?? ''
        const text = [meta('title'), meta('description')].filter(Boolean).join(' — ')
        if (text) return `Instagram post: ${text}`
      }
    }
  } catch {
    // fall back to the link alone
  }
  return ''
}

/** The Claude key: a function secret if one is set, otherwise the copy kept in Supabase Vault. */
async function anthropicKey() {
  const env = Deno.env.get('ANTHROPIC_API_KEY')
  if (env) return env
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const { data } = await admin.rpc('get_anthropic_key')
  return (data as string | null) ?? undefined
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

  // the anon key is also a valid JWT, so check there is a signed-in user behind the request
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: auth } = await supabase.auth.getUser()
  if (!auth.user) return json({ error: 'not signed in' }, 401)

  const { link, text } = (await req.json()) as { link?: string; text?: string }
  if (!link?.trim() && !text?.trim()) return json({ error: 'nothing to look up' }, 400)

  const caption = link ? await postContext(link) : ''
  const ask = [link && `Link: ${link}`, caption, text && `Note from the member: ${text}`].filter(Boolean).join('\n')

  const client = new Anthropic({ apiKey: await anthropicKey() })
  try {
    const messages: Anthropic.MessageParam[] = [{ role: 'user', content: ask }]
    let research: Anthropic.Message | null = null
    for (let i = 0; i < 4; i++) {
      research = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        output_config: { effort: 'low' },
        system: RESEARCH,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
        messages,
      })
      if (research.stop_reason !== 'pause_turn') break
      messages.push({ role: 'assistant', content: research.content })
    }
    if (!research || research.stop_reason === 'refusal') return json({ error: 'could not research this place' }, 422)
    const notes = research.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')

    const card = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(PlaceDraft) },
      system: EXTRACT,
      messages: [{ role: 'user', content: `${ask}\n\nResearch notes:\n${notes}` }],
    })
    if (!card.parsed_output) return json({ error: 'could not read the research' }, 422)
    return json(card.parsed_output)
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is missing or invalid' }, 500)
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'busy, try again in a minute' }, 429)
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}` }, 502)
    throw error
  }
})
