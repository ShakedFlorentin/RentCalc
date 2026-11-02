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

-- ---------------------------------------------------------------------------------
-- Functions that read swipes: a "not now" (skipped = true) is ignored, as if no vote.
-- Everything else is the live text from 2026-11-02-live-baseline.sql, unchanged.
-- The column above must exist first (the ALTER at the top of this file).
-- ---------------------------------------------------------------------------------

-- couple_vote: the join skips swipes with skipped = true, so a not-now is no vote (null when a couple has only not-nows).
CREATE OR REPLACE FUNCTION public.couple_vote(cid uuid, tid uuid, cpl text)
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select case when bool_or(s.liked) and not bool_or(not s.liked) then 'yes'
              when bool_or(s.liked) then 'split'
              when bool_or(not s.liked) then 'no' end
    from public.members m
    join public.swipes s on s.user_id = m.user_id and s.candidate_id = cid and not s.skipped
   where m.trip_id = tid and m.couple = cpl
$function$;

-- match_place: the like count (no-couples case) ignores skipped swipes. The couple logic goes through couple_vote, fixed above. The DELETE statements are unchanged.
CREATE OR REPLACE FUNCTION public.match_place(cid uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  c public.candidates;
  tid uuid;
  everyone text[];
  eligible text[];
  yes text[];
  waiting int := 0;
  target text;
  need int;
  likes int;
  pl public.places;
  pb record;
  day_pick int;
  cnt int;
begin
  select * into c from public.candidates where id = cid;
  if not found then return; end if;
  tid := c.trip_id;
  perform set_config('app.auto_plan', '1', true);

  select array_agg(distinct m.couple order by m.couple) into everyone
    from public.members m where m.trip_id = tid and m.couple is not null;

  if everyone is null then
    select match_threshold into need from public.trips where id = tid;
    select count(*) into likes from public.swipes where candidate_id = cid and liked and not skipped;
    if likes >= need then yes := array['*']; end if;
    target := null;
  else
    eligible := public.place_couples(tid, cid);
    select array_agg(x order by x) into yes from unnest(eligible) x where public.couple_vote(cid, tid, x) = 'yes';
    select count(*) into waiting from unnest(eligible) x where public.couple_vote(cid, tid, x) is null;
    if yes is not null then
      target := case when yes @> everyone then null else array_to_string(yes, ' + ') end;
    end if;
  end if;

  if yes is null then
    delete from public.itinerary_items i using public.places p
     where i.place_id = p.id and p.candidate_id = cid and i.auto;
    update public.places set auto_planned = false where candidate_id = cid;
    delete from public.places p
     where p.candidate_id = cid and p.added_by in ('מאצ׳', '💘 מאצ׳') and not p.visited
       and not exists (select 1 from public.itinerary_items i where i.place_id = p.id);
    perform set_config('app.auto_plan', '', true);
    return;
  end if;

  update public.places p set candidate_id = c.id, who = target
   where p.trip_id = tid
     and (p.candidate_id = c.id or (p.candidate_id is null and public.norm_name(p.name) = public.norm_name(c.name)))
  returning * into pl;
  if pl.id is null then
    insert into public.places(trip_id, candidate_id, city, area, name, category, url, notes, lat, lng, verdict, audience,
                              instagram_url, tiktok_url, photos, added_by, who)
    values (tid, c.id, public.city_he(c.city), c.area, c.name,
            case when c.category in ('food', 'sight', 'shopping') then c.category
                 when c.category = 'cafe' then 'food' else 'other' end,
            c.maps_url, nullif(concat_ws(E'\n', c.tip, 'עם התינוק: ' || c.baby_notes), ''),
            c.lat, c.lng, c.verdict, c.audience, c.instagram_url, c.tiktok_url, c.photos, 'מאצ׳', target)
    on conflict do nothing
    returning * into pl;
  end if;
  if pl.id is null then
    perform set_config('app.auto_plan', '', true);
    return;
  end if;

  delete from public.itinerary_items i
   where i.place_id = pl.id and i.auto and (waiting > 0 or i.who is distinct from target);
  if found then
    update public.places set auto_planned = false where id = pl.id;
    pl.auto_planned := false;
  end if;

  if waiting > 0 or pl.auto_planned or exists (select 1 from public.itinerary_items i where i.place_id = pl.id) then
    perform set_config('app.auto_plan', '', true);
    return;
  end if;

  select * into pb from public.place_base(tid, cid);
  if pb.base is null or coalesce(pb.km, 0) > 25 then
    perform set_config('app.auto_plan', '', true);
    return;
  end if;

  select d.day into day_pick
    from (select n.day from public.trip_nights(tid) n
           where n.base = pb.base
           group by n.day
          having count(distinct n.couple) filter (where n.couple = any(yes) or yes = array['*']) = greatest(cardinality(yes), 1)
             and (yes = array['*'] or count(distinct n.couple) filter (where n.couple <> all(yes)) = 0)) d
    cross join lateral (
      select count(*) as items, coalesce(bool_or(c.area is not null and p2.area = c.area), false) as near
        from public.itinerary_items i
        left join public.places p2 on p2.id = i.place_id
       where i.trip_id = tid and i.day = d.day) l
   where l.items < 5
   order by l.near desc, l.items, d.day
   limit 1;

  if day_pick is not null then
    select count(*) into cnt from public.itinerary_items where trip_id = tid and day = day_pick;
    insert into public.itinerary_items(trip_id, day, title, location, notes, category, place_id, who, sort, auto)
    values (tid, day_pick, c.name,
            case when c.lat is not null then c.lat || ',' || c.lng else c.name || ' ' || coalesce(public.city_he(c.city), '') end,
            pl.notes,
            case when c.category in ('food', 'cafe') then 'food' when c.category = 'shopping' then 'shopping'
                 when c.category in ('sight', 'experience') then 'sight' else 'other' end,
            pl.id, target, 100 + cnt, true);
    update public.places set auto_planned = true where id = pl.id;
  end if;
  perform set_config('app.auto_plan', '', true);
end
$function$;

-- plan_place_couples: the votes CTE ignores skipped swipes, so a couple with only not-nows is not in voted and not in yes.
CREATE OR REPLACE FUNCTION public.plan_place_couples(tid uuid)
 RETURNS TABLE(candidate_id uuid, couples text[], voted text[], yes text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where s.trip_id = tid and m.couple is not null and not s.skipped
     group by s.candidate_id, m.couple)
  select e.id, e.couples,
         array(select v.couple from votes v where v.candidate_id = e.id and v.couple = any(e.couples) order by v.couple),
         array(select v.couple from votes v where v.candidate_id = e.id and v.yes and v.couple = any(e.couples) order by v.couple)
    from elig e
$function$;

-- trip_place_couples: the votes CTE ignores skipped swipes.
CREATE OR REPLACE FUNCTION public.trip_place_couples(tid uuid)
 RETURNS TABLE(candidate_id uuid, couples text[], liked_by text[])
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with nights as (select * from public.trip_nights(tid)),
  everyone as (select array_agg(distinct m.couple order by m.couple) as cs from public.members m where m.trip_id = tid and m.couple is not null),
  bp as (select b.base, p.lat, p.lng from (select distinct base from nights) b cross join lateral public.base_point(b.base) p),
  cand as (select c.id, c.lat, c.lng, c.city from public.candidates c where c.trip_id = tid and public.is_trip_member(tid)),
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
    select s.candidate_id, m.couple
      from public.swipes s join public.members m on m.user_id = s.user_id and m.trip_id = s.trip_id
     where s.trip_id = tid and m.couple is not null and not s.skipped
     group by s.candidate_id, m.couple
    having bool_or(s.liked) and not bool_or(not s.liked))
  select e.id, e.couples,
         array(select v.couple from votes v where v.candidate_id = e.id and v.couple = any(e.couples) order by v.couple)
    from elig e
$function$;
