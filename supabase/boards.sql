-- Rabbit Hole: boards saved to each person's account, and share links.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste all of this → Run.
-- Safe to run again; it only adds what is missing.

create table if not exists public.boards (
  user_id    uuid    not null default auth.uid() references auth.users (id) on delete cascade,
  id         text    not null,
  name       text    not null default '',
  emoji      text    not null default '',
  data       jsonb   not null default '{}'::jsonb,
  -- The board's own "last changed" clock (milliseconds), so two devices can tell which copy is newer.
  updated_at bigint  not null default 0,
  -- Deleted boards stay as an empty marker, so another device doesn't bring them back.
  deleted    boolean not null default false,
  -- Set while the board is shared by link; anyone with the link can view it.
  share_id   text    unique,
  primary key (user_id, id),
  -- One board can't fill the free database on its own.
  constraint board_size check (pg_column_size(data) < 8000000)
);

alter table public.boards enable row level security;

-- Each person can only see and change their own boards.
drop policy if exists "boards: owner reads"   on public.boards;
drop policy if exists "boards: owner adds"    on public.boards;
drop policy if exists "boards: owner changes" on public.boards;
drop policy if exists "boards: owner removes" on public.boards;
create policy "boards: owner reads"   on public.boards for select using (auth.uid() = user_id);
create policy "boards: owner adds"    on public.boards for insert with check (auth.uid() = user_id);
create policy "boards: owner changes" on public.boards for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "boards: owner removes" on public.boards for delete using (auth.uid() = user_id);

-- A shared board, by its link id. Returns one board only (no listing of shared boards),
-- and leaves out the private chat with the AI partner.
create or replace function public.shared_board(sid text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select (data - 'chat') || jsonb_build_object('chat', '[]'::jsonb)
  from public.boards
  where share_id = sid and length(sid) >= 12 and not deleted
  limit 1;
$$;

revoke all on function public.shared_board(text) from public;
grant execute on function public.shared_board(text) to anon, authenticated;
