// Reads a booking confirmation (pasted text, PDF or screenshot) and returns structured bookings.
// Needs the ANTHROPIC_API_KEY secret on the Supabase project.
import Anthropic from 'npm:@anthropic-ai/sdk'
import { zodOutputFormat } from 'npm:@anthropic-ai/sdk/helpers/zod'
import { z } from 'npm:zod@3'
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const BookingList = z.object({
  bookings: z.array(
    z.object({
      kind: z.enum(['flight', 'hotel', 'train', 'activity', 'insurance', 'other']),
      title: z.string(),
      starts_at: z.string().nullable(),
      ends_at: z.string().nullable(),
      confirmation: z.string().nullable(),
      location: z.string().nullable(),
      url: z.string().nullable(),
      notes: z.string().nullable(),
    }),
  ),
})

const SYSTEM = `You extract travel bookings from confirmation emails, PDFs and screenshots for a group trip to Japan.
Return one entry per separate booking (e.g. an outbound and a return flight are two entries; one hotel stay is one entry).
- kind: flight, hotel, train, activity, insurance or other.
- title: short and recognisable, e.g. the hotel name, or "El Al LY91 TLV → NRT".
- starts_at / ends_at: local wall-clock time at the place, formatted YYYY-MM-DDTHH:mm (no timezone). Hotel: check-in and check-out; if only dates are given use 15:00 and 11:00. Flight: departure and arrival in their own local times. null when unknown.
- confirmation: the booking/confirmation/PNR number exactly as written.
- location: full street address (hotel) or departure airport/station.
- url: a link to manage the booking if present.
- notes: a short Hebrew summary of what matters on the trip: room type, number of guests, breakfast, cancellation deadline, total price and currency, baggage. Max 3 lines.
Only use information that is in the document. If it is not a booking, return an empty list.`

const MAX_BYTES = 15 * 1024 * 1024

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

  const { text, file } = (await req.json()) as {
    text?: string
    file?: { data: string; media_type: string }
  }
  if (!text?.trim() && !file) return json({ error: 'nothing to read' }, 400)
  if (file && file.data.length * 0.75 > MAX_BYTES) return json({ error: 'file too large' }, 413)

  const content: Anthropic.ContentBlockParam[] = []
  if (file?.media_type === 'application/pdf') {
    content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.data } })
  } else if (file && /^image\/(jpeg|png|gif|webp)$/.test(file.media_type)) {
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: file.media_type as 'image/jpeg', data: file.data },
    })
  } else if (file) {
    return json({ error: 'unsupported file type' }, 415)
  }
  content.push({ type: 'text', text: text?.trim() ? text : 'Extract the bookings from the attached document.' })

  const client = new Anthropic()
  try {
    const response = await client.messages.parse({
      model: 'claude-haiku-5-5',
      max_tokens: 16000,
      output_config: { effort: 'low', format: zodOutputFormat(BookingList) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    })
    if (response.stop_reason === 'refusal' || !response.parsed_output) {
      return json({ error: 'could not read this confirmation' }, 422)
    }
    return json(response.parsed_output)
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) return json({ error: 'ANTHROPIC_API_KEY is missing or invalid' }, 500)
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'busy, try again in a minute' }, 429)
    if (error instanceof Anthropic.APIError) return json({ error: `Claude API error ${error.status}` }, 502)
    throw error
  }
})
