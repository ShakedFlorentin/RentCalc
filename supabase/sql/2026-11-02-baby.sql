-- Baby details only for trips with a baby.
-- Baby details are hidden only when some member has answered (profiles.answers.with) and no answer includes 'baby'
-- ('kids' doesn't count). Nobody answered = unknown = shown.
-- profiles are readable only by their owner, so the app asks this function (members only). match_place stops copying
-- the card's baby line into a new place's notes for trips without one. Existing places keep their notes.

CREATE OR REPLACE FUNCTION public.trip_has_baby(tid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.members m where m.trip_id = tid and m.user_id = auth.uid()) then
    return false;
  end if;
  -- unknown (nobody has answered) counts as a baby; only answers without 'baby' hide it
  return not exists (
           select 1 from public.members m join public.profiles p on p.user_id = m.user_id
            where m.trip_id = tid and jsonb_typeof(p.answers -> 'with') = 'array')
      or exists (
           select 1 from public.members m join public.profiles p on p.user_id = m.user_id
            where m.trip_id = tid and jsonb_typeof(p.answers -> 'with') = 'array' and p.answers -> 'with' ? 'baby');
end
$function$;
revoke all on function public.trip_has_baby(uuid) from public, anon;
grant execute on function public.trip_has_baby(uuid) to authenticated;

-- match_place: (the check is inline, not trip_has_baby, which needs a signed-in member and the planner may run without one) as in 2026-11-02-discovery.sql, except the baby line is copied only when the trip has a baby.
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
            c.maps_url, nullif(concat_ws(E'\n', c.tip, case when not exists (select 1 from public.members bm join public.profiles bp on bp.user_id = bm.user_id
                                  where bm.trip_id = tid and jsonb_typeof(bp.answers -> 'with') = 'array')
                      or exists (select 1 from public.members bm join public.profiles bp on bp.user_id = bm.user_id
                                  where bm.trip_id = tid and jsonb_typeof(bp.answers -> 'with') = 'array' and bp.answers -> 'with' ? 'baby')
                 then 'עם התינוק: ' || c.baby_notes end), ''),
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
