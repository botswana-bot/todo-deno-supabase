-- Supabase SQL: table + RLS for per-user todos

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) <= 280),
  done boolean not null default false,
  inserted_at timestamptz not null default now()
);

create index if not exists todos_user_id_idx on public.todos(user_id);
create index if not exists todos_inserted_at_idx on public.todos(inserted_at);

alter table public.todos enable row level security;

-- Read own todos
drop policy if exists "todos_select_own" on public.todos;
create policy "todos_select_own"
on public.todos for select
using (auth.uid() = user_id);

-- Insert own todos
drop policy if exists "todos_insert_own" on public.todos;
create policy "todos_insert_own"
on public.todos for insert
with check (auth.uid() = user_id);

-- Update own todos
drop policy if exists "todos_update_own" on public.todos;
create policy "todos_update_own"
on public.todos for update
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- Delete own todos
drop policy if exists "todos_delete_own" on public.todos;
create policy "todos_delete_own"
on public.todos for delete
using (auth.uid() = user_id);

-- Ensure user_id is auto-set from auth on insert
-- (client will not send user_id; this trigger fills it.)
create or replace function public.set_todos_user_id()
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

drop trigger if exists set_todos_user_id_trigger on public.todos;
create trigger set_todos_user_id_trigger
before insert on public.todos
for each row execute function public.set_todos_user_id();
