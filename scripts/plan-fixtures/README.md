# Planner fixtures

Run with `npm run test:plan` (one fixture: `node scripts/plan-test.mjs yokohama`; `VERBOSE=1` prints each plan).

Each `*.json` is `{ name, description, knownFailing?, days, units, fixed, expect }`. `days`, `units`, `fixed` are what
`plan()` takes; `days[].at` is an object couple → presence (the harness turns it into the Map). Always checked: every
unit sits on a day all its couples are present, in the unit's base (or within 30 km / a day trip's reach), not on a
closed weekday/date, and is never both placed and unplanned. `expect` adds: `noIssueKinds`, `emptyDays`, `onlyDays`
(id → allowed days), `unplanned` (id → reason), `placedMin`, `fillBefore`, `stable` (re-run with the result as `current`:
no unit may move). `knownFailing: true` reports a failure without failing the run.

## Adding a real fixture from a live dry run

POST `{trip_id, dry:true}` to `plan-trip` with the planner token (`x-plan-token`, see HANDOFF). The response has
`input: { units, fixed, days }` (days' `at` is already an object). Save that object as `scripts/plan-fixtures/real-<date>.json`
with a `name`, a `description` and an `expect` (e.g. `{"stable": true, "noIssueKinds": ["hours"]}`). It holds real
place names and hotel coordinates: keep ids only if you don't want them in the repo, and note `current` is the
live plan's day, so `stable` then checks the live plan against itself.

## Presence fixtures (stays)

A fixture with `presence` instead of `days` builds its days with `buildDays` (`supabase/functions/plan-trip/presence.ts`),
the same code `index.ts` runs: `presence: { startDate, numDays, couples, sleeps, dayWho?, flights?, capOf? }`, a sleep being
`{ party|null, checkIn, checkOut, city, point, label, key, confirmed, booked }`. Extra `expect` keys: `presence`
(`{ "<day>": { "<couple>": { base, start?, end?, estimate? } | null } }`) and `estimateDays` (the days whose times rest on a
stay with no hotel booking). The `stays-*` fixtures cover no hotels, some booked, all booked, and different dates per party.
