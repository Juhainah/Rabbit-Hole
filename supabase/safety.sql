-- Rabbit Hole: daily limits per account, usage numbers, an error log, and reports on shared boards.
-- Run once in Supabase: Dashboard → SQL Editor → New query → paste all of this → Run.
-- Safe to run again. Needs boards.sql to have been run first.
--
-- Reading the numbers afterwards (SQL Editor):
--   select * from admin.daily;      -- people, digs and chats per day
--   select * from admin.weekly;     -- people per week, and how many came back the next week
--   select * from admin.signups;    -- new accounts per day
--   select * from admin.errors;     -- what broke, newest first
--   select * from admin.reports;    -- shared boards people reported
-- Taking a reported board offline:
--   update public.boards set share_id = null where share_id = '<the share id>';

-- ── Daily limits and usage ───────────────────────────────────────────────────
create table if not exists public.usage_hits (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day     date not null default current_date,
  bucket  text not null,
  hits    int  not null default 0,
  primary key (user_id, day, bucket)
);
alter table public.usage_hits enable row level security;
-- No policies on purpose: only the function below reads or writes it.

-- Counts one use of something (a dig, a chat, a visit) for the signed-in person today,
-- and returns today's total so the server can apply its limit.
create or replace function public.take_hit(bucket text)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  n int;
begin
  if auth.uid() is null then
    return 0;
  end if;
  -- "take_hit.bucket" is the input; plain "bucket" would be ambiguous with the table's column.
  if take_hit.bucket !~ '^[a-z]{2,16}$' then
    raise exception 'unknown bucket';
  end if;
  insert into usage_hits as u (user_id, day, bucket, hits)
  values (auth.uid(), current_date, take_hit.bucket, 1)
  on conflict on constraint usage_hits_pkey do update set hits = u.hits + 1
  returning u.hits into n;
  return n;
end;
$$;
revoke all on function public.take_hit(text) from public, anon;
grant execute on function public.take_hit(text) to authenticated;

-- ── Error log ────────────────────────────────────────────────────────────────
create table if not exists public.app_errors (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  user_id uuid default auth.uid(),
  place   text not null,
  message text not null,
  detail  text,
  page    text,
  version text
);
alter table public.app_errors enable row level security;
create index if not exists app_errors_recent on public.app_errors (at desc);
create index if not exists app_errors_person on public.app_errors (user_id, at desc);

create or replace function public.log_error(place text, message text, detail text default null, page text default null, version text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return;
  end if;
  -- At most 30 per person and 3000 in all per day, so the log can't be flooded.
  if (select count(*) from app_errors e where e.user_id = auth.uid() and e.at > now() - interval '1 day') >= 30 then
    return;
  end if;
  if (select count(*) from app_errors e where e.at > now() - interval '1 day') >= 3000 then
    return;
  end if;
  insert into app_errors (place, message, detail, page, version)
  values (left(place, 20), left(message, 500), left(detail, 4000), left(page, 300), left(version, 40));
end;
$$;
revoke all on function public.log_error(text, text, text, text, text) from public, anon;
grant execute on function public.log_error(text, text, text, text, text) to authenticated;

-- ── Reports on shared boards ─────────────────────────────────────────────────
create table if not exists public.board_reports (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  share_id text not null,
  reason   text not null,
  details  text,
  reporter uuid default auth.uid()
);
alter table public.board_reports enable row level security;

create or replace function public.report_board(sid text, reason text, details text default null)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from boards b where b.share_id = sid and not b.deleted) then
    return false;
  end if;
  if (select count(*) from board_reports r where r.at > now() - interval '1 day') >= 500 then
    return false;
  end if;
  insert into board_reports (share_id, reason, details) values (sid, left(reason, 40), left(details, 2000));
  return true;
end;
$$;
revoke all on function public.report_board(text, text, text) from public;
grant execute on function public.report_board(text, text, text) to anon, authenticated;

-- ── Numbers for the owner (a private schema the public API can't reach) ─────
create schema if not exists admin;
revoke all on schema admin from public, anon, authenticated;

create or replace view admin.daily as
select day,
       count(distinct user_id)                     as people,
       coalesce(sum(hits) filter (where bucket = 'dig'), 0)  as digs,
       coalesce(sum(hits) filter (where bucket = 'chat'), 0) as chats
from public.usage_hits
group by day
order by day desc;

create or replace view admin.weekly as
with w as (select distinct user_id, date_trunc('week', day)::date as week from public.usage_hits)
select a.week,
       count(*)                                         as people,
       count(b.user_id)                                 as came_back_next_week,
       round(100.0 * count(b.user_id) / count(*), 1)   as came_back_pct
from w a
left join w b on b.user_id = a.user_id and b.week = a.week + 7
group by a.week
order by a.week desc;

create or replace view admin.signups as
select created_at::date as day, count(*) as new_accounts
from auth.users
group by 1
order by 1 desc;

create or replace view admin.errors as
select at, place, message, detail, page, version, user_id
from public.app_errors
order by at desc;

create or replace view admin.reports as
select r.at, r.reason, r.details, r.share_id, b.name as board, b.user_id as owner
from public.board_reports r
left join public.boards b on b.share_id = r.share_id
order by r.at desc;
