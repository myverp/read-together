alter table public.reading_rooms add column deletion_requested_at timestamptz;
create index reading_rooms_deletion_pending on public.reading_rooms(deletion_requested_at)
  where deletion_requested_at is not null;

-- Once marked, even requests which read the room before deletion cannot write.
-- Storage cleanup is outside this short transaction; failed cleanup is retryable.
create function public.guard_deleting_room() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if old.deletion_requested_at is not null then
    raise exception using errcode = 'PT410', message = 'room_unavailable';
  end if;
  return new;
end $$;
create trigger room_deletion_guard before update on public.reading_rooms
  for each row execute function public.guard_deleting_room();
revoke all on function public.guard_deleting_room() from public, anon, authenticated;

create function public.request_room_deletion(p_code text, p_user uuid, p_guest_hash text, p_control_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.reading_rooms;
begin
  select * into r from public.reading_rooms where code = p_code for update;
  -- Missing is terminal and idempotent; it discloses no room data.
  if not found then return jsonb_build_object('code', 'absent'); end if;
  if r.reader_one_user is not null then
    if p_user is distinct from r.reader_one_user then return jsonb_build_object('code', 'access_denied'); end if;
    if p_control_hash is distinct from r.control_hash_one then
      return jsonb_build_object('code', case when r.deletion_requested_at is null then 'control_changed' else 'deletion_in_progress' end);
    end if;
  elsif p_guest_hash is distinct from r.reader_one then
    return jsonb_build_object('code', 'access_denied');
  end if;
  if not r.ready then return jsonb_build_object('code', 'not_ready'); end if;
  if r.deletion_requested_at is null then
    update public.reading_rooms set deletion_requested_at = pg_catalog.now() where code = p_code;
  end if;
  return jsonb_build_object('code', 'deleting', 'book_path', r.book_path);
end $$;
revoke all on function public.request_room_deletion(text,uuid,text,text) from public, anon, authenticated;
grant execute on function public.request_room_deletion(text,uuid,text,text) to service_role;

-- Keep the rolling browser limit after deleting a room. No room FK: deletion
-- must not erase creation attempts. Maintenance prunes these after 48 hours.
create table public.room_creation_events (
  code text primary key,
  reader_hash text not null,
  created_at timestamptz not null
);
create index room_creation_events_reader_time on public.room_creation_events(reader_hash, created_at);
create index room_creation_events_expiry on public.room_creation_events(created_at);
alter table public.room_creation_events enable row level security;
revoke all on public.room_creation_events from public, anon, authenticated, service_role;
grant select, insert, delete on public.room_creation_events to service_role;
insert into public.room_creation_events(code, reader_hash, created_at)
  select code, reader_one, created_at from public.reading_rooms
  where created_at >= pg_catalog.now() - interval '48 hours';
create function public.record_room_creation() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  insert into public.room_creation_events(code, reader_hash, created_at)
    values (new.code, new.reader_one, new.created_at);
  return new;
end $$;
create trigger record_room_creation after insert on public.reading_rooms
  for each row execute function public.record_room_creation();
revoke all on function public.record_room_creation() from public, anon, authenticated;
create or replace function public.create_reading_room(
  p_code text, p_title text, p_book_path text, p_topic text,
  p_reader_one text, p_reader_one_user uuid, p_control_hash_one text,
  p_preferred_color integer, p_scope_hash text
)
returns text
language plpgsql security invoker set search_path = ''
as $$
declare
  usage record;
  hour_start timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now());
  hour_count integer;
  day_count integer;
  browser_count integer;
begin
  -- Serialize the budget check, counters, and room insert across server instances.
  perform pg_catalog.pg_advisory_xact_lock(781452930);
  select * into usage from public.room_storage_usage();
  if usage.stored_bytes + usage.pending_bytes + 26214400 > usage.budget_bytes then
    return 'storage_budget';
  end if;
  select count(*) into browser_count from public.room_creation_events
    where reader_hash = p_reader_one and created_at >= pg_catalog.now() - interval '1 hour';
  if browser_count >= 10 then return 'browser_limit'; end if;
  select coalesce(attempts, 0) into hour_count from public.room_creation_limits
    where scope_hash = p_scope_hash and window_kind = 'hour' and window_start = hour_start;
  select coalesce(attempts, 0) into day_count from public.room_creation_limits
    where scope_hash = p_scope_hash and window_kind = 'day' and window_start = day_start;
  if coalesce(hour_count, 0) >= 30 or coalesce(day_count, 0) >= 100 then
    return 'network_limit';
  end if;

  insert into public.reading_rooms (
    code, title, book_path, topic, reader_one, reader_one_user,
    control_hash_one, control_version_one, highlight_state
  ) values (
    p_code, p_title, p_book_path, p_topic, p_reader_one, p_reader_one_user,
    p_control_hash_one, case when p_reader_one_user is null then 0 else 1 end,
    pg_catalog.jsonb_build_object('revision', 0, 'items', '[]'::jsonb,
      'colors', pg_catalog.jsonb_build_array(p_preferred_color, -1))
  );
  insert into public.room_creation_limits (scope_hash, window_kind, window_start, attempts)
    values (p_scope_hash, 'hour', hour_start, 1), (p_scope_hash, 'day', day_start, 1)
    on conflict (scope_hash, window_kind, window_start)
    do update set attempts = public.room_creation_limits.attempts + 1;
  return 'ok';
end;
$$;
revoke all on function public.create_reading_room(text,text,text,text,text,uuid,text,integer,text)
  from public, anon, authenticated;
grant execute on function public.create_reading_room(text,text,text,text,text,uuid,text,integer,text)
  to service_role;
