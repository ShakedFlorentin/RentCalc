-- Credits fixes after review (roadmap P3). The credits system is already applied; this file only replaces functions
-- (same signatures, so their grants stay) and adds the app_flags switch. Safe to run again. 2026-11-02-credits.sql
-- holds the same final text, so it stays the source of truth for a fresh database. Run 2026-11-02-credits-test.sql after.
--  - app_flags('credits'): the one switch for showing and charging credits (off). my_credits writes nothing while off.
--  - reserve_credits / my_credits: the unlimited exemption is for the trip's creator only (trips.created_by).
--  - refund_credits: a free-credit hold is given back after midnight too, capped so the free wallet never exceeds 5.
--  - my_credits also returns enabled / unlimited for the wallet.

-- Switches the app reads. 'credits' = whether AI credits are charged and shown. The edge functions use the same flag
-- (the env CREDITS_ON overrides it when set), so one switch controls both. Turn on with:
--   update public.app_flags set enabled = true where key = 'credits';
create table if not exists public.app_flags (
  key text primary key,
  enabled boolean not null default false
);
alter table public.app_flags enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_flags' and policyname = 'app_flags_read') then
    create policy app_flags_read on public.app_flags for select to authenticated using (true);
  end if;
end $$;
grant select on public.app_flags to authenticated;
insert into public.app_flags (key, enabled) values ('credits', false) on conflict (key) do nothing;

create or replace function public.reserve_credits(p_op_id text, p_user uuid, p_trip uuid, p_fn text, p_cost int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.credit_ledger;
  trip_ok boolean := false;
  tb int := 0;
  fb int;
  ub int;
  from_free int;
  from_paid int;
begin
  if p_cost is null or p_cost < 0 then raise exception 'bad cost'; end if;
  perform pg_advisory_xact_lock(hashtextextended('user:' || p_user::text, 0));
  if p_trip is not null then
    select exists (select 1 from public.members m where m.trip_id = p_trip and m.user_id = p_user) into trip_ok;
    if trip_ok then perform pg_advisory_xact_lock(hashtextextended('trip:' || p_trip::text, 0)); end if;
  end if;

  select * into existing from public.credit_ledger where op_id = p_op_id;
  if found then
    return jsonb_build_object('ok', true, 'repeat', true, 'state', existing.state, 'owner_kind', existing.owner_kind,
      'owner_id', existing.owner_id, 'cost', abs(existing.delta));
  end if;

  -- the owner's own trips are never charged, and only when the owner (the trip's creator) asks: other members pay as
  -- usual. A zero row keeps op_id, settle and refund working as usual
  if trip_ok and exists (select 1 from public.credit_unlimited_trips u where u.trip_id = p_trip)
     and exists (select 1 from public.trips t where t.id = p_trip and t.created_by = p_user) then
    insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
    values ('trip', p_trip, 0, 'unlimited trip', p_fn, p_op_id, 'reserved');
    return jsonb_build_object('ok', true, 'repeat', false, 'state', 'reserved', 'owner_kind', 'trip', 'owner_id', p_trip,
      'cost', 0, 'unlimited', true);
  end if;

  perform public.grant_daily_free(p_user);
  if trip_ok then
    select coalesce(sum(delta), 0) into tb from public.credit_ledger where owner_kind = 'trip' and owner_id = p_trip;
    if tb >= p_cost then
      insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
      values ('trip', p_trip, -p_cost, 'ai', p_fn, p_op_id, 'reserved');
      return jsonb_build_object('ok', true, 'repeat', false, 'state', 'reserved', 'owner_kind', 'trip', 'owner_id', p_trip,
        'cost', p_cost, 'balance', tb - p_cost);
    end if;
  end if;
  select coalesce(sum(delta), 0) into fb from public.credit_ledger where owner_kind = 'free' and owner_id = p_user;
  select coalesce(sum(delta), 0) into ub from public.credit_ledger where owner_kind = 'user' and owner_id = p_user;
  if fb + ub >= p_cost then
    from_free := least(fb, p_cost);
    from_paid := p_cost - from_free;
    if from_free > 0 then
      insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
      values ('free', p_user, -from_free, 'ai', p_fn, p_op_id, 'reserved');
    end if;
    if from_paid > 0 or from_free = 0 then
      insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
      values ('user', p_user, -from_paid, 'ai', p_fn, case when from_free > 0 then p_op_id || ':b' else p_op_id end, 'reserved');
    end if;
    return jsonb_build_object('ok', true, 'repeat', false, 'state', 'reserved', 'owner_kind', 'user', 'owner_id', p_user,
      'cost', p_cost, 'balance', fb + ub - p_cost);
  end if;
  return jsonb_build_object('ok', false, 'needs_credits', true, 'cost', p_cost, 'balance', fb + ub, 'trip_balance', tb);
end $$;

-- The operation failed: +cost rows give the credits back (the original rows stay as the record). Once only.
-- Free credit is given back even after midnight, but only up to the cap: the free wallet never holds more than 5, so
-- the refund is min(held, 5 - current free).
create or replace function public.refund_credits(p_op_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.credit_ledger; any_done boolean := false; amt int; cur int;
begin
  for r in select * from public.credit_ledger where op_id in (p_op_id, p_op_id || ':b') and state = 'reserved' order by op_id loop
    perform pg_advisory_xact_lock(hashtextextended(case when r.owner_kind = 'trip' then 'trip:' else 'user:' end || r.owner_id::text, 0));
    update public.credit_ledger set state = 'refunded' where id = r.id and state = 'reserved';
    if found then
      any_done := true;
      amt := -r.delta;
      if r.owner_kind = 'free' then
        select coalesce(sum(delta), 0) into cur from public.credit_ledger where owner_kind = 'free' and owner_id = r.owner_id;
        amt := least(amt, greatest(5 - cur, 0));
      end if;
      if amt > 0 then
        insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
        values (r.owner_kind, r.owner_id, amt, 'refund', r.fn, r.op_id || ':refund', 'refunded')
        on conflict (op_id) do nothing;
      end if;
    end if;
  end loop;
  return any_done;
end $$;

-- What the wallet screen shows. {enabled:false} (and nothing written) while credits are off. For the creator of an
-- unlimited trip: {enabled:true, unlimited:true} (nothing written). Otherwise balance = free + paid (after today's free
-- top-up), the free part, the paid part (the only part that can be given), and the trip's balance.
create or replace function public.my_credits(p_trip uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); fb int; ub int; tb int := null; member boolean := false;
begin
  if me is null then raise exception 'not signed in'; end if;
  if not coalesce((select f.enabled from public.app_flags f where f.key = 'credits'), false) then
    return jsonb_build_object('enabled', false);
  end if;
  if p_trip is not null then
    select exists (select 1 from public.members m where m.trip_id = p_trip and m.user_id = me) into member;
  end if;
  if member and exists (select 1 from public.credit_unlimited_trips u where u.trip_id = p_trip)
     and exists (select 1 from public.trips t where t.id = p_trip and t.created_by = me) then
    return jsonb_build_object('enabled', true, 'unlimited', true);
  end if;
  fb := public.grant_daily_free(me);
  select coalesce(sum(delta), 0) into ub from public.credit_ledger where owner_kind = 'user' and owner_id = me;
  if member then
    select coalesce(sum(delta), 0) into tb from public.credit_ledger where owner_kind = 'trip' and owner_id = p_trip;
  end if;
  return jsonb_build_object('enabled', true, 'unlimited', false, 'balance', fb + ub, 'free', fb, 'paid', ub, 'trip_balance', tb);
end $$;

