-- Record of the migrations applied on 2026-10-28 (trip_planner_tables, trip_planner_requests) for the plan-trip
-- edge function. Already applied; kept here for reference. The vault secret planner_token was created with
--   select vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'planner_token', '...');

create table if not exists public.place_facts (
  key text primary key,
  name text not null,
  line_he text,
  baby_he text,
  opens text,
  closes text,
  closed_weekdays int[] not null default '{}',
  closed_dates date[] not null default '{}',
  best_time text,
  hours numeric,
  booking text,
  lat double precision,
  lng double precision,
  checked_at timestamptz not null default now()
);
alter table public.place_facts enable row level security;
create policy "signed in read facts" on public.place_facts for select to authenticated using (true);
grant select on public.place_facts to authenticated;

create table if not exists public.geo_cache (
  q text primary key,
  lat double precision,
  lng double precision,
  at timestamptz not null default now()
);
alter table public.geo_cache enable row level security;

create table if not exists public.plan_state (
  trip_id uuid primary key,
  lease_until timestamptz,
  dirty boolean not null default false,
  ran_at timestamptz,
  error text,
  summary jsonb
);
alter table public.plan_state enable row level security;
create policy "members read plan state" on public.plan_state for select to authenticated using (public.is_trip_member(trip_id));
grant select on public.plan_state to authenticated;

-- the couples a card is for and the couples that voted on it, for the planner (service role; no member check)
create or replace function public.plan_place_couples(tid uuid)
returns table(candidate_id uuid, couples text[], voted text[], yes text[])
language sql stable security definer set search_path = ''
as $$
  with nights as (select * from public.trip_nights(tid)),
  everyone as (select array_agg(distinct m.couple order by m.couple) as cs from public.members m where m.trip_id = tid and m.couple is not null),
  bp as (select b.base, p.lat, p.lng from (select distinct base from nights) b cross join lateral public.base_point(b.base) p),
  cand as (select c.id, c.lat, c.lng, c.city from public.candidates c where c.trip_id = tid),
  near as (
    select distinct on (c.id) c.id, bp.base,
           case when c.lat is null then null else public.km(c.lat, c.lng, bp.lat, bp.lng) end as km
      from cand c join bp on c.lat is not null or bp.base = c.city
     order by c.id, case when c.lat is null then null else public.km(c.lat, c.lng, bp.lat, bp.lng) end nulls last),
  elig as (
    select c.id, coalesce(
      case
        when n.base is null then null
        when n.km is null or n.km <= 25 then
          (select array_agg(distinct x.couple order by x.couple) from nights x where x.base = n.base)
        else
          (select array_agg(distinct x.couple order by x.couple) from nights x join bp on bp.base = x.base
            where public.km(c.lat, c.lng, bp.lat, bp.lng) <= 150)
      end, (select cs from everyone)) as couples
      from cand c left join near n on n.id = c.id),
  votes as (
    select s.candidate_id, m.couple, bool_or(s.liked) and not bool_or(not s.liked) as yes
      from public.swipes s join public.members m on m.user_id = s.user_id and m.trip_id = s.trip_id
     where s.trip_id = tid and m.couple is not null
     group by s.candidate_id, m.couple)
  select e.id, e.couples,
         array(select v.couple from votes v where v.candidate_id = e.id and v.couple = any(e.couples) order by v.couple),
         array(select v.couple from votes v where v.candidate_id = e.id and v.yes and v.couple = any(e.couples) order by v.couple)
    from elig e
$$;
revoke execute on function public.plan_place_couples(uuid) from public, anon, authenticated;
grant execute on function public.plan_place_couples(uuid) to service_role;

create or replace function public.get_planner_token()
returns text language sql stable security definer set search_path = ''
as $$ select decrypted_secret from vault.decrypted_secrets where name = 'planner_token' limit 1 $$;
revoke execute on function public.get_planner_token() from public, anon, authenticated;
grant execute on function public.get_planner_token() to service_role;

-- a person's edit freezes an auto item; the planner (service role) and ticking done do not
create or replace function public.plan_item_touched()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if old.auto and coalesce(current_setting('app.auto_plan', true), '') <> '1' and current_user <> 'service_role'
     and (new.day, new.time, new.title, new.location, new.notes, new.who)
         is distinct from (old.day, old.time, old.title, old.location, old.notes, old.who) then
    new.auto := false;
  end if;
  return new;
end
$$;

-- trip_planner_requests
create extension if not exists pg_net with schema extensions;

-- asks the plan-trip function to re-plan the trip; pg_net sends it after commit and never blocks the swipe
create or replace function public.request_plan()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'planner_token' limit 1;
  if tok is not null and new.trip_id is not null then
    perform net.http_post(
      url := 'https://wbofjfwbdewgnwjmcpnv.supabase.co/functions/v1/plan-trip',
      body := jsonb_build_object('trip_id', new.trip_id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-plan-token', tok),
      timeout_milliseconds := 5000);
  end if;
  return null;
end
$$;
revoke execute on function public.request_plan() from public, anon, authenticated;

create trigger swipes_replan after insert or update on public.swipes
  for each row execute function public.request_plan();
create trigger places_replan_new after insert on public.places
  for each row execute function public.request_plan();
create trigger places_replan_who after update on public.places
  for each row when (old.who is distinct from new.who or old.visited is distinct from new.visited)
  execute function public.request_plan();
create trigger bookings_replan after insert or update on public.bookings
  for each row execute function public.request_plan();
