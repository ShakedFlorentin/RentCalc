-- Run by hand in the SQL Editor on 2026-10-28 (the migration tool timed out on approval).
-- The helpers they use (hotel_base, trip_nights, place_base, place_couples, couple_vote, trip_place_couples)
-- and the columns itinerary_items.auto / places.auto_planned were applied as migrations the same day.

-- Step 4: decides a card's match from the couples it is for, and puts the place on the list and into the plan.
-- Only defines the function; nothing in the plan changes until step 5 connects it.
create or replace function public.match_place(cid uuid) returns void
language plpgsql security definer set search_path = '' as $$
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
    select count(*) into likes from public.swipes where candidate_id = cid and liked;
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
$$;
revoke all on function public.match_place(uuid) from public, anon, authenticated;

-- Step 5: every swipe now runs the new matching (match_place), a person's own edit to an item the match put in
-- makes it theirs, and the votes so far are run once to put today's matches into the plan.

create or replace function public.on_swipe() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.match_place(coalesce(new.candidate_id, old.candidate_id));
  return null;
end
$$;

create or replace function public.plan_item_touched() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.auto and coalesce(current_setting('app.auto_plan', true), '') <> '1' then
    new.auto := false;
  end if;
  return new;
end
$$;
drop trigger if exists itinerary_touched on public.itinerary_items;
create trigger itinerary_touched before update on public.itinerary_items
  for each row execute function public.plan_item_touched();

-- the votes so far: places in the same city and area one after another, so neighbours share a day
do $$
declare r record;
begin
  for r in select c.id from public.candidates c
           where exists (select 1 from public.swipes s where s.candidate_id = c.id)
           order by c.city, c.area nulls last, c.name loop
    perform public.match_place(r.id);
  end loop;
end $$;

select count(*) filter (where auto) as put_in_by_matches, count(*) as all_plan_items from public.itinerary_items;
