-- Daily Compass: one table holds everything the app saves.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
--
-- collection | what it holds
-- items      | tasks, plans, wish list, On my mind, day plans  (data.type says which)
-- checkins   | one per day: the 3 focus items, intention, evening note (id = date)
-- holdings   | portfolio positions
-- pf         | fund values and the USD→KWD rate
-- snaps      | one portfolio total per day for the 30-day chart (id = date)

create table public.docs (
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  collection text not null check (collection in ('items', 'checkins', 'holdings', 'pf', 'snaps')),
  id         text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, collection, id)
);

-- Row level security: each user can only see and change their own rows.
alter table public.docs enable row level security;

create policy "Read own docs" on public.docs
  for select to authenticated using (user_id = (select auth.uid()));

create policy "Insert own docs" on public.docs
  for insert to authenticated with check (user_id = (select auth.uid()));

create policy "Update own docs" on public.docs
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "Delete own docs" on public.docs
  for delete to authenticated using (user_id = (select auth.uid()));

-- Live updates between devices.
alter publication supabase_realtime add table public.docs;
