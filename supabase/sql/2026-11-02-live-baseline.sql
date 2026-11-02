-- Snapshot of the live schema on 2026-11-02, for reference. Do not run as a migration.
--
-- Read from project wbofjfwbdewgnwjmcpnv with SELECT-only catalog queries
-- (pg_get_functiondef, pg_attribute, pg_constraint, pg_indexes, pg_policies,
-- pg_get_triggerdef, pg_publication_tables, information_schema.column_privileges).
--
-- Notes
--  * Every public function is included in full. The older files in supabase/sql/ hold
--    hand-written versions whose formatting differs from pg_get_functiondef, so "identical"
--    could not be checked textually: nothing was skipped. Functions that also live in
--    supabase/sql/*.sql: plan_place_couples, get_planner_token, plan_item_touched, request_plan,
--    request_card_facts, item_address (2026-10-28-trip-planner.sql); match_place, on_swipe,
--    plan_item_touched (2026-10-28-match-by-who-is-there.sql). The live text below wins.
--  * match_place and on_swipe use CRLF line endings live; normalised to LF here.
--  * Secrets: no key or token literal exists in any function body or default. The two
--    functions get_anthropic_key / get_planner_token only read vault.decrypted_secrets by
--    secret NAME. Nothing needed redacting.
--  * Foreign-key actions and the like are written as comments next to each table so the
--    CREATE TABLE text stays plain.
--  * Tables not in the requested list but present in public (all have RLS on):
--    _plan_compare, checklist_items, essentials, expenses, geo_cache, guide_places,
--    join_attempts, place_facts. Their policies/triggers are included below where they exist.
--  * Extensions/schemas referenced: auth, vault, net (pg_net), extensions (pgcrypto).


-- =====================================================================================
-- 1. FUNCTIONS (schema public, all with SET search_path TO '' unless noted)
-- =====================================================================================

CREATE OR REPLACE FUNCTION public.base_point(b text, OUT lat double precision, OUT lng double precision)
 RETURNS record
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select v.lat, v.lng
    from (values ('tokyo', 35.681, 139.767), ('yokohama', 35.444, 139.638), ('kyoto', 35.003, 135.759),
                 ('osaka', 34.686, 135.502), ('nara', 34.685, 135.805)) v(b, lat, lng)
   where v.b = $1
$function$;

CREATE OR REPLACE FUNCTION public.block_new_users()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c text := upper(trim(coalesce(new.raw_user_meta_data->>'invite', '')));
begin
  update public.invites set used_by = new.id, used_at = now()
   where code = c and used_by is null and expires_at > now();
  if not found then raise exception 'sign-ups are by invitation only'; end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.card_to_library()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare lid uuid;
begin
  -- the library's own copies come in with library_id set; only cards people add get here
  if new.library_id is not null then return new; end if;
  -- the same place already in the library (same name, spelling aside): use that card
  select l.id into lid from public.place_library l where public.norm_name(l.name) = public.norm_name(new.name) limit 1;
  if lid is null then
    insert into public.place_library(name, name_ja, city, area, category, lat, lng, coord_precision, hype, reality, verdict,
                                     tabelog_score, google_score, price, tip, sources, audience, baby_notes, local_pick,
                                     maps_url, website_url, instagram_url, tiktok_url, photos, serves, dishes, todo, special,
                                     highlights, time_needed, kosher, kosher_note, opens, closes, closed_weekdays,
                                     closed_dates, open_dates, best_time, visit_mins, booking, plan_line, baby_block,
                                     facts_at, facts_sure, address, en, tags, active)
    values (new.name, new.name_ja, new.city, new.area, new.category, new.lat, new.lng, new.coord_precision, new.hype,
            new.reality, new.verdict, new.tabelog_score, new.google_score, new.price, new.tip, new.sources, new.audience,
            new.baby_notes, new.local_pick, new.maps_url, new.website_url, new.instagram_url, new.tiktok_url, new.photos,
            new.serves, new.dishes, new.todo, new.special, new.highlights, new.time_needed, new.kosher, new.kosher_note,
            new.opens, new.closes, new.closed_weekdays, new.closed_dates, new.open_dates, new.best_time, new.visit_mins,
            new.booking, new.plan_line, new.baby_block, new.facts_at, new.facts_sure, new.address, new.en,
            coalesce(new.tags, '{}'), true)
    returning id into lid;
  end if;
  new.library_id := lid;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.check_expense_people()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists (
    select 1 from unnest(array_append(new.split_among, new.paid_by)) u(id)
     where not exists (select 1 from public.members m where m.trip_id = new.trip_id and m.user_id = u.id)
  ) then
    raise exception 'everyone on an expense must be in the trip';
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.check_same_trip()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if tg_table_name = 'swipes' then
    if not exists (select 1 from public.candidates where id = new.candidate_id and trip_id = new.trip_id) then
      raise exception 'candidate belongs to another trip';
    end if;
  elsif tg_table_name = 'itinerary_items' then
    if new.place_id is not null
       and not exists (select 1 from public.places where id = new.place_id and trip_id = new.trip_id) then
      raise exception 'place belongs to another trip';
    end if;
  elsif tg_table_name = 'places' then
    if new.candidate_id is not null
       and not exists (select 1 from public.candidates where id = new.candidate_id and trip_id = new.trip_id) then
      raise exception 'candidate belongs to another trip';
    end if;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.city_he(code text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$ select case code when 'tokyo' then 'טוקיו' when 'kyoto' then 'קיוטו' when 'osaka' then 'אוסקה'
  when 'nara' then 'נארה' when 'daytrip' then 'טיול יום' else code end $function$;

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
    join public.swipes s on s.user_id = m.user_id and s.candidate_id = cid
   where m.trip_id = tid and m.couple = cpl
$function$;

CREATE OR REPLACE FUNCTION public.create_trip(trip_name text, name text, start date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tid uuid; code text;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  code := upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10));
  insert into public.trips(name, start_date, num_days, join_code, created_by)
    values (trip_name, start, 14, code, auth.uid()) returning id into tid;
  insert into public.members(trip_id, user_id, display_name) values (tid, auth.uid(), trim(name));
  insert into public.checklist_items(trip_id, list, text) values
    (tid, 'todo', 'דרכונים בתוקף לפחות 6 חודשים'),
    (tid, 'todo', 'Visit Japan Web – למלא לפני הטיסה'),
    (tid, 'todo', 'ביטוח נסיעות'),
    (tid, 'todo', 'להחליט על JR Pass מול כרטיסים בודדים'),
    (tid, 'todo', 'eSIM / ראוטר כיס'),
    (tid, 'todo', 'להוציא ין במזומן'),
    (tid, 'packing', 'מתאם חשמל (Type A)'),
    (tid, 'packing', 'נעלי הליכה נוחות'),
    (tid, 'packing', 'סוללה ניידת'),
    (tid, 'packing', 'מנשא לתינוק + עגלה מתקפלת'),
    (tid, 'packing', 'בקבוקים ותרמוס למים חמים');
  return tid;
end $function$;

CREATE OR REPLACE FUNCTION public.fill_plan_facts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare l public.place_library;
begin
  if new.facts_at is not null then return new; end if;
  select * into l from public.place_library x
   where x.facts_at is not null and (x.id = new.library_id or public.same_place_name(x.name, new.name))
   order by (x.id = new.library_id) desc limit 1;
  if found then
    new.opens := l.opens; new.closes := l.closes; new.closed_weekdays := l.closed_weekdays;
    new.closed_dates := l.closed_dates; new.open_dates := l.open_dates; new.best_time := l.best_time;
    new.visit_mins := l.visit_mins; new.booking := l.booking; new.plan_line := l.plan_line;
    new.baby_block := l.baby_block; new.facts_at := l.facts_at; new.facts_sure := l.facts_sure;
    new.address := coalesce(new.address, l.address); new.en := coalesce(new.en, l.en);
  end if;
  return new;
end
$function$;

-- reads a vault secret by name; no secret value is stored in the function
CREATE OR REPLACE FUNCTION public.get_anthropic_key()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select decrypted_secret from vault.decrypted_secrets where name = 'anthropic_api_key' limit 1 $function$;

-- reads a vault secret by name; no secret value is stored in the function
CREATE OR REPLACE FUNCTION public.get_planner_token()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select decrypted_secret from vault.decrypted_secrets where name = 'planner_token' limit 1 $function$;

CREATE OR REPLACE FUNCTION public.hotel_base(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select case
    when t ~* 'osaka' then 'osaka'
    when t ~* 'kyoto' then 'kyoto'
    when t ~* 'yokohama|kanagawa' then 'yokohama'
    when t ~* '\mnara\M' then 'nara'
    when t ~* 'tokyo|shinjuku|minato|shibuya|chiyoda|taito|shimbashi|ginza|ikebukuro|asakusa|ueno' then 'tokyo'
  end
$function$;

CREATE OR REPLACE FUNCTION public.is_trip_member(tid uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$ select exists (select 1 from public.members m where m.trip_id = tid and m.user_id = auth.uid()) $function$;

CREATE OR REPLACE FUNCTION public.item_address()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a text;
begin
  if new.place_id is not null and (tg_op = 'INSERT' or new.place_id is distinct from old.place_id) then
    select c.address into a from public.places p join public.candidates c on c.id = p.candidate_id where p.id = new.place_id;
    if a is not null then new.location := a; end if;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.join_trip(code text, name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tid uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.join_attempts
       where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then
    raise exception 'יותר מדי ניסיונות, נסו שוב בעוד שעה';
  end if;
  insert into public.join_attempts(user_id) values (auth.uid());
  select id into tid from public.trips where join_code = upper(trim(code));
  -- a wrong code returns null instead of raising, so the attempt recorded above is kept
  if tid is null then return null; end if;
  insert into public.members(trip_id, user_id, display_name) values (tid, auth.uid(), trim(name))
    on conflict (trip_id, user_id) do update set display_name = excluded.display_name;
  return tid;
end $function$;

CREATE OR REPLACE FUNCTION public.km(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
 RETURNS double precision
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select 111.2 * sqrt(power(lat2 - lat1, 2) + power((lng2 - lng1) * cos(radians((lat1 + lat2) / 2)), 2))
$function$;

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
$function$;

CREATE OR REPLACE FUNCTION public.my_invite()
 RETURNS TABLE(trip_id uuid, join_code text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select i.trip_id, t.join_code from public.invites i left join public.trips t on t.id = i.trip_id
   where i.used_by = auth.uid() order by i.used_at desc limit 1
$function$;

CREATE OR REPLACE FUNCTION public.name_words(t text)
 RETURNS text[]
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select coalesce(array_agg(distinct x order by x), '{}')
    from regexp_split_to_table(lower(t), '[^[:alnum:]]+') x
   where length(x) >= 3 and x not in ('the', 'and', 'main', 'store', 'shop', 'honten', 'branch', 'sohonten')
$function$;

CREATE OR REPLACE FUNCTION public.norm_name(t text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$ select lower(regexp_replace(coalesce(t, ''), '[^[:alnum:]]+', '', 'g')) $function$;

CREATE OR REPLACE FUNCTION public.on_swipe()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  perform public.match_place(coalesce(new.candidate_id, old.candidate_id));
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.place_base(tid uuid, cid uuid, OUT base text, OUT km double precision)
 RETURNS record
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select x.base, x.km
    from (select nb.base,
                 case when c.lat is null then null else public.km(c.lat, c.lng, p.lat, p.lng) end as km,
                 (c.lat is null and nb.base = c.city) as by_city
            from public.candidates c
           cross join (select distinct n.base from public.trip_nights(tid) n) nb
           cross join lateral public.base_point(nb.base) p
           where c.id = cid) x
   where x.km is not null or x.by_city
   order by x.km nulls last
   limit 1
$function$;

CREATE OR REPLACE FUNCTION public.place_couples(tid uuid, cid uuid)
 RETURNS text[]
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with pb as (select * from public.place_base(tid, cid)),
  c as (select lat, lng from public.candidates where id = cid)
  select coalesce(
    case
      when (select km from pb) is null or (select km from pb) <= 25 then
        (select array_agg(distinct n.couple order by n.couple) from public.trip_nights(tid) n where n.base = (select base from pb))
      else
        (select array_agg(distinct n.couple order by n.couple)
           from public.trip_nights(tid) n
           cross join lateral public.base_point(n.base) p
          where public.km((select lat from c), (select lng from c), p.lat, p.lng) <= 150)
    end,
    (select array_agg(distinct m.couple order by m.couple) from public.members m where m.trip_id = tid and m.couple is not null))
$function$;

CREATE OR REPLACE FUNCTION public.place_ratings_touch()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at := now();
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.plan_item_touched()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if old.auto and coalesce(current_setting('app.auto_plan', true), '') <> '1' and current_user <> 'service_role'
     and (new.day, new.time, new.title, new.location, new.notes, new.who)
         is distinct from (old.day, old.time, old.title, old.location, old.notes, old.who) then
    new.auto := false;
  end if;
  return new;
end
$function$;

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
     where s.trip_id = tid and m.couple is not null
     group by s.candidate_id, m.couple)
  select e.id, e.couples,
         array(select v.couple from votes v where v.candidate_id = e.id and v.couple = any(e.couples) order by v.couple),
         array(select v.couple from votes v where v.candidate_id = e.id and v.yes and v.couple = any(e.couples) order by v.couple)
    from elig e
$function$;

CREATE OR REPLACE FUNCTION public.request_card_facts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'planner_token' limit 1;
  if tok is not null then
    perform net.http_post(
      url := 'https://wbofjfwbdewgnwjmcpnv.supabase.co/functions/v1/card-facts',
      body := jsonb_build_object('candidate_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-plan-token', tok),
      timeout_milliseconds := 5000);
  end if;
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.request_card_photos()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare tok text;
begin
  select decrypted_secret into tok from vault.decrypted_secrets where name = 'planner_token' limit 1;
  if tok is not null then
    perform net.http_post(
      url := 'https://wbofjfwbdewgnwjmcpnv.supabase.co/functions/v1/card-photos',
      body := jsonb_build_object('candidate_id', new.id),
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-plan-token', tok),
      timeout_milliseconds := 5000);
  end if;
  return null;
end
$function$;

CREATE OR REPLACE FUNCTION public.request_plan()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.same_place_name(a text, b text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  with x as (select public.name_words(a) as wa, public.name_words(b) as wb),
  s as (select case when cardinality(wa) <= cardinality(wb) then wa else wb end as shorter, wa, wb from x)
  select public.norm_name(a) = public.norm_name(b)
      or (cardinality(wa) > 0 and cardinality(wb) > 0 and (wa <@ wb or wb <@ wa)
          and exists (select 1 from unnest(shorter) w
                       where length(w) >= 4
                         and w not in ('aquarium', 'museum', 'temple', 'shrine', 'park', 'market', 'tower', 'station',
                                       'cafe', 'coffee', 'ramen', 'sushi', 'garden', 'street', 'shopping', 'tempura',
                                       'onsen', 'castle', 'hotel', 'tokyo', 'kyoto', 'osaka', 'nara', 'japan',
                                       'yokocho', 'depachika', 'food', 'restaurant', 'izakaya', 'kitchen')))
    from s
$function$;

CREATE OR REPLACE FUNCTION public.sync_library(tid uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n int;
begin
  if not public.is_trip_member(tid) then raise exception 'not a member'; end if;
  insert into public.candidates(trip_id, library_id, name, name_ja, city, area, category, lat, lng, coord_precision,
                                hype, reality, verdict, tabelog_score, google_score, price, tip, sources, added_by,
                                audience, baby_notes, local_pick, maps_url, website_url, instagram_url, tiktok_url, photos,
                                serves, dishes, todo, special, highlights, time_needed, kosher, kosher_note,
                                opens, closes, closed_weekdays, closed_dates, open_dates, best_time, visit_mins, booking, plan_line,
                                baby_block, facts_at, facts_sure, address, en, tags)
  select tid, l.id, l.name, l.name_ja, l.city, l.area, l.category, l.lat, l.lng, l.coord_precision,
         l.hype, l.reality, l.verdict, l.tabelog_score, l.google_score, l.price, l.tip, l.sources, 'סקאוטים',
         l.audience, l.baby_notes, l.local_pick, l.maps_url, l.website_url, l.instagram_url, l.tiktok_url, l.photos,
         l.serves, l.dishes, l.todo, l.special, l.highlights, l.time_needed, l.kosher, l.kosher_note,
         l.opens, l.closes, l.closed_weekdays, l.closed_dates, l.open_dates, l.best_time, l.visit_mins, l.booking, l.plan_line,
         l.baby_block, l.facts_at, l.facts_sure, l.address, l.en, l.tags
  from public.place_library l
  where l.active
    and not exists (select 1 from public.candidates c
                     where c.trip_id = tid and (c.library_id = l.id or public.same_place_name(c.name, l.name)))
  on conflict do nothing;
  get diagnostics n = row_count;

  -- links/photos are collected after places reach the deck, so refresh them on every sync
  update public.candidates c
     set maps_url = l.maps_url, website_url = l.website_url, instagram_url = l.instagram_url,
         tiktok_url = l.tiktok_url, photos = l.photos,
         lat = coalesce(l.lat, c.lat), lng = coalesce(l.lng, c.lng), coord_precision = l.coord_precision,
         address = coalesce(l.address, c.address)
    from public.place_library l
   where c.trip_id = tid and c.library_id = l.id
     and (c.maps_url, c.instagram_url, c.tiktok_url, c.photos, c.lat, c.lng, c.address)
         is distinct from (l.maps_url, l.instagram_url, l.tiktok_url, l.photos, l.lat, l.lng, coalesce(l.address, c.address));
  -- the English text, once the library card has it
  update public.candidates c set en = l.en
    from public.place_library l
   where c.trip_id = tid and c.library_id = l.id and l.en is not null and c.en is distinct from l.en;
  -- the search words, once the library card has them
  update public.candidates c set tags = l.tags
    from public.place_library l
   where c.trip_id = tid and c.library_id = l.id and cardinality(l.tags) > 0 and c.tags is distinct from l.tags;
  -- planning facts checked later than the trip's copy
  update public.candidates c
     set opens = l.opens, closes = l.closes, closed_weekdays = l.closed_weekdays, closed_dates = l.closed_dates,
         open_dates = l.open_dates, best_time = l.best_time, visit_mins = l.visit_mins, booking = l.booking,
         plan_line = l.plan_line, baby_block = l.baby_block, facts_at = l.facts_at, facts_sure = l.facts_sure
    from public.place_library l
   where c.trip_id = tid and c.library_id = l.id and l.facts_at is not null
     and (c.facts_at is null or c.facts_at < l.facts_at);
  update public.places p
     set url = coalesce(p.url, c.maps_url), instagram_url = c.instagram_url, tiktok_url = c.tiktok_url,
         photos = c.photos, lat = c.lat, lng = c.lng
    from public.candidates c
   where p.trip_id = tid and p.candidate_id = c.id
     and (p.instagram_url, p.tiktok_url, p.photos, p.lat, p.lng)
         is distinct from (c.instagram_url, c.tiktok_url, c.photos, c.lat, c.lng);
  return n;
end $function$;

CREATE OR REPLACE FUNCTION public.trip_nights(tid uuid)
 RETURNS TABLE(day integer, couple text, base text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with t as (select start_date from public.trips where id = tid),
  c as (select distinct m.couple from public.members m where m.trip_id = tid and m.couple is not null),
  n as (
    select (g.d::date - t.start_date) + 1 as day, b.who,
           public.hotel_base(b.title || ' ' || coalesce(b.location, '')) as base
      from public.bookings b
      cross join t
      cross join lateral generate_series((b.starts_at at time zone 'UTC')::date, (b.ends_at at time zone 'UTC')::date - 1, interval '1 day') g(d)
     where b.trip_id = tid and b.kind = 'hotel' and b.starts_at is not null and b.ends_at is not null
  )
  select distinct n.day::int, c.couple, n.base
    from n
    join c on n.who = c.couple
           or (n.who is null and not exists (
                 select 1 from public.day_info d
                  where d.trip_id = tid and d.day = n.day and d.who is not null and d.who <> c.couple))
   where n.base is not null
$function$;

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
     where s.trip_id = tid and m.couple is not null
     group by s.candidate_id, m.couple
    having bool_or(s.liked) and not bool_or(not s.liked))
  select e.id, e.couples,
         array(select v.couple from votes v where v.candidate_id = e.id and v.couple = any(e.couples) order by v.couple)
    from elig e
$function$;


-- =====================================================================================
-- 2. TABLES (columns, types, defaults, constraints, indexes)
--    All 17 requested tables, schema public. RLS is ON for every table in public.
-- =====================================================================================

CREATE TABLE public.trips (
  id uuid not null default gen_random_uuid(),
  name text not null,
  start_date date,
  num_days integer not null default 14,
  join_code text not null,
  created_by uuid,
  created_at timestamp with time zone not null default now(),
  match_threshold integer not null default 2,
  ils_per_jpy numeric(10,6) not null default 0.025,
  settle_by text not null default 'couples'::text,
  CONSTRAINT trips_pkey PRIMARY KEY (id),
  CONSTRAINT trips_join_code_key UNIQUE (join_code),
  CONSTRAINT trips_match_threshold_check CHECK (((match_threshold >= 1) AND (match_threshold <= 20))),
  CONSTRAINT trips_num_days_check CHECK (((num_days >= 1) AND (num_days <= 60))),
  CONSTRAINT trips_settle_by_check CHECK ((settle_by = ANY (ARRAY['couples'::text, 'people'::text])))
);
-- FK trips_created_by_fkey: created_by -> auth.users(id), on user removal SET NULL
CREATE INDEX trips_created_by ON public.trips USING btree (created_by);

CREATE TABLE public.members (
  trip_id uuid not null,
  user_id uuid not null,
  display_name text not null,
  joined_at timestamp with time zone not null default now(),
  couple text,
  CONSTRAINT members_pkey PRIMARY KEY (trip_id, user_id)
);
-- FK members_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK members_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX members_user_idx ON public.members USING btree (user_id);

CREATE TABLE public.day_info (
  trip_id uuid not null,
  day integer not null,
  city text,
  hotel text,
  notes text,
  who text,
  CONSTRAINT day_info_pkey PRIMARY KEY (trip_id, day)
);
-- FK day_info_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal

CREATE TABLE public.bookings (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  kind text not null default 'other'::text,
  title text not null,
  starts_at timestamp with time zone,
  ends_at timestamp with time zone,
  confirmation text,
  location text,
  url text,
  notes text,
  file_path text,
  created_at timestamp with time zone not null default now(),
  who text,
  CONSTRAINT bookings_pkey PRIMARY KEY (id)
);
-- FK bookings_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
CREATE INDEX bookings_trip_idx ON public.bookings USING btree (trip_id);
CREATE UNIQUE INDEX bookings_same_confirmation_uniq ON public.bookings USING btree (trip_id, kind, starts_at, norm_name(confirmation)) WHERE (COALESCE(confirmation, ''::text) <> ''::text);
CREATE UNIQUE INDEX bookings_same_no_code_uniq ON public.bookings USING btree (trip_id, kind, norm_name(title), starts_at, COALESCE(who, ''::text)) WHERE (COALESCE(confirmation, ''::text) = ''::text);

CREATE TABLE public.itinerary_items (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  day integer not null,
  time text,
  title text not null,
  location text,
  notes text,
  category text not null default 'sight'::text,
  done boolean not null default false,
  sort integer not null default 0,
  created_at timestamp with time zone not null default now(),
  place_id uuid,
  who text,
  auto boolean not null default false,
  notes_en text,
  CONSTRAINT itinerary_items_pkey PRIMARY KEY (id)
);
-- FK itinerary_items_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK itinerary_items_place_id_fkey: place_id -> places(id), on place removal SET NULL
CREATE INDEX itinerary_items_place_id ON public.itinerary_items USING btree (place_id);
CREATE INDEX itinerary_trip_idx ON public.itinerary_items USING btree (trip_id, day);

CREATE TABLE public.places (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  city text,
  name text not null,
  category text not null default 'sight'::text,
  url text,
  notes text,
  visited boolean not null default false,
  added_by text,
  created_at timestamp with time zone not null default now(),
  candidate_id uuid,
  area text,
  lat double precision,
  lng double precision,
  verdict text,
  audience text,
  instagram_url text,
  tiktok_url text,
  photos text[] not null default '{}'::text[],
  who text,
  auto_planned boolean not null default false,
  CONSTRAINT places_pkey PRIMARY KEY (id),
  CONSTRAINT places_candidate_id_key UNIQUE (candidate_id),
  CONSTRAINT places_audience_check CHECK ((audience = ANY (ARRAY['baby'::text, 'adults'::text])))
);
-- FK places_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK places_candidate_id_fkey: candidate_id -> candidates(id), on candidate removal SET NULL
CREATE INDEX places_trip_idx ON public.places USING btree (trip_id);
CREATE UNIQUE INDEX places_trip_name_uniq ON public.places USING btree (trip_id, norm_name(name));

CREATE TABLE public.candidates (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  library_id uuid,
  name text not null,
  name_ja text,
  city text not null,
  area text,
  category text not null default 'sight'::text,
  lat double precision,
  lng double precision,
  coord_precision text,
  hype text,
  reality text,
  verdict text,
  tabelog_score numeric,
  google_score numeric,
  price text,
  tip text,
  sources text[] not null default '{}'::text[],
  added_by text,
  created_at timestamp with time zone not null default now(),
  audience text,
  baby_notes text,
  local_pick boolean not null default false,
  maps_url text,
  website_url text,
  instagram_url text,
  tiktok_url text,
  photos text[] not null default '{}'::text[],
  serves text,
  dishes text[],
  todo text,
  special text,
  highlights text[],
  time_needed text,
  kosher text,
  kosher_note text,
  opens text,
  closes text,
  closed_weekdays integer[],
  closed_dates date[],
  best_time text,
  visit_mins integer,
  booking text,
  plan_line text,
  baby_block text,
  facts_at date,
  facts_sure boolean,
  address text,
  en jsonb,
  open_dates date[] not null default '{}'::date[],
  tags text[] not null default '{}'::text[],
  CONSTRAINT candidates_pkey PRIMARY KEY (id),
  CONSTRAINT candidates_trip_id_library_id_key UNIQUE (trip_id, library_id),
  CONSTRAINT candidates_audience_check CHECK ((audience = ANY (ARRAY['baby'::text, 'adults'::text]))),
  CONSTRAINT candidates_kosher_check CHECK ((kosher = ANY (ARRAY['friendly'::text, 'options'::text, 'hard'::text])))
);
-- FK candidates_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK candidates_library_id_fkey: library_id -> place_library(id), on library card removal SET NULL
CREATE INDEX candidates_library_id ON public.candidates USING btree (library_id);
CREATE INDEX candidates_trip_idx ON public.candidates USING btree (trip_id);
CREATE UNIQUE INDEX candidates_trip_name_uniq ON public.candidates USING btree (trip_id, norm_name(name));

CREATE TABLE public.place_library (
  id uuid not null default gen_random_uuid(),
  name text not null,
  name_ja text,
  city text not null,
  area text,
  category text not null,
  lat double precision,
  lng double precision,
  coord_precision text,
  hype text,
  reality text,
  verdict text,
  tabelog_score numeric,
  google_score numeric,
  price text,
  tip text,
  sources text[] not null default '{}'::text[],
  created_at timestamp with time zone not null default now(),
  audience text,
  baby_notes text,
  active boolean not null default true,
  local_pick boolean not null default false,
  maps_url text,
  website_url text,
  instagram_url text,
  tiktok_url text,
  photos text[] not null default '{}'::text[],
  serves text,
  dishes text[],
  todo text,
  special text,
  highlights text[],
  time_needed text,
  kosher text,
  kosher_note text,
  opens text,
  closes text,
  closed_weekdays integer[],
  closed_dates date[],
  best_time text,
  visit_mins integer,
  booking text,
  plan_line text,
  baby_block text,
  facts_at date,
  facts_sure boolean,
  address text,
  en jsonb,
  open_dates date[] not null default '{}'::date[],
  tags text[] not null default '{}'::text[],
  CONSTRAINT place_library_pkey PRIMARY KEY (id),
  CONSTRAINT place_library_name_key UNIQUE (name),
  CONSTRAINT place_library_audience_check CHECK ((audience = ANY (ARRAY['baby'::text, 'adults'::text]))),
  CONSTRAINT place_library_kosher_check CHECK ((kosher = ANY (ARRAY['friendly'::text, 'options'::text, 'hard'::text])))
);

CREATE TABLE public.swipes (
  trip_id uuid not null,
  candidate_id uuid not null,
  user_id uuid not null,
  liked boolean not null,
  created_at timestamp with time zone not null default now(),
  CONSTRAINT swipes_pkey PRIMARY KEY (candidate_id, user_id)
);
-- FK swipes_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK swipes_candidate_id_fkey: candidate_id -> candidates(id), CASCADE on candidate removal
-- FK swipes_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX swipes_trip_idx ON public.swipes USING btree (trip_id);
CREATE INDEX swipes_user_id ON public.swipes USING btree (user_id);

CREATE TABLE public.place_ratings (
  library_id uuid not null,
  user_id uuid not null default auth.uid(),
  trip_id uuid not null,
  stars smallint not null,
  note text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT place_ratings_pkey PRIMARY KEY (library_id, user_id),
  CONSTRAINT place_ratings_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
  CONSTRAINT place_ratings_stars_check CHECK (((stars >= 1) AND (stars <= 5)))
);
-- FK place_ratings_library_id_fkey: library_id -> place_library(id), CASCADE on library card removal
-- FK place_ratings_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK place_ratings_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX place_ratings_trip ON public.place_ratings USING btree (trip_id);

CREATE TABLE public.invites (
  code text not null default upper(substr(md5((gen_random_uuid())::text), 1, 10)),
  trip_id uuid,
  created_by uuid not null default auth.uid(),
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null default (now() + '30 days'::interval),
  used_by uuid,
  used_at timestamp with time zone,
  CONSTRAINT invites_pkey PRIMARY KEY (code)
);
-- FK invites_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK invites_created_by_fkey: created_by -> auth.users(id), CASCADE on user removal
-- FK invites_used_by_fkey: used_by -> auth.users(id), on user removal SET NULL, DEFERRABLE INITIALLY DEFERRED

CREATE TABLE public.profiles (
  user_id uuid not null default auth.uid(),
  answers jsonb not null default '{}'::jsonb,
  completed_at timestamp with time zone,
  updated_at timestamp with time zone not null default now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (user_id)
);
-- FK profiles_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal

CREATE TABLE public.ai_usage (
  user_id uuid not null,
  fn text not null,
  at timestamp with time zone not null default now()
);
-- no primary key
-- FK ai_usage_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX ai_usage_user_fn_at ON public.ai_usage USING btree (user_id, fn, at);

CREATE TABLE public.ai_calls (
  id bigint not null,   -- no default shown by the catalog query (likely identity; not verified)
  at timestamp with time zone not null default now(),
  fn text not null,
  step text not null,
  user_id uuid,
  lookup_id uuid,
  model text,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_write_tokens integer not null default 0,
  web_searches integer not null default 0,
  cost_usd numeric(10,6) not null default 0,
  ms integer,
  stop_reason text,
  error text,
  CONSTRAINT ai_calls_pkey PRIMARY KEY (id)
);
-- FK ai_calls_user_id_fkey: user_id -> auth.users(id), on user removal SET NULL
CREATE INDEX ai_calls_at ON public.ai_calls USING btree (at DESC);

CREATE TABLE public.place_lookups (
  id uuid not null,
  user_id uuid not null,
  lookup_key text,
  status text not null default 'running'::text,
  places jsonb,
  error text,
  created_at timestamp with time zone not null default now(),
  finished_at timestamp with time zone,
  CONSTRAINT place_lookups_pkey PRIMARY KEY (id),
  CONSTRAINT place_lookups_status_check CHECK ((status = ANY (ARRAY['running'::text, 'done'::text, 'failed'::text])))
);
-- FK place_lookups_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX place_lookups_key ON public.place_lookups USING btree (lookup_key, finished_at DESC) WHERE (status = 'done'::text);

CREATE TABLE public.plan_state (
  trip_id uuid not null,
  lease_until timestamp with time zone,
  dirty boolean not null default false,
  ran_at timestamp with time zone,
  error text,
  summary jsonb,
  CONSTRAINT plan_state_pkey PRIMARY KEY (trip_id)
);
-- the catalog shows no FK on plan_state.trip_id

CREATE TABLE public.reports (
  id uuid not null default gen_random_uuid(),
  trip_id uuid not null,
  user_id uuid not null default auth.uid(),
  reporter text,
  body text not null,
  screen text,
  app_version text,
  device text,
  status text not null default 'open'::text,
  reply text,
  created_at timestamp with time zone not null default now(),
  resolved_at timestamp with time zone,
  CONSTRAINT reports_pkey PRIMARY KEY (id),
  CONSTRAINT reports_app_version_check CHECK ((char_length(app_version) <= 40)),
  CONSTRAINT reports_body_check CHECK (((char_length(btrim(body)) >= 1) AND (char_length(btrim(body)) <= 2000))),
  CONSTRAINT reports_device_check CHECK ((char_length(device) <= 300)),
  CONSTRAINT reports_screen_check CHECK ((char_length(screen) <= 100)),
  CONSTRAINT reports_status_check CHECK ((status = ANY (ARRAY['open'::text, 'fixed'::text, 'wontfix'::text])))
);
-- FK reports_trip_id_fkey: trip_id -> trips(id), CASCADE on trip removal
-- FK reports_user_id_fkey: user_id -> auth.users(id), CASCADE on user removal
CREATE INDEX reports_trip_created ON public.reports USING btree (trip_id, created_at DESC);


-- =====================================================================================
-- 3. ROW LEVEL SECURITY
--    Enabled (not forced) on: _plan_compare, ai_calls, ai_usage, bookings, candidates,
--    checklist_items, day_info, essentials, expenses, geo_cache, guide_places, invites,
--    itinerary_items, join_attempts, members, place_facts, place_library, place_lookups,
--    place_ratings, places, plan_state, profiles, reports, swipes, trips.
--    No policy at all (so only service_role / SECURITY DEFINER code can touch them):
--    _plan_compare, ai_calls, ai_usage, geo_cache, join_attempts.
--    Policy-less operations by design: no INSERT/DELETE on trips, members, plan_state,
--    place_library, place_lookups, guide_places (writes go through functions / service role).
-- =====================================================================================

ALTER TABLE public._plan_compare ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.day_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.essentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.geo_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guide_places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.itinerary_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.join_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_library ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.place_ratings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.places ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plan_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.swipes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trips ENABLE ROW LEVEL SECURITY;

-- Policies (31 in schema public), as stored by pg_policies (function calls shown unqualified)
create policy "bookings_all" on public.bookings as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "candidates_all" on public.candidates as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "checklist_items_all" on public.checklist_items as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "day_info_all" on public.day_info as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "essentials_all" on public.essentials as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "expenses_all" on public.expenses as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "guide_read" on public.guide_places as PERMISSIVE for SELECT to authenticated using (true);
create policy "invites_add" on public.invites as PERMISSIVE for INSERT to authenticated with check (((created_by = ( SELECT auth.uid() AS uid)) AND ((trip_id IS NULL) OR is_trip_member(trip_id)) AND (used_by IS NULL)));
create policy "invites_read" on public.invites as PERMISSIVE for SELECT to authenticated using ((created_by = ( SELECT auth.uid() AS uid)));
create policy "itinerary_items_all" on public.itinerary_items as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "members_select" on public.members as PERMISSIVE for SELECT to authenticated using (is_trip_member(trip_id));
create policy "members_update_self" on public.members as PERMISSIVE for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "signed in read facts" on public.place_facts as PERMISSIVE for SELECT to authenticated using (true);
create policy "place_library_read" on public.place_library as PERMISSIVE for SELECT to authenticated using (true);
create policy "place_lookups_own" on public.place_lookups as PERMISSIVE for SELECT to authenticated using ((user_id = auth.uid()));
create policy "place_ratings_add" on public.place_ratings as PERMISSIVE for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_trip_member(trip_id)));
create policy "place_ratings_change" on public.place_ratings as PERMISSIVE for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_trip_member(trip_id)));
create policy "place_ratings_read" on public.place_ratings as PERMISSIVE for SELECT to authenticated using (true);
create policy "places_all" on public.places as PERMISSIVE for ALL to authenticated using (is_trip_member(trip_id)) with check (is_trip_member(trip_id));
create policy "members read plan state" on public.plan_state as PERMISSIVE for SELECT to authenticated using (is_trip_member(trip_id));
create policy "profiles_add" on public.profiles as PERMISSIVE for INSERT to authenticated with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "profiles_change" on public.profiles as PERMISSIVE for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check ((user_id = ( SELECT auth.uid() AS uid)));
create policy "profiles_read" on public.profiles as PERMISSIVE for SELECT to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "reports_insert" on public.reports as PERMISSIVE for INSERT to authenticated with check (((user_id = auth.uid()) AND is_trip_member(trip_id)));
create policy "reports_select" on public.reports as PERMISSIVE for SELECT to authenticated using (is_trip_member(trip_id));
create policy "swipes_delete" on public.swipes as PERMISSIVE for DELETE to authenticated using ((user_id = ( SELECT auth.uid() AS uid)));
create policy "swipes_insert" on public.swipes as PERMISSIVE for INSERT to authenticated with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_trip_member(trip_id)));
create policy "swipes_select" on public.swipes as PERMISSIVE for SELECT to authenticated using (is_trip_member(trip_id));
create policy "swipes_update" on public.swipes as PERMISSIVE for UPDATE to authenticated using ((user_id = ( SELECT auth.uid() AS uid))) with check (((user_id = ( SELECT auth.uid() AS uid)) AND is_trip_member(trip_id)));
create policy "trips_select" on public.trips as PERMISSIVE for SELECT to authenticated using (is_trip_member(id));
create policy "trips_update" on public.trips as PERMISSIVE for UPDATE to authenticated using (is_trip_member(id)) with check (is_trip_member(id));

-- Column grants on public.trips (information_schema.column_privileges, roles anon and authenticated)
--   SELECT, INSERT, REFERENCES on every column (id, name, start_date, num_days, join_code,
--     created_by, created_at, match_threshold, ils_per_jpy, settle_by): anon and authenticated
--   UPDATE: authenticated only, on exactly: name, start_date, num_days, match_threshold, ils_per_jpy
--     (so join_code, created_by, created_at, id and settle_by are NOT updatable by clients)
--   anon has no UPDATE on any column.
-- Table-level privileges that information_schema also lists for anon and authenticated on trips:
--   anon: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--   authenticated: DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE
--   (RLS still blocks row access: trips has only select and update policies, and only for members.)
-- Reconstructed as statements (not run):
-- REVOKE UPDATE ON public.trips FROM authenticated;
-- GRANT UPDATE (name, start_date, num_days, match_threshold, ils_per_jpy) ON public.trips TO authenticated;


-- =====================================================================================
-- 4. TRIGGERS on public tables (all enabled, tgenabled = 'O')
--    pg_get_triggerdef output; function names are unqualified there, live they resolve to public.
-- =====================================================================================

CREATE TRIGGER bookings_replan AFTER INSERT OR UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION request_plan();
CREATE TRIGGER candidates_plan_facts BEFORE INSERT ON public.candidates FOR EACH ROW EXECUTE FUNCTION fill_plan_facts();
CREATE TRIGGER candidates_to_library BEFORE INSERT ON public.candidates FOR EACH ROW EXECUTE FUNCTION card_to_library();
CREATE TRIGGER card_needs_facts AFTER INSERT ON public.candidates FOR EACH ROW WHEN ((new.facts_at IS NULL)) EXECUTE FUNCTION request_card_facts();
CREATE TRIGGER card_needs_photos AFTER INSERT ON public.candidates FOR EACH ROW WHEN (((new.added_by IS DISTINCT FROM 'סקאוטים'::text) AND (COALESCE(cardinality(new.photos), 0) = 0))) EXECUTE FUNCTION request_card_photos();
CREATE TRIGGER expenses_people BEFORE INSERT OR UPDATE ON public.expenses FOR EACH ROW EXECUTE FUNCTION check_expense_people();
CREATE TRIGGER itinerary_item_address BEFORE INSERT OR UPDATE OF place_id ON public.itinerary_items FOR EACH ROW EXECUTE FUNCTION item_address();
CREATE TRIGGER itinerary_same_trip BEFORE INSERT OR UPDATE ON public.itinerary_items FOR EACH ROW EXECUTE FUNCTION check_same_trip();
CREATE TRIGGER itinerary_touched BEFORE UPDATE ON public.itinerary_items FOR EACH ROW EXECUTE FUNCTION plan_item_touched();
CREATE TRIGGER place_ratings_updated BEFORE UPDATE ON public.place_ratings FOR EACH ROW EXECUTE FUNCTION place_ratings_touch();
CREATE TRIGGER places_replan_new AFTER INSERT ON public.places FOR EACH ROW EXECUTE FUNCTION request_plan();
CREATE TRIGGER places_replan_who AFTER UPDATE ON public.places FOR EACH ROW WHEN (((old.who IS DISTINCT FROM new.who) OR (old.visited IS DISTINCT FROM new.visited))) EXECUTE FUNCTION request_plan();
CREATE TRIGGER places_same_trip BEFORE INSERT OR UPDATE ON public.places FOR EACH ROW EXECUTE FUNCTION check_same_trip();
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION place_ratings_touch();
CREATE TRIGGER swipes_match AFTER INSERT OR DELETE OR UPDATE ON public.swipes FOR EACH ROW EXECUTE FUNCTION on_swipe();
CREATE TRIGGER swipes_replan AFTER INSERT OR UPDATE ON public.swipes FOR EACH ROW EXECUTE FUNCTION request_plan();
CREATE TRIGGER swipes_same_trip BEFORE INSERT OR UPDATE ON public.swipes FOR EACH ROW EXECUTE FUNCTION check_same_trip();

-- Trigger on auth.users (not a public table, listed for completeness; it calls public.block_new_users)
-- CREATE TRIGGER block_new_users BEFORE INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION block_new_users();


-- =====================================================================================
-- 5. REALTIME
-- =====================================================================================
-- supabase_realtime publication tables (11):
--   public.bookings, public.candidates, public.checklist_items, public.day_info, public.essentials,
--   public.expenses, public.itinerary_items, public.members, public.places, public.swipes, public.trips
