-- Todo multi-appareils (Supabase) — REBUILD DATABASE
--
-- À coller dans Supabase > SQL Editor et exécuter.
--
-- Effet:
-- - Recrée toutes les tables (DATA LOSS sur todos/listes/tags)
-- - Tâches partagées: tous les utilisateurs authentifiés voient toutes les tâches
-- - Affiche l'email du créateur: champ `created_by_email`
-- - RLS activé
--   - SELECT/INSERT: tous les users authentifiés
--   - UPDATE/DELETE: uniquement le créateur (plus sûr)
--
-- NOTE: Les comptes Supabase Auth ne sont pas supprimés.

begin;

-- Clean (safe if already empty)
drop table if exists public.todo_todo_tags cascade;
drop table if exists public.todo_tags cascade;
drop table if exists public.todo_lists cascade;
drop table if exists public.todos cascade;

drop function if exists public.set_todos_creator();
drop function if exists public.set_todo_lists_creator();
drop function if exists public.set_todo_tags_creator();
drop function if exists public.jwt_email();

-- Helper: email from JWT
create or replace function public.jwt_email()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', auth.jwt() -> 'user_metadata' ->> 'email');
$$;

-- LISTS (shared)
create table public.todo_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  inserted_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_email text
);

create index if not exists todo_lists_inserted_at_idx on public.todo_lists(inserted_at);

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
  return new;
end;
$$;

drop trigger if exists set_todo_lists_creator_trigger on public.todo_lists;
create trigger set_todo_lists_creator_trigger
before insert on public.todo_lists
for each row execute function public.set_todo_lists_creator();

alter table public.todo_lists enable row level security;

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

-- TODOS (shared)
create table public.todos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) <= 280),
  done boolean not null default false,
  inserted_at timestamptz not null default now(),
  list_id uuid null references public.todo_lists(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_email text
);

create index if not exists todos_inserted_at_idx on public.todos(inserted_at);
create index if not exists todos_list_id_idx on public.todos(list_id);

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

alter table public.todos enable row level security;

create policy "todos_select_all_authenticated"
on public.todos for select
using (auth.role() = 'authenticated');

create policy "todos_insert_authenticated"
on public.todos for insert
with check (auth.role() = 'authenticated');

create policy "todos_update_creator"
on public.todos for update
using (auth.uid() = created_by)
with check (auth.uid() = created_by);

create policy "todos_delete_creator"
on public.todos for delete
using (auth.uid() = created_by);

-- TAGS (shared)
create table public.todo_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 50),
  inserted_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_by_email text
);

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
  return new;
end;
$$;

drop trigger if exists set_todo_tags_creator_trigger on public.todo_tags;
create trigger set_todo_tags_creator_trigger
before insert on public.todo_tags
for each row execute function public.set_todo_tags_creator();

alter table public.todo_tags enable row level security;

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

-- JOIN (todos <-> tags)
create table public.todo_todo_tags (
  todo_id uuid not null references public.todos(id) on delete cascade,
  tag_id uuid not null references public.todo_tags(id) on delete cascade,
  inserted_at timestamptz not null default now(),
  primary key (todo_id, tag_id)
);

create index if not exists todo_todo_tags_todo_id_idx on public.todo_todo_tags(todo_id);
create index if not exists todo_todo_tags_tag_id_idx on public.todo_todo_tags(tag_id);

alter table public.todo_todo_tags enable row level security;

create policy "todo_todo_tags_select_all_authenticated"
on public.todo_todo_tags for select
using (auth.role() = 'authenticated');

create policy "todo_todo_tags_insert_authenticated"
on public.todo_todo_tags for insert
with check (auth.role() = 'authenticated');

create policy "todo_todo_tags_delete_authenticated"
on public.todo_todo_tags for delete
using (auth.role() = 'authenticated');

commit;
