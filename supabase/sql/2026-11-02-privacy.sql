-- Privacy and abuse hardening. Idempotent; nothing is dropped. Not applied by this commit.
--
-- 1. place_ratings: a person reads full rows (with user_id) only for their own ratings and for ratings made in trips
--    they are a member of. Everyone else's ratings reach the app only as aggregates + anonymous notes, through
--    rating_summary(library_ids). That function counts only the ratings the caller can NOT read as rows (not theirs, not
--    from their trips), so the app adds rows + summary without counting anything twice.
-- 2. User-added cards no longer go live for everyone on insert. card_to_library now creates the shared library card with
--    active = false and added_from_trip = the adding trip. It turns active when (a) cards for the same place
--    (same_place_name) exist in at least 2 different trips, or (b) an admin sets place_library.active = true. The adding
--    trip keeps its own candidate exactly as before. Links on library cards are http(s) only (trigger, any writer).
--    The 238 library cards that are active today stay active (no UPDATE of `active` here).
--    place_library_read now also hides inactive cards from everyone except members of the trip that added them.
-- 3. Grants. Exactly what is revoked (RLS stays as is; SELECT/INSERT/UPDATE/REFERENCES/TRIGGER are not touched):
--    - TRUNCATE on every table/view in schema public, from anon and authenticated.
--    - DELETE on every table/view in schema public from anon.
--    - DELETE from authenticated on every table that has no DELETE/ALL policy, i.e. everything except: bookings,
--      candidates, checklist_items, day_info, essentials, expenses, itinerary_items, places, swipes, trip_stays
--      (those keep it: the app deletes from itinerary_items, swipes, bookings, checklist_items, places, trip_stays,
--      essentials, expenses; candidates and day_info have an ALL policy and are kept to be safe).
--      Revoked from authenticated: _plan_compare, ai_usage, app_flags, cities, credit_balance, credit_ledger,
--      credit_prices, credit_unlimited_trips, geo_cache, guide_places, invites, join_attempts, members, place_facts,
--      place_library, place_ratings, place_lookups, plan_state, profiles, trips (and any other table without such a policy).
--    - default privileges for new tables created by postgres in public: TRUNCATE no longer granted to anon/authenticated.

-- ---------------------------------------------------------------------------------------------
-- 1. ratings
-- ---------------------------------------------------------------------------------------------
alter policy "place_ratings_read" on public.place_ratings
  using ((user_id = (select auth.uid())) or public.is_trip_member(trip_id));

create or replace function public.rating_summary(library_ids uuid[])
returns table(library_id uuid, n integer, stars_sum integer, notes jsonb)
language sql
stable
security definer
set search_path to ''
as $$
  select r.library_id,
         count(*)::int,
         sum(r.stars)::int,
         coalesce((select jsonb_agg(x.t order by x.at desc)
                     from (select left(trim(r2.note), 500) as t, r2.updated_at as at
                             from public.place_ratings r2
                            where r2.library_id = r.library_id
                              and r2.user_id <> auth.uid() and not public.is_trip_member(r2.trip_id)
                              and nullif(trim(r2.note), '') is not null
                            order by r2.updated_at desc
                            limit 2) x), '[]'::jsonb)
    from public.place_ratings r
   where auth.uid() is not null
     and r.library_id = any (library_ids[1:200])
     and r.user_id <> auth.uid()
     and not public.is_trip_member(r.trip_id)
   group by r.library_id
