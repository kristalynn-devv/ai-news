\set ON_ERROR_STOP on
\o /dev/null
begin;

create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then get stacked diagnostics actual_state = returned_sqlstate; end;
  if actual_state is distinct from expected_state then
    raise exception 'Expected SQLSTATE %, got % for %', expected_state, actual_state, statement;
  end if;
end $$;

insert into auth.users values
  ('11000000-0000-4000-8000-000000000001'),
  ('11000000-0000-4000-8000-000000000002');
insert into private.admin_users values ('11000000-0000-4000-8000-000000000001', true);

set local role anon;
select pg_temp.expect_error($sql$select public.save_story_draft(null,null,'manual-story','{}','[]',false,false,false,false,'test')$sql$,'42501');
select pg_temp.expect_error($sql$select public.admin_story_history('21000000-0000-4000-8000-000000000001')$sql$,'42501');
reset role;

set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.expect_error($sql$select public.save_story_draft(null,null,'manual-story','{}','[]',false,false,false,false,'test')$sql$,'42501');
reset role;

select pg_temp.assert_true(private.valid_content('{"title":"ร่างแรก","summary":"สรุปแรก","category":"เครื่องมือ","type":"ข่าว","why":"มีผลต่อผู้ใช้","audience":"นักพัฒนา","tags":["Manual"],"read":3,"art":"human"}'), 'draft content fixture valid');
select pg_temp.assert_true(private.valid_draft_citations('[{"label":"ต้นฉบับ","url":"https://example.com/first","source_published_at":null,"verified":true}]'), 'draft citation fixture valid');
set local request.jwt.claim.sub = '11000000-0000-4000-8000-000000000001';
set local role authenticated;
create temporary table draft_result(value jsonb) on commit drop;
insert into draft_result select public.save_story_draft(
  null, null, 'manual-story',
  '{"title":"ร่างแรก","summary":"สรุปแรก","category":"เครื่องมือ","type":"ข่าว","why":"มีผลต่อผู้ใช้","audience":"นักพัฒนา","tags":["Manual"],"read":3,"art":"human"}',
  '[{"label":"ต้นฉบับ","url":"https://example.com/first","source_published_at":null,"verified":true}]',
  true, false, false, false, 'สร้างร่างด้วยตนเอง');
select pg_temp.assert_true((select value->>'slug' = 'manual-story' and (value->>'version')::integer = 1 from draft_result), 'create returns canonical identifiers');
reset role;
select pg_temp.assert_true((select count(*) = 1 from private.story_records where source_key = 'manual' and status = 'pending'), 'manual story starts pending');
select pg_temp.assert_true((select count(*) = 1 from private.revisions where revision_number = 1 and created_by = '11000000-0000-4000-8000-000000000001' and change_note = 'สร้างร่างด้วยตนเอง'), 'first immutable revision records editor and note');
select pg_temp.assert_true((select count(*) = 1 from private.revision_citations where verified), 'citation stored with verification');
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.admin_story_history((select (value->>'id')::uuid from draft_result))) = 1, 'history includes first revision');
select pg_temp.assert_true((public.admin_story_history((select (value->>'id')::uuid from draft_result))->0->>'change_note') = 'สร้างร่างด้วยตนเอง', 'history exposes change note');
select pg_temp.assert_true((select count(*) = 0 from public.stories), 'saving a draft never publishes');

update draft_result set value = public.save_story_draft(
  (value->>'id')::uuid, 1, 'manual-story',
  '{"title":"ร่างแก้ไข","summary":"สรุปใหม่","category":"เครื่องมือ","type":"ข่าว","why":"มีผลต่อผู้ใช้","audience":"นักพัฒนา","tags":["Manual"],"read":4,"art":"human"}',
  '[{"label":"ต้นฉบับใหม่","url":"https://example.com/second","source_published_at":"2026-09-21T00:00:00Z","verified":true}]',
  true, false, false, false, 'แก้ข้อมูลจากต้นฉบับ');
select pg_temp.assert_true((select (value->>'version')::integer = 2 from draft_result), 'edit increments optimistic version');
reset role;
select pg_temp.assert_true((select count(*) = 2 from private.revisions), 'edit appends a revision');
set local role authenticated;
select pg_temp.assert_true(jsonb_array_length(public.admin_story_history((select (value->>'id')::uuid from draft_result))) = 2, 'history keeps both revisions');
select pg_temp.expect_error($sql$select public.save_story_draft(
  (select (value->>'id')::uuid from draft_result), 1, 'manual-story',
  '{"title":"ร่างเก่า","summary":"สรุป","category":"เครื่องมือ","type":"ข่าว","why":"เหตุผล","audience":"นักพัฒนา","tags":[],"read":2,"art":"human"}',
  '[{"label":"ต้นฉบับ","url":"https://example.com/stale","source_published_at":null,"verified":true}]',
  true,false,false,false,'เขียนทับด้วยเวอร์ชันเก่า')$sql$,'40001');

select public.review_story(
  (select (value->>'id')::uuid from draft_result),
  (select (value->>'revision_id')::uuid from draft_result), 2, 'approve', 'ตรวจและอนุมัติ');
select pg_temp.assert_true((select content->>'title' = 'ร่างแก้ไข' from public.stories), 'approved revision becomes public');
update draft_result set value = public.save_story_draft(
  (value->>'id')::uuid, 3, 'manual-story',
  '{"title":"ร่างหลังเผยแพร่","summary":"สรุปใหม่กว่า","category":"เครื่องมือ","type":"ข่าว","why":"มีผลต่อผู้ใช้","audience":"นักพัฒนา","tags":["Manual"],"read":5,"art":"human"}',
  '[{"label":"ต้นฉบับล่าสุด","url":"https://example.com/third","source_published_at":"2026-09-21T01:00:00Z","verified":true}]',
  true, false, false, false, 'เตรียมฉบับปรับปรุง');
select pg_temp.assert_true((select content->>'title' = 'ร่างแก้ไข' from public.stories), 'editing a published story preserves public snapshot');
select pg_temp.assert_true((public.admin_queue()->0->>'status') = 'pending' and (public.admin_queue()->0->>'has_publication')::boolean, 'published edit returns to review with publication retained');
select pg_temp.assert_true(jsonb_array_length(public.admin_story_history((select (value->>'id')::uuid from draft_result))->1->'reviews') = 1, 'history links review to reviewed revision');

select pg_temp.expect_error($sql$select public.save_story_draft(null,null,'Bad Slug','{}','[]',false,false,false,false,'invalid')$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_story_draft(null,null,'bad-content','{}','[]',false,false,false,false,'invalid')$sql$,'22023');
select pg_temp.expect_error($sql$select public.save_story_draft(null,null,'bad-citation',
  '{"title":"ร่าง","summary":"สรุป","category":"เครื่องมือ","type":"ข่าว","why":"เหตุผล","audience":"นักพัฒนา","tags":[],"read":2,"art":"human"}',
  '[{"label":"x","url":"javascript:alert(1)","source_published_at":null,"verified":true}]',false,false,false,false,'invalid')$sql$,'22023');

reset role;
select pg_temp.assert_true((select count(*) = 3 from private.revisions), 'invalid and stale writes append nothing');
select pg_temp.assert_true((select count(*) = 3 from private.audit_events where action in ('draft_created','draft_updated')), 'draft writes are audited');
rollback;
\o
\echo 'Draft checks: admin boundary, immutable history, optimistic writes and public snapshot isolation.'
