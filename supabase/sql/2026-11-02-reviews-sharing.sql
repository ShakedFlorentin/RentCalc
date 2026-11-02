-- Not applied yet: run by hand in the SQL Editor, once.
-- 1. Short reviews after a visit: places.visited_at (set by a trigger when visited flips to true) and
--    place_ratings.answers (the one quick question, e.g. {"crowd":"packed","stroller":"yes"}).
-- 2. Opt-in public itinerary sharing: shared_plans holds a snapshot built on the phone (place names, categories,
--    short tips, coordinates, a city per day, nothing else). Nobody can read the table without being a member of
--    the trip; the public reads one snapshot at a time through get_shared_plan(slug), and only while not revoked.

-- reviews ---------------------------------------------------------------------------------------------------------
alter table public.places add column if not exists visited_at timestamptz;

create or replace function public.places_set_visited_at()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if new.visited then
    -- keep the first time it was ticked; the phone may already have sent it
    if tg_op = 'INSERT' or not old.visited then
      new.visited_at := coalesce(new.visited_at, now());
    end if;
  else
    new.visited_at := null;
  end if;
  return new;
end $$;

create trigger places_visited_at before insert or update of visited on public.places
  for each row execute function public.places_set_visited_at();

alter table public.place_ratings add column if not exists answers jsonb;
alter table public.place_ratings add constraint place_ratings_answers_small
  check (answers is null or (jsonb_typeof(answers) = 'object' and pg_column_size(answers) < 1000));

-- sharing ---------------------------------------------------------------------------------------------------------
-- trip_id has no foreign key on purpose: a trip that is removed must never be blocked by its shared links
create table if not exists public.shared_plans (
  slug text primary key check (slug ~ '^[a-z0-9]{10}$'),
  trip_id uuid not null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object' and pg_column_size(snapshot) < 200000),
  revoked_at timestamptz
);
create index if not exists shared_plans_trip on public.shared_plans (trip_id);

alter table public.shared_plans enable row level security;

-- members of the trip only; there is no policy for anyone else, so anon and other trips see nothing
create policy "members read shared plans" on public.shared_plans
  for select to authenticated using (public.is_trip_member(trip_id));
create policy "members share a plan" on public.shared_plans
  for insert to authenticated with check (public.is_trip_member(trip_id) and created_by = (select auth.uid()));
create policy "members stop sharing" on public.shared_plans
  for update to authenticated using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

revoke all on public.shared_plans from anon, authenticated;
grant select, insert on public.shared_plans to authenticated;
-- the only column a member may change afterwards is revoked_at (stop sharing)
grant update (revoked_at) on public.shared_plans to authenticated;

-- the public door: one snapshot by its unguessable slug, null when unknown or revoked
create or replace function public.get_shared_plan(slug text)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select s.snapshot from public.shared_plans s where s.slug = get_shared_plan.slug and s.revoked_at is null
$$;

revoke all on function public.get_shared_plan(text) from public;
grant execute on function public.get_shared_plan(text) to anon, authenticated;
