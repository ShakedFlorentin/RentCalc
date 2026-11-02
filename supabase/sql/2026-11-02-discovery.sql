-- Not applied yet: run by hand in the SQL Editor.
-- Smarter discovery (roadmap section 5): a "not now" on a swipe card, separate from a no.
-- The app works before this runs: without the column it keeps "not now" on the phone only and sends nothing.
-- Row access stays as on the other trip tables (swipes already limits rows with public.is_trip_member(trip_id));
-- a new column needs no new policy.
--
-- IMPORTANT, do this in the same go: the app stores a "not now" as liked = false with skipped = true, and the vote
-- helpers (couple_vote, the votes CTE in plan_place_couples / trip_place_couples, match_place) read liked = false
-- as a no. Change them to ignore rows where skipped is true. The app itself already ignores such rows.
alter table public.swipes add column if not exists skipped boolean not null default false;

create index if not exists swipes_trip_user_skipped_idx on public.swipes (trip_id, user_id) where skipped;
