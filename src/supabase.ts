import { createClient } from '@supabase/supabase-js'
import { outboxFetch, startOutbox } from './outbox'

// writes to tables go through the outbox, so a change made with no connection is kept and sent later
export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, {
  global: { fetch: outboxFetch },
})

startOutbox(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_KEY, async () => {
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
})
