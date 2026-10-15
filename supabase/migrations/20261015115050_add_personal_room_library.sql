-- Personal metadata belongs to a seat, so explicit guest/profile linking retains it.
-- Browser table access remains denied by existing RLS and grants.
alter table public.reading_rooms
  add column if not exists archived_at_one timestamptz,
  add column if not exists archived_at_two timestamptz,
  add column if not exists last_opened_at_one timestamptz,
  add column if not exists last_opened_at_two timestamptz;