$$;
revoke all on function public.rating_summary(uuid[]) from public, anon;
grant execute on function public.rating_summary(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------
-- 2. library promotion
-- ---------------------------------------------------------------------------------------------
alter table public.place_library add column if not exists added_from_trip uuid references public.trips(id) on delete set null;

-- the text if it is an http(s) link, else null
create or replace function public.http_url_or_null(u text)
returns text
language sql
immutable
set search_path to ''
as $$ select case when u ~* '^https?://[^[:space:]]+$' then u end $$;

create or replace function public.place_library_safe_links()
returns trigger
language plpgsql
set search_path to ''
as $$
begin
  new.maps_url := public.http_url_or_null(new.maps_url);
  new.website_url := public.http_url_or_null(new.website_url);
  new.instagram_url := public.http_url_or_null(new.instagram_url);
  new.tiktok_url := public.http_url_or_null(new.tiktok_url);
  new.photos := coalesce((select array_agg(p) from unnest(new.photos) p where public.http_url_or_null(p) is not null), '{}');
  return new;
end $$;

create or replace trigger place_library_links
  before insert or update on public.place_library
  for each row execute function public.place_library_safe_links();

-- links already stored (none are bad today; this is a no-op that keeps the file safe to re-run)
update public.place_library
   set maps_url = maps_url
 where (maps_url is not null and public.http_url_or_null(maps_url) is null)
    or (website_url is not null and public.http_url_or_null(website_url) is null)
    or (instagram_url is not null and public.http_url_or_null(instagram_url) is null)
    or (tiktok_url is not null and public.http_url_or_null(tiktok_url) is null)
    or exists (select 1 from unnest(photos) p where public.http_url_or_null(p) is null);

create or replace function public.card_to_library()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare lid uuid; on_now boolean;
begin
  -- the library's own copies come in with library_id set; only cards people add get here
  if new.library_id is not null then return new; end if;
  -- the same place already in the library (same name, spelling aside): use that card
  select l.id, l.active into lid, on_now from public.place_library l
   where public.norm_name(l.name) = public.norm_name(new.name) limit 1;
  if lid is null then
    -- a new shared card starts switched off: other trips see it only once it is promoted (see below)
    insert into public.place_library(name, name_ja, city, area, category, lat, lng, coord_precision, hype, reality, verdict,
                                     tabelog_score, google_score, price, tip, sources, audience, baby_notes, local_pick,
                                     maps_url, website_url, instagram_url, tiktok_url, photos, serves, dishes, todo, special,
                                     highlights, time_needed, kosher, kosher_note, opens, closes, closed_weekdays,
                                     closed_dates, open_dates, best_time, visit_mins, booking, plan_line, baby_block,
                                     facts_at, facts_sure, address, en, tags, active, added_from_trip)
    values (new.name, new.name_ja, new.city, new.area, new.category, new.lat, new.lng, new.coord_precision, new.hype,
            new.reality, new.verdict, new.tabelog_score, new.google_score, new.price, new.tip, new.sources, new.audience,
            new.baby_notes, new.local_pick, new.maps_url, new.website_url, new.instagram_url, new.tiktok_url, new.photos,
            new.serves, new.dishes, new.todo, new.special, new.highlights, new.time_needed, new.kosher, new.kosher_note,
            new.opens, new.closes, new.closed_weekdays, new.closed_dates, new.open_dates, new.best_time, new.visit_mins,
            new.booking, new.plan_line, new.baby_block, new.facts_at, new.facts_sure, new.address, new.en,
            coalesce(new.tags, '{}'), false, new.trip_id)
    returning id into lid;
    on_now := false;
  end if;
  new.library_id := lid;
  -- promotion: the same place added in at least 2 different trips switches the card on for everyone
  if not on_now and (
       select count(*) from (
         select c.trip_id from public.candidates c
          where c.trip_id <> new.trip_id and (c.library_id = lid or public.same_place_name(c.name, new.name))
         union select new.trip_id) t) >= 2 then
    update public.place_library set active = true where id = lid;
  end if;
  return new;
end
$function$;

-- inactive cards are visible only to members of the trip that added them (active ones to every signed-in user, as before)
alter policy "place_library_read" on public.place_library
  using (active or (added_from_trip is not null and public.is_trip_member(added_from_trip)));

-- ---------------------------------------------------------------------------------------------
-- 3. grants
-- ---------------------------------------------------------------------------------------------
revoke truncate on all tables in schema public from anon, authenticated;
revoke delete on all tables in schema public from anon;
do $$
declare r record;
begin
  for r in
    select c.relname from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
       and not exists (select 1 from pg_policies p
                        where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('DELETE', 'ALL'))
  loop
    execute format('revoke delete on public.%I from authenticated', r.relname);
  end loop;
end $$;
alter default privileges for role postgres in schema public revoke truncate on tables from anon, authenticated;
