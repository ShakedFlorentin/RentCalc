-- Pork and seafood badge and note only for trips where someone avoids pork or seafood.
-- True when nobody in the trip has finished the questionnaire (unknown = shown), or any member who did has pork,
-- seafood or fish among the things they don't eat (an old "fish" meant fish and seafood), or an old kosher answer
-- of 'prefer' or 'only'. profiles are readable only by their owner, so the app asks this function (members only).

CREATE OR REPLACE FUNCTION public.trip_avoids_pork_seafood(tid uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not exists (select 1 from public.members m where m.trip_id = tid and m.user_id = auth.uid()) then
    return false;
  end if;
  return not exists (
           select 1 from public.members m join public.profiles p on p.user_id = m.user_id
            where m.trip_id = tid and p.completed_at is not null)
      or exists (
           select 1 from public.members m join public.profiles p on p.user_id = m.user_id
            where m.trip_id = tid and p.completed_at is not null
              and (    (jsonb_typeof(p.answers -> 'never') = 'array' and p.answers -> 'never' ?| array['pork', 'seafood', 'fish'])
                    or p.answers ->> 'kosher' in ('prefer', 'only')));
end
$function$;
revoke all on function public.trip_avoids_pork_seafood(uuid) from public, anon;
grant execute on function public.trip_avoids_pork_seafood(uuid) to authenticated;
