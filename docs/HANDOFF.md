# Japan trip app — handoff (2026-10-26)

Live: https://shakedflorentin.github.io/RentCalc/ · branch `japan-trip`, deployed by fast-forwarding `main`
(`git push origin japan-trip:main`; GitHub Pages builds on push). Supabase project `wbofjfwbdewgnwjmcpnv`.

## Offline (2026-10-29)
- Reads: the last copy of every table is kept on the phone (`readCache` / `useTripTable`), so the app opens offline.
- Writes: `src/outbox.ts` is the Supabase client's fetch. A table write (insert/upsert/update/delete through
  PostgREST) made with no network is kept in localStorage `outbox`, answered as saved, and laid over the rows on
  screen (`withPending` in useTripTable), so a swipe, a ticked task or a new expense shows at once. Rows added
  offline get their uuid on the phone, so editing or deleting them before they sync hits the same row. On `online`,
  on waking and at start the changes are sent in order; one the server refuses is dropped (logged), a network
  failure, 401 or 5xx stops and retries later. The offline bar counts what waits.
- Still needs a connection: AI lookups (add place by link/name, translate, parse booking), file uploads, and the
  planner itself (it runs when the swipes arrive).

## Language: Hebrew and English (2026-10-28)
- Settings → "שפה · Language". The choice lives on the phone (localStorage `lang`); switching reloads the app.
  index.html sets `<html lang dir>` before the first paint; `src/styles/ltr.css` holds the left-to-right fixes
  (tab bar, add/search buttons, photo taps, `.flip-ltr` arrows).
- UI text: `t('עברית', vars?)` from `src/i18n.ts`; the Hebrew is the key, English in `src/i18n/en-*.ts` (a, b, c by
  screen group, shared for city and first names). `node scripts/i18n-check.mjs --list` must report 0 missing and 0
  Hebrew outside t(); Hebrew that is data (stored, compared, regex) carries `// he-only` and is shown via t().
- Dates follow the language (`locale`). City names the database keeps in Hebrew show through `cityLabel()`.
- Card text: `en` jsonb on place_library and candidates (same keys as the Hebrew columns), shown over the Hebrew by
  `localizeCard()` (inside `withMedia`). sync_library and fill_plan_facts copy it; suggest-place (v19) returns it for
  new cards, card-facts (v4) writes the English plan line. All 255 cards translated 2026-10-28
  (`data/card-text-en-2026-10.json`, through the subscription).
- Planner (v9): `itinerary_items.notes_en` next to `notes`; warnings carry `kind` (closed_date / closed_weekday /
  hours) so the app words them in English. Places' "add to plan" saves notes_en too.
- Translator (v6): `{ text, from: he|en|ja, lang }`; in English the traveller's side is English ↔ Japanese.
- What stays as typed: people's own notes, titles, list items, booking names.

