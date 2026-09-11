-- Run once in the Supabase SQL editor. No auth accounts or public table access.
create table if not exists public.reading_rooms (
  code text primary key check (code ~ '^[A-F0-9]{12}$'),
  title text not null,
  book_path text not null unique,
  topic text not null unique,
  reader_one text not null,
  reader_two text,
  ready boolean not null default false,
  created_at timestamptz not null default now(),
  check (reader_two is null or reader_two <> reader_one)
);
create index if not exists reading_rooms_creator_created on public.reading_rooms(reader_one, created_at);
alter table public.reading_rooms enable row level security;
-- No policies intentionally: RLS denies every browser role. Only server routes
-- holding the secret key may read/write this table after checking reader tokens.
revoke all on public.reading_rooms from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.reading_rooms to service_role;

-- Shared annotations remain behind the same reader-token checks and table RLS.
alter table public.reading_rooms add column if not exists highlight_state jsonb not null
  default '{"revision":0,"items":[],"colors":[-1,-1]}'::jsonb;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('epubs', 'epubs', false, 26214400, array['application/epub+zip'])
on conflict (id) do update set public = false, file_size_limit = 26214400,
  allowed_mime_types = array['application/epub+zip'];
-- Deliberately no anonymous Storage policies: only signed upload/download URLs.
