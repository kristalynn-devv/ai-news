begin;

alter table private.revisions
  add column created_by uuid references auth.users(id),
  add column change_note text not null default 'pipeline revision'
    check (length(private.trim_text(change_note)) between 1 and 1000);

alter table private.audit_events drop constraint audit_events_action_check;
alter table private.audit_events add constraint audit_events_action_check
  check (action in ('approve','reject','withdraw','reopen','auto_publish','policy_changed','draft_created','draft_updated'));

create function private.valid_draft_citations(value jsonb) returns boolean
language plpgsql stable set search_path = '' as $$
declare item jsonb; key text; published_text text;
begin
  if jsonb_typeof(value) is distinct from 'array' or jsonb_array_length(value) not between 1 and 100
    or octet_length(value::text) > 250000 then return false; end if;
  for item in select jsonb_array_elements(value) loop
    if jsonb_typeof(item) is distinct from 'object' then return false; end if;
    foreach key in array array['label','url','source_published_at','verified'] loop
      if not item ? key then return false; end if;
    end loop;
    for key in select jsonb_object_keys(item) loop
      if key <> all(array['label','url','source_published_at','verified']) then return false; end if;
    end loop;
    if jsonb_typeof(item->'label') is distinct from 'string'
      or length(private.trim_text(item->>'label')) not between 1 and 300
      or jsonb_typeof(item->'url') is distinct from 'string'
      or not private.valid_citation_url(item->>'url')
      or jsonb_typeof(item->'verified') is distinct from 'boolean' then return false; end if;
    if jsonb_typeof(item->'source_published_at') not in ('null','string') then return false; end if;
    published_text := item->>'source_published_at';
    if published_text is not null then
      if published_text !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$' then return false; end if;
      perform published_text::timestamptz;
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(value)) is distinct from
     (select count(distinct element->>'url') from jsonb_array_elements(value) as elements(element)) then return false; end if;
  return true;
exception when others then return false;
end $$;

create function public.save_story_draft(
  p_story_id uuid,
  p_expected_version integer,
  p_slug text,
  p_content jsonb,
  p_citations jsonb,
  p_checks_passed boolean,
  p_source_conflict boolean,
  p_unsupported_claims boolean,
  p_injection_detected boolean,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  story private.story_records;
  draft_story_id uuid;
  new_revision_id uuid := gen_random_uuid();
  revision_number integer;
  policy_id bigint;
  next_version integer;
begin
  perform private.assert_admin();
  if p_slug is null or p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' or length(p_slug) > 120
    or not private.valid_content(p_content)
    or not private.valid_draft_citations(p_citations)
    or p_checks_passed is null or p_source_conflict is null or p_unsupported_claims is null or p_injection_detected is null
    or p_reason is null or length(private.trim_text(p_reason)) not between 1 and 1000 then
    raise exception 'Invalid draft' using errcode = '22023';
  end if;

  select policy_version into policy_id from private.editorial_control where singleton for share;
  if p_story_id is null then
    if p_expected_version is not null then raise exception 'Version is not valid for a new story' using errcode = '22023'; end if;
    draft_story_id := gen_random_uuid();
    insert into private.story_records(id, event_key, slug, source_key)
      values(draft_story_id, 'manual:' || draft_story_id::text, p_slug, 'manual');
    revision_number := 1;
    next_version := 1;
  else
    select * into story from private.story_records where id = p_story_id for update;
    if story.id is null or story.version is distinct from p_expected_version then
      raise exception 'Story changed; reload before saving' using errcode = '40001';
    end if;
    if story.slug is distinct from p_slug then raise exception 'Slug cannot change after creation' using errcode = '22023'; end if;
    if story.status not in ('pending','published') then raise exception 'Story must be reopened before editing' using errcode = '22023'; end if;
    draft_story_id := story.id;
    select coalesce(max(r.revision_number),0) + 1 into revision_number from private.revisions r where r.story_id = draft_story_id;
    next_version := story.version + 1;
  end if;

  insert into private.revisions(id, story_id, revision_number, content, checks_passed,
    source_conflict, unsupported_claims, injection_detected, evaluated_policy_version, created_by, change_note)
  values(new_revision_id, draft_story_id, revision_number, p_content, p_checks_passed,
    p_source_conflict, p_unsupported_claims, p_injection_detected, policy_id, auth.uid(), private.trim_text(p_reason));

  insert into private.revision_citations(revision_id, label, url, source_published_at, verified)
    select new_revision_id, private.trim_text(c.label), c.url, c.source_published_at::timestamptz, c.verified
    from jsonb_to_recordset(p_citations) as c(label text, url text, source_published_at text, verified boolean);

  if p_story_id is null then
    update private.story_records set current_revision_id = new_revision_id where id = draft_story_id;
  else
    update private.story_records set current_revision_id = new_revision_id, version = next_version where id = draft_story_id;
  end if;

  insert into private.audit_events(actor_id, action, story_id, policy_version)
    values(auth.uid(), case when p_story_id is null then 'draft_created' else 'draft_updated' end, draft_story_id, policy_id);
  return jsonb_build_object('id', draft_story_id, 'slug', p_slug, 'revision_id', new_revision_id, 'version', next_version);
end $$;

create function public.admin_story_history(p_story_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.assert_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'revision_id', r.id,
      'revision_number', r.revision_number,
      'title', r.content->>'title',
      'change_note', r.change_note,
      'created_by', r.created_by,
      'created_at', r.created_at,
      'is_current', r.id = s.current_revision_id,
      'is_published', r.id = published.revision_id and not published.withdrawn,
      'reviews', coalesce((select jsonb_agg(jsonb_build_object(
        'decision', review.decision,
        'reason', review.reason,
        'actor_id', review.actor_id,
        'policy_version', review.policy_version,
        'created_at', review.created_at
      ) order by review.created_at, review.id) from (
        select * from private.reviews where revision_id = r.id order by created_at desc, id desc limit 100
      ) review), '[]'::jsonb)
    ) order by r.revision_number desc)
    from private.story_records s
    join lateral (
      select * from private.revisions where story_id = s.id order by revision_number desc limit 100
    ) r on true
    left join public.stories published on published.id = s.id
    where s.id = p_story_id
  ), '[]'::jsonb);
end $$;

revoke all on function private.valid_draft_citations(jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_story_draft(uuid,integer,text,jsonb,jsonb,boolean,boolean,boolean,boolean,text),
  public.admin_story_history(uuid) from public, anon, authenticated, service_role;
grant execute on function public.save_story_draft(uuid,integer,text,jsonb,jsonb,boolean,boolean,boolean,boolean,text),
  public.admin_story_history(uuid) to authenticated;

commit;
