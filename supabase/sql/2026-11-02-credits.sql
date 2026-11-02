-- AI credits (roadmap P3). NOT applied yet: run in a branch database first, then run 2026-11-02-credits-test.sql.
-- No payments here. The ledger only ever gets rows added; the balance is the sum of its deltas.
-- Writes happen only through the security definer functions below (no insert/update policy exists).

create table if not exists public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  owner_kind text not null check (owner_kind in ('user', 'trip')),
  owner_id uuid not null,
  delta int not null,
  reason text not null,
  fn text,
  op_id text not null unique,
  state text not null check (state in ('reserved', 'settled', 'refunded', 'grant')),
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_owner on public.credit_ledger (owner_kind, owner_id);

alter table public.credit_ledger enable row level security;

create policy credit_ledger_select on public.credit_ledger for select to authenticated
  using (
    (owner_kind = 'user' and owner_id = (select auth.uid()))
    or (owner_kind = 'trip' and public.is_trip_member(owner_id))
  );

create or replace view public.credit_balance with (security_invoker = true) as
  select owner_kind, owner_id, sum(delta)::int as balance
  from public.credit_ledger
  group by owner_kind, owner_id;
grant select on public.credit_balance to authenticated;

-- Price of one operation, in credits. 1 credit is about 0.01 USD of list cost.
-- Derived read-only from ai_calls (successful calls only) on 2026-11-02:
--   select fn, count(distinct lookup_id) lookups, round(sum(cost_usd)::numeric,5) total,
--          round((sum(cost_usd)/greatest(count(distinct lookup_id),1))::numeric,5) per_lookup,
--          round(avg(cost_usd)::numeric,5) per_call
--   from ai_calls where error is null group by fn order by fn;
-- suggest-place: 14 lookups, 35 calls, 0.45309 USD -> 0.0324 per lookup -> 4 credits (adds ~25% margin).
-- translate: 1 call, 0.00012 USD (one sample) -> 1 credit, the smallest unit; far above its cost on purpose.
-- parse-booking: no rows in ai_calls yet; one Haiku call with a document, estimated under 0.01 USD -> 1 credit.
-- plan-trip (0.0056 per call, 288 calls), card-photos and card-facts are system work and not charged.
-- Re-measure when ai_calls has more rows, then change these numbers.
create table if not exists public.credit_prices (
  fn text primary key,
  cost int not null check (cost >= 0)
);
alter table public.credit_prices enable row level security;
create policy credit_prices_read on public.credit_prices for select to authenticated using (true);
grant select on public.credit_prices to authenticated;
insert into public.credit_prices (fn, cost) values ('suggest-place', 4), ('parse-booking', 1), ('translate', 1)
  on conflict (fn) do update set cost = excluded.cost;

