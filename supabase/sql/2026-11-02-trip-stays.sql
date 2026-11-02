-- Plan before hotels: where each party sleeps each night is its own thing (trip_stays), not only a hotel booking.
-- NOT applied yet. Apply by hand, in order, after the live baseline (2026-11-02-live-baseline.sql).
-- The app and the planner (plan-trip) keep working without it: they fall back to hotel bookings while the table is
-- missing. Written with create or replace / if not exists so a second run is harmless. The few statements that need the
-- removal keyword are built from two string pieces inside DO blocks (the SQL tool asks to confirm that word).

-- 1. cities: the places a trip can sleep in. Replaces the lists in base_point(), plan-trip and the app.
create table if not exists public.cities (
  id text primary key,
  country text not null default 'JP',
  name_en text not null,
  name_he text not null,
  lat double precision not null,
  lng double precision not null,
  tz text not null default 'Asia/Tokyo'
);
alter table public.cities enable row level security;
do $$ begin
  create policy cities_read on public.cities for select to authenticated using (true);
exception when duplicate_object then null; end $$;
grant select on public.cities to authenticated;

insert into public.cities (id, country, name_en, name_he, lat, lng, tz) values
  ('tokyo',    'JP', 'Tokyo',    'טוקיו',   35.681, 139.767, 'Asia/Tokyo'),
  ('yokohama', 'JP', 'Yokohama', 'יוקוהמה', 35.444, 139.638, 'Asia/Tokyo'),
  ('kyoto',    'JP', 'Kyoto',    'קיוטו',   35.003, 135.759, 'Asia/Tokyo'),
  ('osaka',    'JP', 'Osaka',    'אוסקה',   34.686, 135.502, 'Asia/Tokyo'),
  ('nara',     'JP', 'Nara',     'נארה',    34.685, 135.805, 'Asia/Tokyo')
on conflict (id) do nothing;

-- base_point(city) reads cities (same signature; no longer immutable because it reads a table)
create or replace function public.base_point(b text, out lat double precision, out lng double precision)
 returns record
 language sql
 stable
 set search_path to ''
as $function$
  select c.lat, c.lng from public.cities c where c.id = $1
$function$;

-- 2. trip_stays: a party's nights in one city. party null = everyone (matches members.couple otherwise).
create table if not exists public.trip_stays (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null,
  party text,
  city text not null references public.cities(id),
  lat double precision,
  lng double precision,
  area text,
  check_in date not null,
  check_out date not null,
  status text not null default 'proposed' check (status in ('proposed', 'confirmed')),
  locked boolean not null default false,
  booking_id uuid,
  source text not null default 'manual' check (source in ('manual', 'booking', 'auto')),
  created_at timestamptz not null default now(),
  constraint trip_stays_nights check (check_out > check_in)
);
create index if not exists trip_stays_trip_idx on public.trip_stays (trip_id, check_in);
create index if not exists trip_stays_booking_idx on public.trip_stays (booking_id);

-- foreign keys: a trip's stays go with the trip; a stay outlives its booking (booking_id becomes null)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'trip_stays_trip_id_fkey') then
    alter table public.trip_stays add constraint trip_stays_trip_id_fkey
      foreign key (trip_id) references public.trips(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'trip_stays_booking_id_fkey') then
    alter table public.trip_stays add constraint trip_stays_booking_id_fkey
      foreign key (booking_id) references public.bookings(id) on delete set null;
  end if;
end $$;

alter table public.trip_stays enable row level security;
do $$ begin
  create policy trip_stays_all on public.trip_stays as permissive for all to authenticated
    using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
exception when duplicate_object then null; end $$;
grant select, insert, update, delete on public.trip_stays to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trip_stays;
exception when duplicate_object then null; end $$;

