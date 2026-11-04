-- Travellers can send their own photo of a place. It stays private until an app admin approves it; the review-photo
-- function then copies it to the public card-photos bucket and adds it to the card.
create table if not exists public.app_admins (user_id uuid primary key references auth.users on delete cascade);
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;

create or replace function public.is_app_admin() returns boolean
language sql stable security definer set search_path to '' as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid())
$$;
revoke execute on function public.is_app_admin() from public, anon;
grant execute on function public.is_app_admin() to authenticated;

-- the first admin: whoever created the first trip
insert into public.app_admins(user_id)
select created_by from public.trips where created_by is not null order by created_at limit 1
on conflict do nothing;

create table if not exists public.photo_submissions (
  id uuid primary key default gen_random_uuid(),
  library_id uuid not null references public.place_library on delete cascade,
  trip_id uuid not null references public.trips on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  path text not null unique,
  rights_confirmed boolean not null check (rights_confirmed),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  public_url text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users on delete set null
);
create index if not exists photo_submissions_pending on public.photo_submissions (created_at) where status = 'pending';
alter table public.photo_submissions enable row level security;
revoke all on public.photo_submissions from anon, authenticated;
grant select, insert on public.photo_submissions to authenticated;

-- a function, because a policy that reads its own table recurses
create or replace function public.my_pending_photos() returns bigint
language sql stable security definer set search_path to '' as $$
  select count(*) from public.photo_submissions p where p.user_id = auth.uid() and p.status = 'pending'
$$;
revoke execute on function public.my_pending_photos() from public, anon;
grant execute on function public.my_pending_photos() to authenticated;

create policy photo_submissions_read on public.photo_submissions for select to authenticated
  using (user_id = (select auth.uid()) or public.is_app_admin());
-- a member, for a place on their trip, in their own folder, nothing pre-approved, at most 20 waiting at a time
create policy photo_submissions_add on public.photo_submissions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_trip_member(trip_id)
    and status = 'pending' and public_url is null and reviewed_at is null and reviewed_by is null
    and path like trip_id::text || '/' || (select auth.uid())::text || '/%'
    and exists (select 1 from public.candidates c where c.trip_id = photo_submissions.trip_id and c.library_id = photo_submissions.library_id)
    and public.my_pending_photos() < 20
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photo-submissions', 'photo-submissions', false, 6291456, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 6291456, allowed_mime_types = array['image/jpeg'];

create policy photo_submissions_upload on storage.objects for insert to authenticated
  with check (
    bucket_id = 'photo-submissions'
    and public.is_trip_member(((storage.foldername(name))[1])::uuid)
    and (storage.foldername(name))[2] = (select auth.uid())::text
  );
create policy photo_submissions_view on storage.objects for select to authenticated
  using (bucket_id = 'photo-submissions' and ((storage.foldername(name))[2] = (select auth.uid())::text or public.is_app_admin()));
create policy photo_submissions_undo on storage.objects for delete to authenticated
  using (bucket_id = 'photo-submissions' and (storage.foldername(name))[2] = (select auth.uid())::text);