-- Free credits: each user is topped up to 5 once per day (no hoarding), idempotent per day.
create or replace function public.grant_daily_free(p_user uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  daily constant int := 5;
  have int;
  op text := 'daily:' || p_user::text || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD');
begin
  perform pg_advisory_xact_lock(hashtextextended('user:' || p_user::text, 0));
  select coalesce(sum(delta), 0) into have from public.credit_ledger where owner_kind = 'user' and owner_id = p_user;
  if have < daily then
    insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
    values ('user', p_user, daily - have, 'daily free', op, 'grant')
    on conflict (op_id) do nothing;
  end if;
  return (select coalesce(sum(delta), 0) from public.credit_ledger where owner_kind = 'user' and owner_id = p_user)::int;
end $$;

-- Holds p_cost credits for one operation: from the trip wallet if it covers the cost, otherwise from the caller's own
-- (free daily credits included). The same p_op_id again returns the existing hold and charges nothing more.
-- Never negative: refuses (ok=false, needs_credits=true) when neither wallet covers it.
-- Locks are always taken user first, then trip, so two calls cannot wait on each other.
create or replace function public.reserve_credits(p_op_id text, p_user uuid, p_trip uuid, p_fn text, p_cost int)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  existing public.credit_ledger;
  trip_ok boolean := false;
  tb int := 0;
  ub int;
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
  select coalesce(sum(delta), 0) into ub from public.credit_ledger where owner_kind = 'user' and owner_id = p_user;
  if ub >= p_cost then
    insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
    values ('user', p_user, -p_cost, 'ai', p_fn, p_op_id, 'reserved');
    return jsonb_build_object('ok', true, 'repeat', false, 'state', 'reserved', 'owner_kind', 'user', 'owner_id', p_user,
      'cost', p_cost, 'balance', ub - p_cost);
  end if;
  return jsonb_build_object('ok', false, 'needs_credits', true, 'cost', p_cost, 'balance', ub, 'trip_balance', tb);
end $$;

-- The operation succeeded: the hold becomes a charge. Only a reserved hold can settle.
create or replace function public.settle_credits(p_op_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  update public.credit_ledger set state = 'settled' where op_id = p_op_id and state = 'reserved';
  get diagnostics n = row_count;
  return n > 0;
end $$;

-- The operation failed: a +cost row gives the credits back (the original row stays as the record). Once only.
create or replace function public.refund_credits(p_op_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.credit_ledger;
begin
  select * into r from public.credit_ledger where op_id = p_op_id;
  if not found then return false; end if;
  perform pg_advisory_xact_lock(hashtextextended(r.owner_kind || ':' || r.owner_id::text, 0));
  update public.credit_ledger set state = 'refunded' where id = r.id and state = 'reserved';
  if not found then return false; end if;
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, fn, op_id, state)
  values (r.owner_kind, r.owner_id, -r.delta, 'refund', r.fn, p_op_id || ':refund', 'refunded')
  on conflict (op_id) do nothing;
  return true;
end $$;

-- The caller moves some of their own credits to a trip they belong to. Their consent only; never below zero.
create or replace function public.give_to_trip(p_trip uuid, p_amount int, p_op_id text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  op text := coalesce(p_op_id, gen_random_uuid()::text);
  ub int;
begin
  if me is null then raise exception 'not signed in'; end if;
  if p_amount is null or p_amount < 1 then raise exception 'amount must be positive'; end if;
  if not exists (select 1 from public.members m where m.trip_id = p_trip and m.user_id = me) then
    raise exception 'not a trip member';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('user:' || me::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('trip:' || p_trip::text, 0));
  if exists (select 1 from public.credit_ledger where op_id = 'gift:' || op || ':out') then
    return jsonb_build_object('ok', true, 'repeat', true);
  end if;
  select coalesce(sum(delta), 0) into ub from public.credit_ledger where owner_kind = 'user' and owner_id = me;
  if ub < p_amount then return jsonb_build_object('ok', false, 'balance', ub); end if;
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('user', me, -p_amount, 'given to trip', 'gift:' || op || ':out', 'grant'),
         ('trip', p_trip, p_amount, 'given by member', 'gift:' || op || ':in', 'grant');
  return jsonb_build_object('ok', true, 'repeat', false, 'balance', ub - p_amount);
end $$;

-- What the wallet screen shows: the caller's own balance (after today's free top-up) and the trip's.
create or replace function public.my_credits(p_trip uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); ub int; tb int := null;
begin
  if me is null then raise exception 'not signed in'; end if;
  ub := public.grant_daily_free(me);
  if p_trip is not null and exists (select 1 from public.members m where m.trip_id = p_trip and m.user_id = me) then
    select coalesce(sum(delta), 0) into tb from public.credit_ledger where owner_kind = 'trip' and owner_id = p_trip;
  end if;
  return jsonb_build_object('balance', ub, 'trip_balance', tb);
end $$;

-- Who may call what
revoke all on function public.grant_daily_free(uuid) from public, anon, authenticated;
revoke all on function public.reserve_credits(text, uuid, uuid, text, int) from public, anon, authenticated;
revoke all on function public.settle_credits(text) from public, anon, authenticated;
revoke all on function public.refund_credits(text) from public, anon, authenticated;
revoke all on function public.give_to_trip(uuid, int, text) from public, anon;
revoke all on function public.my_credits(uuid) from public, anon;
grant execute on function public.grant_daily_free(uuid) to service_role;
grant execute on function public.reserve_credits(text, uuid, uuid, text, int) to service_role;
grant execute on function public.settle_credits(text) to service_role;
grant execute on function public.refund_credits(text) to service_role;
grant execute on function public.give_to_trip(uuid, int, text) to authenticated;
grant execute on function public.my_credits(uuid) to authenticated;
