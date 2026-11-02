-- Test for 2026-11-02-credits.sql. Run in a BRANCH database only, as the postgres role (SQL editor).
-- Everything happens in one transaction that ends with rollback, so nothing stays. Any failed check raises an error.
begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  r jsonb;
  bal int;
  n int;
begin
  insert into auth.users (id, aud, role, email) values
    (u1, 'authenticated', 'authenticated', 'credits-u1@example.test'),
    (u2, 'authenticated', 'authenticated', 'credits-u2@example.test');
  insert into public.trips (id, name, join_code, created_by) values (t1, 'credits test', 'CRTEST' || left(t1::text, 4), u1);
  insert into public.members (trip_id, user_id, display_name) values (t1, u1, 'u1'), (t1, u2, 'u2');

  -- 1. the free daily top-up is 5, and asking again the same day adds nothing
  perform public.grant_daily_free(u1);
  perform public.grant_daily_free(u1);
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 5, 'free daily should leave 5, got ' || coalesce(bal::text, 'null');

  -- 2. never negative: a cost above the balance is refused and nothing is written
  r := public.reserve_credits('t-big', u1, null, 'suggest-place', 6);
  assert (r->>'ok')::boolean = false and (r->>'needs_credits')::boolean, 'cost 6 on balance 5 should be refused';
  select count(*) into n from public.credit_ledger where op_id = 't-big';
  assert n = 0, 'a refused reserve wrote a row';

  -- 3. same op_id twice charges once
  r := public.reserve_credits('t-once', u1, null, 'suggest-place', 4);
  assert (r->>'ok')::boolean and (r->>'repeat')::boolean = false, 'first reserve should work';
  r := public.reserve_credits('t-once', u1, null, 'suggest-place', 4);
  assert (r->>'ok')::boolean and (r->>'repeat')::boolean, 'second reserve should be a repeat';
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 1, 'two reserves of one op should charge once, balance ' || bal;

  -- 4. the balance stays at or above zero when the next one does not fit
  r := public.reserve_credits('t-over', u1, null, 'suggest-place', 4);
  assert (r->>'ok')::boolean = false, 'cost 4 on balance 1 should be refused';

  -- 5. settle keeps the charge; a refund after settle does nothing
  assert public.settle_credits('t-once'), 'settle should work on a reserved hold';
  assert not public.refund_credits('t-once'), 'a settled op must not refund';
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 1, 'settled charge should stay, balance ' || bal;

  -- 6. refund restores, and only once
  r := public.reserve_credits('t-fail', u1, null, 'translate', 1);
  assert (r->>'ok')::boolean, 'reserve of 1 should work';
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 0, 'after reserving 1 balance should be 0, got ' || bal;
  assert public.refund_credits('t-fail'), 'first refund should work';
  assert not public.refund_credits('t-fail'), 'second refund should do nothing';
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 1, 'refund should restore the credit once, balance ' || bal;
  assert not public.settle_credits('t-fail'), 'a refunded op cannot settle';

  -- 7. trip wallet is used first (test grants stand in for a gift and a purchase)
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('trip', t1, 3, 'test grant', 't-trip-grant', 'grant'),
         ('user', u1, 4, 'test grant', 't-user-grant', 'grant');   -- u1 now holds 5, the trip 3
  r := public.reserve_credits('t-trip-first', u1, t1, 'translate', 2);
  assert r->>'owner_kind' = 'trip', 'trip wallet should pay first, got ' || coalesce(r->>'owner_kind', 'null');
  select balance into bal from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert bal = 1, 'trip should be left with 1, got ' || bal;
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 5, 'personal wallet should be untouched, got ' || bal;

  -- 8. when the trip cannot cover it, the caller's own wallet pays
  r := public.reserve_credits('t-then-own', u1, t1, 'suggest-place', 4);
  assert r->>'owner_kind' = 'user', 'personal wallet should pay when the trip is short';
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 1, 'personal should be left with 1, got ' || bal;

  -- 9. someone outside the trip cannot spend its wallet
  r := public.reserve_credits('t-outsider', gen_random_uuid(), t1, 'translate', 1);
  assert (r->>'ok')::boolean = false, 'a non-member must not use the trip wallet';

  -- 10. give_to_trip: as u1 (authenticated), only the caller's own credits move; never below zero
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.give_to_trip(t1, 1);
  assert (r->>'ok')::boolean, 'giving 1 of 1 should work';
  r := public.give_to_trip(t1, 1);
  assert (r->>'ok')::boolean = false, 'giving from an empty wallet should be refused';
  reset role;
  select balance into bal from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert bal = 0, 'personal should be 0 after the gift, got ' || bal;
  select balance into bal from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert bal = 2, 'trip should be 2 after the gift, got ' || bal;

  -- 11. nothing in the ledger ever went below zero
  select count(*) into n from (
    select owner_kind, owner_id from public.credit_ledger group by 1, 2 having sum(delta) < 0
  ) x;
  assert n = 0, 'a wallet went negative';

  -- 12. a signed-in client cannot write the ledger or call reserve directly
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
    values ('user', u1, 100, 'cheat', 't-cheat', 'grant');
    raise exception 'client insert should have been refused';
  exception when insufficient_privilege or others then
    if sqlerrm like 'client insert%' then raise; end if;
  end;
  begin
    perform public.reserve_credits('t-direct', u1, null, 'translate', 1);
    raise exception 'client reserve should have been refused';
  exception when insufficient_privilege or others then
    if sqlerrm like 'client reserve%' then raise; end if;
  end;
  reset role;

  raise notice 'all credit checks passed';
end $$;

rollback;
