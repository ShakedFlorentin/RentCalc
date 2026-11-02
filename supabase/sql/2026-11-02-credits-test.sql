-- Test for 2026-11-02-credits.sql. Run in a BRANCH database only, as the postgres role (SQL editor).
-- Everything happens in one transaction that ends with rollback, so nothing stays. Any failed check raises an error.
-- Wallets: 'free' = daily free credit (not transferable), 'user' = paid/earned credit, 'trip' = the trip's wallet.
begin;

do $$
declare
  u1 uuid := gen_random_uuid();
  u2 uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  r jsonb;
  n int;
  u3 uuid := gen_random_uuid();
  u4 uuid := gen_random_uuid();
  fb int; ub int; tb int;
begin
  insert into auth.users (id, aud, role, email) values
    (u1, 'authenticated', 'authenticated', 'credits-u1@example.test'),
    (u2, 'authenticated', 'authenticated', 'credits-u2@example.test'),
    (u3, 'authenticated', 'authenticated', 'credits-u3@example.test'),
    (u4, 'authenticated', 'authenticated', 'credits-u4@example.test');
  insert into public.trips (id, name, join_code, created_by) values (t1, 'credits test', 'CRTEST' || left(t1::text, 4), u1);
  insert into public.members (trip_id, user_id, display_name) values (t1, u1, 'u1'), (t1, u2, 'u2');

  -- 1. the free daily top-up is 5 in the free wallet, and asking again the same day adds nothing
  perform public.grant_daily_free(u1);
  perform public.grant_daily_free(u1);
  select coalesce(sum(balance), 0) into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select coalesce(sum(balance), 0) into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert fb = 5 and ub = 0, 'free should be 5 and paid 0, got ' || fb || '/' || ub;

  -- 2. free credit cannot be given to a trip (only free credits: refused, nothing moves)
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.give_to_trip(t1, 1);
  reset role;
  assert (r->>'ok')::boolean = false, 'give_to_trip with only free credits must be refused';
  select coalesce(sum(balance), 0) into tb from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert tb = 0, 'trip wallet must stay empty, got ' || tb;
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  assert fb = 5, 'free credits must stay with the user, got ' || fb;

  -- 3. never negative: a cost above free + paid is refused and nothing is written
  r := public.reserve_credits('t-big', u1, null, 'suggest-place', 6);
  assert (r->>'ok')::boolean = false and (r->>'needs_credits')::boolean, 'cost 6 on balance 5 should be refused';
  select count(*) into n from public.credit_ledger where op_id like 't-big%';
  assert n = 0, 'a refused reserve wrote a row';

  -- 4. same op_id twice charges once (free: 5 -> 1)
  r := public.reserve_credits('t-once', u1, null, 'suggest-place', 4);
  assert (r->>'ok')::boolean and (r->>'repeat')::boolean = false, 'first reserve should work';
  r := public.reserve_credits('t-once', u1, null, 'suggest-place', 4);
  assert (r->>'ok')::boolean and (r->>'repeat')::boolean, 'second reserve should be a repeat';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  assert fb = 1, 'two reserves of one op should charge once, free ' || fb;

  -- 5. settle keeps the charge; a refund after settle does nothing
  assert public.settle_credits('t-once'), 'settle should work on a reserved hold';
  assert not public.refund_credits('t-once'), 'a settled op must not refund';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  assert fb = 1, 'settled charge should stay, free ' || fb;

  -- 6. free is spent before paid, split across the two; a refund restores both parts, once
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('user', u1, 3, 'test purchase', 't-paid-1', 'grant');   -- paid 3, free 1
  r := public.reserve_credits('t-split', u1, null, 'suggest-place', 3);
  assert (r->>'ok')::boolean, 'split reserve should work';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert fb = 0 and ub = 1, 'free should go first: expected 0/1, got ' || fb || '/' || ub;
  assert public.refund_credits('t-split'), 'refund of a split hold should work';
  assert not public.refund_credits('t-split'), 'second refund should do nothing';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert fb = 1 and ub = 3, 'refund should restore free and paid, got ' || fb || '/' || ub;
  assert not public.settle_credits('t-split'), 'a refunded op cannot settle';

  -- 7. trip wallet is used first, and then free and paid are untouched
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('trip', t1, 3, 'test grant', 't-trip-grant', 'grant');
  r := public.reserve_credits('t-trip-first', u1, t1, 'translate', 2);
  assert r->>'owner_kind' = 'trip', 'trip wallet should pay first, got ' || coalesce(r->>'owner_kind', 'null');
  select balance into tb from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert tb = 1, 'trip should be left with 1, got ' || tb;
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert fb = 1 and ub = 3, 'personal wallets should be untouched, got ' || fb || '/' || ub;

  -- 8. trip short (1 < 4): the caller pays, free first (1) then paid (3), never part from the trip
  r := public.reserve_credits('t-then-own', u1, t1, 'suggest-place', 4);
  assert r->>'owner_kind' = 'user', 'the caller should pay when the trip is short';
  select balance into tb from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert tb = 1, 'trip must not be split into, got ' || tb;
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  assert fb = 0 and ub = 0, 'free then paid should be spent, got ' || fb || '/' || ub;

  -- 9. someone outside the trip cannot spend its wallet
  r := public.reserve_credits('t-outsider', gen_random_uuid(), t1, 'translate', 6);
  assert (r->>'ok')::boolean = false, 'a non-member must not use the trip wallet';

  -- 10. give_to_trip moves only paid credit, only the caller's own, never below zero
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('user', u1, 1, 'test purchase', 't-paid-2', 'grant'),
         ('free', u1, 4, 'test free', 't-free-extra', 'grant');   -- paid 1, free 4
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.give_to_trip(t1, 2);
  assert (r->>'ok')::boolean = false, 'giving 2 with 1 paid (and 4 free) should be refused';
  r := public.give_to_trip(t1, 1);
  assert (r->>'ok')::boolean, 'giving the 1 paid credit should work';
  reset role;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u1;
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u1;
  select balance into tb from public.credit_balance where owner_kind = 'trip' and owner_id = t1;
  assert ub = 0 and fb = 4 and tb = 2, 'expected paid 0, free 4, trip 2, got ' || ub || '/' || fb || '/' || tb;

  -- 11. no wallet ever went below zero
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

  -- 13. giving with the same op id twice (a double tap) moves credits once
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('user', u2, 5, 'test purchase', 't-paid-u2', 'grant');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  set local role authenticated;
  r := public.give_to_trip(t1, 2, 'tap-1');
  assert (r->>'ok')::boolean and not (r->>'repeat')::boolean, 'first give should work';
  r := public.give_to_trip(t1, 2, 'tap-1');
  assert (r->>'ok')::boolean and (r->>'repeat')::boolean, 'second give with the same op id should be a repeat';
  reset role;
  select balance into ub from public.credit_balance where owner_kind = 'user' and owner_id = u2;
  assert ub = 3, 'a double tap should move 2 once (paid 3 left), got ' || ub;

  -- 14. a free hold made on an earlier day is given back after midnight, but the free wallet never exceeds 5
  perform public.grant_daily_free(u3);                                        -- free 5
  r := public.reserve_credits('t-old-free', u3, null, 'suggest-place', 4);    -- free 1
  update public.credit_ledger set created_at = now() - interval '1 day' where op_id = 't-old-free';
  assert public.refund_credits('t-old-free'), 'refund of an old free hold should work';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u3;
  assert fb = 5, 'an old free hold should be given back in full, got ' || fb;
  r := public.reserve_credits('t-old-free-2', u3, null, 'suggest-place', 4);  -- free 1
  insert into public.credit_ledger (owner_kind, owner_id, delta, reason, op_id, state)
  values ('free', u3, 3, 'test free', 't-free-top', 'grant');                 -- free 4
  update public.credit_ledger set created_at = now() - interval '1 day' where op_id = 't-old-free-2';
  assert public.refund_credits('t-old-free-2'), 'second old refund should work';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u3;
  assert fb = 5, 'the refund must stop at the cap of 5, got ' || fb;

  -- 15. the unlimited exemption is for the trip's creator (u1) only; another member (u2) is charged
  insert into public.credit_unlimited_trips (trip_id, note) values (t1, 'test');
  r := public.reserve_credits('t-unl-creator', u1, t1, 'suggest-place', 4);
  assert (r->>'unlimited')::boolean and (r->>'cost')::int = 0, 'the creator should not be charged on an unlimited trip';
  r := public.reserve_credits('t-unl-member', u2, t1, 'suggest-place', 4);
  assert (r->>'ok')::boolean and r->>'unlimited' is null and (r->>'cost')::int = 4, 'a member who is not the creator must be charged';
  select balance into fb from public.credit_balance where owner_kind = 'free' and owner_id = u2;
  assert fb = 1, 'the member should have paid 4 from free 5, got ' || fb;

  -- 16. my_credits: nothing is written while the flag is off; unlimited shows for the creator only
  update public.app_flags set enabled = false where key = 'credits';
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  r := public.my_credits(null);
  assert (r->>'enabled')::boolean = false, 'wallet should report credits off';
  select count(*) into n from public.credit_ledger where owner_id = u4;
  assert n = 0, 'opening the wallet with credits off wrote a ledger row';
  update public.app_flags set enabled = true where key = 'credits';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  r := public.my_credits(t1);
  assert (r->>'unlimited')::boolean, 'the creator should see unlimited';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.my_credits(t1);
  assert not (r->>'unlimited')::boolean and (r->>'enabled')::boolean, 'another member should see balances, not unlimited';

  raise notice 'all credit checks passed';
end $$;

rollback;
