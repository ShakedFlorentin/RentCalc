# Japan trip app — handoff (2026-10-26)

Live: https://shakedflorentin.github.io/RentCalc/ · branch `japan-trip`, deployed by fast-forwarding `main`
(`git push origin japan-trip:main`; GitHub Pages builds on push). Supabase project `wbofjfwbdewgnwjmcpnv`.

## The trip
- Two couples: **שקד ומאור** (in Japan 12/12–28/12, Haneda) and **אלמוג ושניר** (15/12–31/12, Narita in, Haneda out).
  One couple has a 5-month-old baby (milk only). Some keep "kosher style" (no pork/seafood; fish with scales is fine).
- Trip in the app: 20 days from 2026-12-12. Days 1–3 שקד ומאור only, 17–20 אלמוג ושניר only.
- Hotels booked: Richmond Yokohama (12–15, ש"מ), Daiwa Roynet Nishi-Shinjuku (15–19, saved as ש"מ; Almog booked the
  same hotel himself and should add his own booking for אלמוג ושניר), DEL style Osaka (23–26, everyone).
  Still open: ש"מ 19–23 and 26–28; א"ש 19–23 and 26–31.

## Stack
Vite 6 + React 18 + TS PWA, Hebrew RTL, Leaflet (Esri English tiles), lucide icons (no emoji anywhere).
`src/views/*` per tab (Home, Swipe, Itinerary, Bookings, Places, More → Expenses/Lists/Essentials/Baby).
Offline: `public/sw.js` + localStorage cache in `useTripTable` (`src/lib.ts`).

## Data model notes (Supabase)
- Swipe game: `place_library` (curated cards, `active` flag) → `sync_library(tid)` copies to `candidates` on game open.
  Hebrew text for the original 107 cards lives in `public/media.json` (overlays DB by name via `withMedia`).
  Couple match → `on_swipe` trigger writes `places` (who = couple or null for everyone).
- Card fields include serves/dishes/todo/special/highlights/time_needed and `kosher` ('friendly'|'options'|'hard') + `kosher_note`.
- Sources added this round: 50 Ptitim blog picks (`sources` has ptitim.com/tokyoguide), 11 + 7 from the Israeli Japan
  Facebook groups (`sources` has facebook.com/groups/japanguideil…). All active.
- `guide_places`: all 747 Ptitim map places (map layer "המפה של פתיתים" in Places, "הוספה לגילוי" adds one to the swipe deck (tab "גילוי")).
- Bookings uniqueness: `bookings_same_confirmation_uniq` (same code + time) and `bookings_same_no_code_uniq`
  (no code: title + time + who). Hotel nights in the plan are read live from bookings (`nightLines`/`stayLines`).
- Missing nights on Home: per couple from its own flights (`stayInJapan` in `src/views/planUtils.ts`).
- `checklist_items`: `couple` (packing is per couple), `each` + `done_couples` (tasks each couple ticks separately,
  e.g. Visit Japan Web). Helper `itemDone()` in `src/types.ts`.
- Edge functions (`supabase/functions/*`, deploy via MCP): `suggest-place` (v13, link/name → up to 10 place cards
  with kosher fields) and `parse-booking` (v8). Model `claude-haiku-5-5`, key in Vault `anthropic_api_key`,
  30 calls/user/day. Both validate the body before charging quota and only pass http(s) links.

## Done recently
QA by 10 agents (reports were in a scratchpad, not kept) → fixed ~50 bugs (safe links, money "1,200",
bookings dedupe/attachments, auto-plan who, add-place form, flights with hyphens, etc.). Bookings: edit button,
sort by date with whose on each card, "read the file" in the + form. Info tab: tips from the Facebook groups incl.
kosher (Chabad, product list, onigiri) and December; phrase card "no pork or seafood". Baby: formula note,
tax-free now refunded at the airport (from Nov 2026).

Look: iOS grouped style from the `apple-design` skill (grey ground, flat white groups, one red tint, large tight
titles, iPhone system font). Swipe card moves on springs (`springTo` in `Swipe.tsx`): grabs mid-flight, keeps the
finger's speed, and likes/skips by where the flick projects, not where it was let go.

## Open / ideas
- Almog to add his own Shinjuku booking (who = אלמוג ושניר) → his missing nights drop 13 → 9.
- "דרכונים בתוקף" was reset when it became per-couple; each couple should tick it again.
- Facebook research is done by the Claude session on Shaked's Mac (Claude in Chrome); it can't message back, so
  results are read from its transcript (list_events). Unread posts worth a look: the 19-day and 30-day recaps and
  "where to eat in Tokyo" in japanguideil.
- Known gaps left on purpose: CSP header, atomic AI quota, normName accent folding, matchFor counts only joined members.
- Supabase MCP asks for user approval on DROP/DELETE and that prompt often times out; ask the user to run such SQL in
  the dashboard SQL editor (https://supabase.com/dashboard/project/wbofjfwbdewgnwjmcpnv/sql/new).

## How to verify a change
`npx tsc --noEmit -p . && npm run build`. For UI, build to a temp dir, `vite preview --port 4190`, and drive it with
Playwright (Chromium at /opt/pw-browsers) with Supabase calls mocked; never write to the real DB from tests.
