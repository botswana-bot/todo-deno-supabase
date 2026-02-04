-- Supabase SQL migration: multiple lists + tags (per-user)
-- Apply this in Supabase SQL editor AFTER 001_todos.sql

-- 1) Lists
create table if not exists public.todo_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  inserted_at timestamptz not null default now()
);

create index if not exists todo_lists_user_id_idx on public.todo_lists(user_id);
create index if not exists todo_lists_inserted_at_idx on public.todo_lists(inserted_at);

alter table public.todo_lists enable row level security;

drop policy if exists "todo_lists_select_own" on public.todo_lists;
create policy "todo_lists_select_own"
on public.todo_lists for select
using (auth.uid() = user_id);

drop policy if exists "todo_lists_insert_own" on public.todo_lists;
create policy "todo_lists_insert_own"
on public.todo_lists for insert
with check (auth.uid() = user_id);

drop policy if exists "todo_lists_update_own" on public.todo_lists;
create policy "todo_lists_update_own"
on public.todo_lists for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "todo_lists_delete_own" on public.todo_lists;
create policy "todo_lists_delete_own"
on public.todo_lists for delete
using (auth.uid() = user_id);

create or replace function public.set_todo_lists_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_todo_lists_user_id_trigger on public.todo_lists;
create trigger set_todo_lists_user_id_trigger
before insert on public.todo_lists
for each row execute function public.set_todo_lists_user_id();

-- 2) Add list_id to todos
alter table public.todos
  add column if not exists list_id uuid;

alter table public.todos
  drop constraint if exists todos_list_id_fkey;

alter table public.todos
  add constraint todos_list_id_fkey
  foreign key (list_id) references public.todo_lists(id)
  on delete cascade;

create index if not exists todos_list_id_idx on public.todos(list_id);

-- 3) Tags
create table if not exists public.todo_tags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 50),
  inserted_at timestamptz not null default now(),
  constraint todo_tags_user_name_unique unique (user_id, name)
);

create index if not exists todo_tags_user_id_idx on public.todo_tags(user_id);

alter table public.todo_tags enable row level security;

drop policy if exists "todo_tags_select_own" on public.todo_tags;
create policy "todo_tags_select_own"
on public.todo_tags for select
using (auth.uid() = user_id);

drop policy if exists "todo_tags_insert_own" on public.todo_tags;
create policy "todo_tags_insert_own"
on public.todo_tags for insert
with check (auth.uid() = user_id);

drop policy if exists "todo_tags_update_own" on public.todo_tags;
create policy "todo_tags_update_own"
on public.todo_tags for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "todo_tags_delete_own" on public.todo_tags;
create policy "todo_tags_delete_own"
on public.todo_tags for delete
using (auth.uid() = user_id);

create or replace function public.set_todo_tags_user_id()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_todo_tags_user_id_trigger on public.todo_tags;
create trigger set_todo_tags_user_id_trigger
before insert on public.todo_tags
for each row execute function public.set_todo_tags_user_id();

-- 4) Join table (todo <-> tags)
create table if not exists public.todo_todo_tags (
  todo_id uuid not null references public.todos(id) on delete cascade,
  tag_id uuid not null references public.todo_tags(id) on delete cascade,
  inserted_at timestamptz not null default now(),
  primary key (todo_id, tag_id)
);

create index if not exists todo_todo_tags_todo_id_idx on public.todo_todo_tags(todo_id);
create index if not exists todo_todo_tags_tag_id_idx on public.todo_todo_tags(tag_id);

alter table public.todo_todo_tags enable row level security;

-- RLS: allow access only if the underlying todo belongs to the user
-- Select
drop policy if exists "todo_todo_tags_select_own" on public.todo_todo_tags;
create policy "todo_todo_tags_select_own"
on public.todo_todo_tags for select
using (
  exists (
    select 1
    from public.todos t
    where t.id = todo_id
      and t.user_id = auth.uid()
  )
);

-- Insert
drop policy if exists "todo_todo_tags_insert_own" on public.todo_todo_tags;
create policy "todo_todo_tags_insert_own"
on public.todo_todo_tags for insert
with check (
  exists (
    select 1
    from public.todos t
    where t.id = todo_id
      and t.user_id = auth.uid()
  )
);

-- Delete
drop policy if exists "todo_todo_tags_delete_own" on public.todo_todo_tags;
create policy "todo_todo_tags_delete_own"
on public.todo_todo_tags for delete
using (
  exists (
    select 1
    from public.todos t
    where t.id = todo_id
      and t.user_id = auth.uid()
  )
);

-- 5) Backfill: create a default list per user and assign existing todos
-- This is best-effort and safe to run multiple times.
with users_with_todos as (
  select distinct user_id
  from public.todos
  where user_id is not null
), inserted_lists as (
  insert into public.todo_lists (user_id, name)
  select u.user_id, 'Inbox'
  from users_with_todos u
  where not exists (
    select 1 from public.todo_lists l
    where l.user_id = u.user_id
  )
  returning id, user_id
)
update public.todos t
set list_id = l.id
from public.todo_lists l
where t.user_id = l.user_id
  and t.list_id is null;