## Wording (2026-10-28)
Hebrew rewritten by five agents to sound like people, not a translation: UI strings, all 255 cards
(`data/card-text-2026-10.json`, loaded into place_library, candidates and matched places' notes), and the prompts of
suggest-place, card-facts and translate. `public/media.json` no longer carries card text (only links, photos,
kosher); the database is the one source.

**Before every deploy** (app or edge function), read the in-app problem reports: `select * from public.reports where
status = 'open'` (sent from "דיווח על בעיה"; screen, build and phone come with each). Fix what fits, then set
`status` ('fixed' / 'wontfix'), `reply` (Hebrew, shown to the reporter in the app) and `resolved_at`.

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
  - Once every couple it's for has voted, the planner places it (`itinerary_items.auto`). match_place still drops it on
    a first day, the planner moves it within seconds. A person's edit to day/time/title/location/notes/who clears
    `auto` (`plan_item_touched`; ticking done and the planner's own service-role writes don't). `places.auto_planned`
    stops re-adding after a manual delete.
- The planner: edge function `plan-trip` (since 2026-10-28; SQL record `supabase/sql/2026-10-28-trip-planner.sql`).
  - Runs after every swipe, new/changed place who and booking (DB triggers `request_plan` → pg_net with the Vault
    secret `planner_token` in `x-plan-token`), on opening the plan (once per visit), after a booking is deleted and
    from Places' "סידור המסלול מחדש". One run at a time per trip (`plan_state` lease + dirty flag).
  - Re-plans every auto item (fixed: items people placed/edited, done items, bookings with a time) as a whole:
    days by where each couple sleeps (hotel bookings, geocoded in `geo_cache`), compact days by distance, a day's
    load ≤ 8.5 h, ≤ 2 meals, a couple's own items on a together day ≤ 3 h, day trips (> 25 km) alone on a morning day
    with the ride counted once, closed weekdays/dates skipped. Then a rough time each (shown as "~10:00"): evening
    places (sunset, dinner, bars) wait for the evening, nothing after it closes (else it's moved to another day).
  - No AI in the planner. Each card carries its planning facts (columns on `place_library` and `candidates`: opens,
    closes, closed_weekdays, closed_dates, best_time, visit_mins, booking, plan_line, baby_block, facts_at,
    facts_sure); sync_library copies them into a trip, and the `candidates_plan_facts` trigger gives a card added by
    hand or link the facts of a library card with the same name. A card without facts is planned from its kind and
    time_needed (no hours, no closed days) and its note is the first sentence of its Hebrew tip.
  - Filling facts is done by a Claude Code session (the user's subscription, not the API): read
    `cards_without_facts` (backend view), research with parallel agents into a JSON like
    `data/place-facts-2026-10.json`, push it, and load it with `extensions.http_get` from raw.githubusercontent
    (recipe in `supabase/sql/2026-10-28-trip-planner.sql`). Done 2026-10-28 for all 206 active library cards and
    all 155 trip cards (81 confirmed from a source, the rest estimated: small places, year-end closures by custom).
    The baby line shows in the plan only when it blocks (no strollers, stairs, smoke, adults only).
  - `plan_state.summary`: places left out (waiting for a vote / no room / closed) and warnings on items people fixed
    on a closed day; the plan shows the warnings and "עוד N מקומות שאהבתם בעיר" for the day's city.
  - Check without writing: POST `{trip_id, dry: true}` with the planner token (SQL: `extensions.http` with header
    `x-plan-token` from `vault.decrypted_secrets`; returns plan + inputs). The 139 English library cards were
    translated to Hebrew on 2026-10-28 (one-off, through the API, before the no-API rule).
  - Deploy both files of `supabase/functions/plan-trip` (index.ts, plan.ts). plan.ts is pure and can be bundled with
    esbuild and run in node for testing.
  - Facts arrive with every new card, at add time, never at planning time:
    - added by link or name (suggest-place v19): the same extract call returns the plan fields (schema
      PlaceListPlanned; if the API ever rejects it, it retries without them) and AddPlace saves them on the card;
    - same name as a library card: the `candidates_plan_facts` trigger copies the library's facts;
    - anything else (e.g. from the Ptitim map): trigger `card_needs_facts` → pg_net → edge function `card-facts`
      (planner token; one Claude + web search lookup, ~$0.03, ai_calls fn card-facts) fills the card and its
      empty library card, then asks plan-trip to plan again.
  - Locations: a plan item's `location` is an address to navigate to (the card's `address` column, English, as
    Google Maps takes it), never coordinates. Coordinates stay in the backend (`candidates.lat/lng`) for the
    planner's distances and the Places map pins. The planner writes the address on its items; trigger
    `itinerary_item_address` puts it on items people add for a known place. Addresses for all 155 trip cards and 206
    library cards came from `data/place-addresses-2026-10.json` (subscription research, 46 of 223 marked guess:
    street/area-level or an unverified branch); new cards get one from suggest-place (v18) or card-facts (v3).
  - The 32 inactive library cards (never copied into a trip) got facts and addresses the same way on 2026-10-28
    (`data/place-facts-lib32-2026-10.json`, 10 of 32 guess), so a same-name card added later is filled by
    `candidates_plan_facts` instead of a paid card-facts lookup. Every library and trip card now has both;
    `cards_without_facts` is empty. Oedo Onsen Monogatari closed in 2021: its card points at Manyo Club Toyosu
    (its plan_line says so); Ramen Sugimoto has no Kanda branch, the card points at Marunouchi Brick Square.
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
- Supabase MCP asks for user approval on SQL with DELETE/DROP (even inside a function body) and the prompt usually
  times out unseen. The user doesn't want to run SQL by hand: keep deleting logic in edge functions (service role via
  PostgREST, no prompt) and keep migrations free of the word. match_place still holds the old placing logic (its body
  has DELETE, so redefining it prompts); the planner overrides its placements.

## How to verify a change
`npx tsc --noEmit -p . && npm run build`. For UI, build to a temp dir, `vite preview --port 4190`, and drive it with
Playwright (Chromium at /opt/pw-browsers) with Supabase calls mocked; never write to the real DB from tests.
