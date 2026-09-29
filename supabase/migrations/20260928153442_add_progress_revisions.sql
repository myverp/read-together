alter table public.reading_rooms
  add column position_revision_one bigint not null default 0,
  add column position_revision_two bigint not null default 0;

-- Service-only operation: identity is verified by the API, then checked again
-- under the row lock. Late requests cannot bypass takeover or revision checks.
create function public.save_reading_progress(
  p_code text, p_seat integer, p_user uuid, p_guest_hash text,
  p_control_hash text, p_control_version bigint, p_revision bigint, p_position jsonb
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare r public.reading_rooms; linked boolean; current_revision bigint; current_position jsonb;
begin
  select * into r from public.reading_rooms where code = p_code for update;
  if not found or p_seat not in (1,2) then return jsonb_build_object('code','access_denied'); end if;
  linked := p_user is not null and p_user = case when p_seat=1 then r.reader_one_user else r.reader_two_user end;
  if linked then
    if p_control_hash is distinct from (case when p_seat=1 then r.control_hash_one else r.control_hash_two end)
      or p_control_version is distinct from (case when p_seat=1 then r.control_version_one else r.control_version_two end)
      then return jsonb_build_object('code','control_changed'); end if;
  elsif (case when p_seat=1 then r.reader_one_user else r.reader_two_user end) is not null
    or p_guest_hash is distinct from (case when p_seat=1 then r.reader_one else r.reader_two end)
    then return jsonb_build_object('code','control_changed');
  end if;
  current_revision := case when p_seat=1 then r.position_revision_one else r.position_revision_two end;
  current_position := case when p_seat=1 then r.position_one else r.position_two end;
  if p_revision is not null and p_revision <> current_revision then
    return jsonb_build_object('code','revision_conflict');
  end if;
  if p_seat=1 then
    update public.reading_rooms set position_one=p_position, position_revision_one=position_revision_one+1 where code=p_code;
  else
    update public.reading_rooms set position_two=p_position, position_revision_two=position_revision_two+1 where code=p_code;
  end if;
  return jsonb_build_object('position',p_position,'revision',current_revision+1);
end $$;
revoke all on function public.save_reading_progress(text,integer,uuid,text,text,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_reading_progress(text,integer,uuid,text,text,bigint,bigint,jsonb) to service_role;

-- Also invalidate revisions for position updates by legacy API code/profile link.
-- The new RPC increments explicitly; the trigger only covers unchanged counters.
create function public.bump_reading_position_revision() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.position_one is distinct from old.position_one and new.position_revision_one = old.position_revision_one then
    new.position_revision_one := old.position_revision_one + 1;
  end if;
  if new.position_two is distinct from old.position_two and new.position_revision_two = old.position_revision_two then
    new.position_revision_two := old.position_revision_two + 1;
  end if;
  return new;
end $$;
create trigger reading_position_revision before update on public.reading_rooms
for each row execute function public.bump_reading_position_revision();
