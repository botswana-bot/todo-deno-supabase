-- Make todos/lists/tags shared between all authenticated users
-- and store creator email on rows for display.
-- Apply AFTER 001 + 002.

-- 0) Helper to get email from JWT (works with Supabase Auth)
create or replace function public.jwt_email()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email');
$$;

-- 1) TODOS: add creator fields
alter table public.todos
  add column if not exists created_by uuid;

alter table public.todos
  add column if not exists created_by_email text;

-- Backfill creator fields from existing user_id
update public.todos
set created_by = coalesce(created_by, user_id)
where created_by is null;

-- Set creator email best-effort (existing rows)
update public.todos
set created_by_email = coalesce(created_by_email, public.jwt_email())
where created_by_email is null;

-- Trigger: set created_by + created_by_email on insert
create or replace function public.set_todos_creator()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.created_by_email is null then
    new.created_by_email := public.jwt_email();
  end if;
  return new;
end;
$$;

drop trigger if exists set_todos_creator_trigger on public.todos;
create trigger set_todos_creator_trigger
before insert on public.todos
for each row execute function public.set_todos_creator();

-- Keep existing user_id auto-fill trigger for compatibility
-- (user_id is still used by older policies / code)

-- 2) LISTS: make shared
-- Remove user_id requirement by allowing NULL user_id for new rows
alter table public.todo_lists alter column user_id drop not null;

alter table public.todo_lists
  add column if not exists created_by uuid;

alter table public.todo_lists
  add column if not exists created_by_email text;

create or replace function public.set_todo_lists_creator()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.created_by_email is null then
    new.created_by_email := public.jwt_email();
  end if;
  -- keep user_id for backward compat
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_todo_lists_creator_trigger on public.todo_lists;
create trigger set_todo_lists_creator_trigger
before insert on public.todo_lists
for each row execute function public.set_todo_lists_creator();

-- 3) TAGS: make shared
alter table public.todo_tags alter column user_id drop not null;

alter table public.todo_tags
  add column if not exists created_by uuid;

alter table public.todo_tags
  add column if not exists created_by_email text;

-- Adjust uniqueness: global unique by name (case-insensitive-ish handled in app)
alter table public.todo_tags drop constraint if exists todo_tags_user_name_unique;
create unique index if not exists todo_tags_name_unique on public.todo_tags (lower(name));

create or replace function public.set_todo_tags_creator()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.created_by is null then
    new.created_by := auth.uid();
  end if;
  if new.created_by_email is null then
    new.created_by_email := public.jwt_email();
  end if;
  if new.user_id is null then
    new.user_id := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists set_todo_tags_creator_trigger on public.todo_tags;
create trigger set_todo_tags_creator_trigger
before insert on public.todo_tags
for each row execute function public.set_todo_tags_creator();

-- 4) RLS POLICIES
-- TODOS: readable by any authenticated user
alter table public.todos enable row level security;

drop policy if exists "todos_select_own" on public.todos;
drop policy if exists "todos_insert_own" on public.todos;
drop policy if exists "todos_update_own" on public.todos;
drop policy if exists "todos_delete_own" on public.todos;

create policy "todos_select_all_authenticated"
on public.todos for select
using (auth.role() = 'authenticated');

create policy "todos_insert_authenticated"
on public.todos for insert
with check (auth.role() = 'authenticated');

-- Update/Delete only by creator (safer default)
create policy "todos_update_creator"
on public.todos for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "todos_delete_creator"
on public.todos for delete
using (auth.uid() = created_by);

-- LISTS: readable by any authenticated user
alter table public.todo_lists enable row level security;

drop policy if exists "todo_lists_select_own" on public.todo_lists;
drop policy if exists "todo_lists_insert_own" on public.todo_lists;
drop policy if exists "todo_lists_update_own" on public.todo_lists;
drop policy if exists "todo_lists_delete_own" on public.todo_lists;

create policy "todo_lists_select_all_authenticated"
on public.todo_lists for select
using (auth.role() = 'authenticated');

create policy "todo_lists_insert_authenticated"
on public.todo_lists for insert
with check (auth.role() = 'authenticated');

create policy "todo_lists_update_creator"
on public.todo_lists for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "todo_lists_delete_creator"
on public.todo_lists for delete
using (auth.uid() = created_by);

-- TAGS: readable by any authenticated user
alter table public.todo_tags enable row level security;

drop policy if exists "todo_tags_select_own" on public.todo_tags;
drop policy if exists "todo_tags_insert_own" on public.todo_tags;
drop policy if exists "todo_tags_update_own" on public.todo_tags;
drop policy if exists "todo_tags_delete_own" on public.todo_tags;

create policy "todo_tags_select_all_authenticated"
on public.todo_tags for select
using (auth.role() = 'authenticated');

create policy "todo_tags_insert_authenticated"
on public.todo_tags for insert
with check (auth.role() = 'authenticated');

create policy "todo_tags_update_creator"
on public.todo_tags for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "todo_tags_delete_creator"
on public.todo_tags for delete
using (auth.uid() = created_by);

-- JOIN TABLE: allow if authenticated (since todos are shared)
alter table public.todo_todo_tags enable row level security;

drop policy if exists "todo_todo_tags_select_own" on public.todo_todo_tags;
drop policy if exists "todo_todo_tags_insert_own" on public.todo_todo_tags;
drop policy if exists "todo_todo_tags_delete_own" on public.todo_todo_tags;

create policy "todo_todo_tags_select_all_authenticated"
on public.todo_todo_tags for select
using (auth.role() = 'authenticated');

create policy "todo_todo_tags_insert_authenticated"
on public.todo_todo_tags for insert
with check (auth.role() = 'authenticated');

create policy "todo_todo_tags_delete_authenticated"
on public.todo_todo_tags for delete
using (auth.role() = 'authenticated');
