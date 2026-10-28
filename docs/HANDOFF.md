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
- Matching and planning (since 2026-10-28, `match_place()` run by the swipes trigger; SQL in
  `supabase/sql/2026-10-28-match-by-who-is-there.sql`):
  - A place is for the couples who sleep near it: nearest base city from the hotel bookings (`trip_nights`,
    `place_base`); within 25 km only that base's couples (Yokohama → only שקד ומאור), a day trip further out →
    everyone within 150 km. The swipe deck only shows a card to its couples (`trip_place_couples` RPC) and puts cards
    the other couple liked first ("X אהבו").
  - A couple votes yes when one partner liked and the other didn't skip. All its couples yes → everyone's (or the one
    couple's). Some yes, some no → the yes couple's list. Some yes, some not voted → that couple's list, waiting.
  - Once every couple it's for has voted it goes into the plan once (`itinerary_items.auto`), untimed, on a day its
    people (and only they) sleep in that city, near same-area items, max 5 items a day; day trips (>25 km) wait for
    someone to pick a day. An item the match put in and nobody touched is taken back if the match breaks; a person's
    edit clears `auto` (`plan_item_touched`). `places.auto_planned` stops re-adding after a manual delete.
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
- Expenses settle between couples (each couple one wallet; one transfer between them). `trips.settle_by`
  ('couples' default | 'people') switches a trip to person-by-person settling. Backend-only on purpose: the app
  reads it (select granted) but has no switch and no update grant. Change it with SQL:
  `update trips set settle_by = 'people' where id = …`. Logic: `partiesOf`/`settleUp` in `src/money.ts`.
- `trips` is granted column by column: a new column needs `grant select (col) on trips to anon, authenticated`
  or the app's `select('*')` on trips fails.
- Problem reports: settings (avatar) → "דיווח על בעיה או טעות" → table `reports` (body, reporter, screen it was sent
  from e.g. "עוד › כסף", app_version = commit + build time, device = user agent). Members can only insert their own
  columns and read their trip's reports; `status` ('open'|'fixed'|'wontfix') and `reply` are backend-only and show
  in the app under "דיווחים קודמים". Open ones: `select * from reports where status = 'open' order by created_at`.
  After a fix: `update reports set status = 'fixed', reply = '…', resolved_at = now() where id = …`.
- Claude cost/time log: every Claude call from the three edge functions writes a row to `ai_calls` (fn, step, tokens,
  web searches, list-price `cost_usd`, `ms`, stop reason, error); place lookups answered from saved results log
  step `cached` at $0. Summary per day/function/step: `select * from ai_costs_daily order by day desc`. Backend only
  (no grants to app users). Prices live in `ai-log.ts`, an identical copy in each function folder (deploy it with
  the function's index.ts).
- Edge functions (`supabase/functions/*`, deploy via MCP): `suggest-place` (v16, link/name → up to 10 place cards; every lookup is saved in `place_lookups` (by the app's id,
  with a key per post/name): the search finishes even if the phone stops waiting and the app reads the result back,
  and the same post or name within 30 days is answered from there for free
  with kosher fields; structured outputs allow at most 16 nullable fields, so its text fields return "" and are
  turned into null in the function — v13 had 18 and every call failed with a 400) and `parse-booking` (v9). Model `claude-haiku-5-5`, key in Vault `anthropic_api_key`,
  30 calls/user/day. Both validate the body before charging quota and only pass http(s) links.
- Edge function `translate` (v5, deployed 2026-10-26; plain three-line reply, no structured output): one spoken sentence he↔ja with Haiku, thinking off, effort low,
  200 calls/user/day (own `ai_usage` fn). Used by the voice translator in More → Important (`src/views/Translator.tsx`):
  the phone's speech recognition (webkitSpeechRecognition) writes it down, the phone's voices read the result.

## Done recently
QA by 10 agents (reports were in a scratchpad, not kept) → fixed ~50 bugs (safe links, money "1,200",
bookings dedupe/attachments, auto-plan who, add-place form, flights with hyphens, etc.). Bookings: edit button,
sort by date with whose on each card, "read the file" in the + form. Info tab: tips from the Facebook groups incl.
kosher (Chabad, product list, onigiri) and December; phrase card "no pork or seafood". Baby: formula note,
tax-free now refunded at the airport (from Nov 2026).

Light/dark: settings (avatar) → "מראה" (כמו בטלפון / בהיר / כהה), kept per phone in localStorage `theme` and set as
`html[data-theme]` (index.html applies it before first paint). Dark styles are still written only as
`@media (prefers-color-scheme: dark)`; `themeOverride` in vite.config.ts emits each block twice at build.

Look: iOS grouped style from the `apple-design` skill (grey ground, flat white groups, one red tint, large tight
titles, iPhone system font). Swipe card moves on springs (`springTo` in `Swipe.tsx`): grabs mid-flight, keeps the
finger's speed, and likes/skips by where the flick projects, not where it was let go.

## Open / ideas
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