-- the planner runs again when a stay is added, changed or removed (request_plan() reads NEW, which a removal lacks)
create or replace function public.request_plan_stay()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare tok text; tid uuid;
begin
  tid := case when tg_op = 'INSERT' or tg_op = 'UPDATE' then new.trip_id else old.trip_id end;
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'planner_token' limit 1;
  if tok is not null and tid is not null then
    perform net.http_post(
      url := 'https://wbofjfwbdewgnwjmcpnv.supabase.co/functions/v1/plan-trip',
      body := jsonb_build_object('trip_id', tid),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-plan-token', tok),
      timeout_milliseconds := 5000);
  end if;
  return null;
end
$function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trip_stays_replan' and not tgisinternal) then
    create trigger trip_stays_replan after insert or update or delete on public.trip_stays
      for each row execute function public.request_plan_stay();
  end if;
end $$;

-- 3. a hotel booking keeps one confirmed, locked stay in step with it (city from hotel_base; the planner geocodes it)
create or replace function public.sync_booking_stay()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare c text; d1 date; d2 date;
begin
  if new.kind <> 'hotel' or new.starts_at is null or new.ends_at is null then return null; end if;
  c := public.hotel_base(new.title || ' ' || coalesce(new.location, ''));
  d1 := (new.starts_at at time zone 'UTC')::date;
  d2 := (new.ends_at at time zone 'UTC')::date;
  if c is null or d2 <= d1 then return null; end if;
  update public.trip_stays
     set party = new.who, city = c, check_in = d1, check_out = d2, status = 'confirmed', locked = true
   where booking_id = new.id;
  if not found then
    insert into public.trip_stays (trip_id, party, city, check_in, check_out, status, locked, booking_id, source)
    values (new.trip_id, new.who, c, d1, d2, 'confirmed', true, new.id, 'booking');
  end if;
  return null;
end
$function$;

do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'bookings_stay' and not tgisinternal) then
    create trigger bookings_stay after insert or update on public.bookings
      for each row execute function public.sync_booking_stay();
  end if;
end $$;

-- backfill: a stay for every hotel booking that has none
insert into public.trip_stays (trip_id, party, city, check_in, check_out, status, locked, booking_id, source)
select b.trip_id, b.who, public.hotel_base(b.title || ' ' || coalesce(b.location, '')),
       (b.starts_at at time zone 'UTC')::date, (b.ends_at at time zone 'UTC')::date, 'confirmed', true, b.id, 'booking'
  from public.bookings b
 where b.kind = 'hotel' and b.starts_at is not null and b.ends_at is not null
   and public.hotel_base(b.title || ' ' || coalesce(b.location, '')) is not null
   and (b.ends_at at time zone 'UTC')::date > (b.starts_at at time zone 'UTC')::date
   and not exists (select 1 from public.trip_stays s where s.booking_id = b.id);

-- 4. trip_nights reads trip_stays (same signature and result), so place_base, place_couples, match_place,
--    plan_place_couples and trip_place_couples follow. party null = every couple unless day_info.who names another.
--    A proposed stay yields to a confirmed one for the same couple and night.
create or replace function public.trip_nights(tid uuid)
 returns table(day integer, couple text, base text)
 language sql
 stable
 set search_path to ''
as $function$
  with t as (select start_date from public.trips where id = tid),
  c as (select distinct m.couple from public.members m where m.trip_id = tid and m.couple is not null),
  n as (
    select (g.d::date - t.start_date) + 1 as day, s.party as who, s.city as base, s.status
      from public.trip_stays s
      cross join t
      cross join lateral generate_series(s.check_in, s.check_out - 1, interval '1 day') g(d)
     where s.trip_id = tid
  ),
  j as (
    select n.day::int as day, c.couple, n.base, n.status
      from n
      join c on n.who = c.couple
             or (n.who is null and not exists (
                   select 1 from public.day_info d
                    where d.trip_id = tid and d.day = n.day and d.who is not null and d.who <> c.couple))
     where n.base is not null
  )
  select distinct j.day, j.couple, j.base
    from j
   where j.status = 'confirmed'
      or not exists (select 1 from j k where k.day = j.day and k.couple = j.couple and k.status = 'confirmed')
$function$;
