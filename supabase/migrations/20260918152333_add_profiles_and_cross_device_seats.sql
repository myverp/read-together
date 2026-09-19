create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  avatar text not null default 'book' check (avatar in ('book', 'leaf', 'moon', 'star', 'tea')),
  preferred_color smallint not null default 0 check (preferred_color between 0 and 9),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.profiles to service_role;

alter table public.reading_rooms
  add column reader_one_user uuid references auth.users(id) on delete restrict,
  add column reader_two_user uuid references auth.users(id) on delete restrict,
  add column position_one jsonb not null default '{"cfi":"","section":"Opening book","done":false}'::jsonb,
  add column position_two jsonb not null default '{"cfi":"","section":"Opening book","done":false}'::jsonb,
  add column control_hash_one text,
  add column control_hash_two text,
  add column control_version_one bigint not null default 0,
  add column control_version_two bigint not null default 0,
  add constraint reading_rooms_distinct_users check (
    reader_one_user is null or reader_two_user is null or reader_one_user <> reader_two_user
  );

create index reading_rooms_reader_one_user_created on public.reading_rooms(reader_one_user, created_at desc);
create index reading_rooms_reader_two_user_created on public.reading_rooms(reader_two_user, created_at desc);
