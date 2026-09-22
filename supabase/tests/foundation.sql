\set ON_ERROR_STOP on
\o /dev/null
begin;
create function pg_temp.assert_true(ok boolean, message text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'Assertion failed: %', message; end if; end $$;
create function pg_temp.expect_error(statement text, expected_state text) returns void language plpgsql as $$
declare actual_state text;
begin
  begin execute statement; exception when others then
    get stacked diagnostics actual_state = returned_sqlstate;
  end;
  if actual_state is distinct from expected_state then
    raise exception 'Expected SQLSTATE %, got % for %', expected_state, actual_state, statement;
  end if;
end $$;
select pg_temp.assert_true(exists(select 1 from private.editorial_policies where mode = 'Manual' and auto_stopped), 'safe defaults');
insert into auth.users values ('10000000-0000-4000-8000-000000000001'), ('10000000-0000-4000-8000-000000000002');
insert into private.admin_users values ('10000000-0000-4000-8000-000000000001', true);
insert into private.story_records(id,event_key,slug,source_key) values
  ('20000000-0000-4000-8000-000000000001','event-1','news-one','manual'),
  ('20000000-0000-4000-8000-000000000002','event-2','news-two','manual');
insert into private.revisions(id,story_id,revision_number,content,checks_passed,evaluated_policy_version)
select ('30000000-0000-4000-8000-00000000000' || n)::uuid,
       ('20000000-0000-4000-8000-00000000000' || n)::uuid, 1,
       '{"title":"โมเดลเล็กสำหรับนักพัฒนา","summary":"อ่านข่าวภาษาไทย","category":"เครื่องมือ","type":"ข่าว","why":"เหตุผล","audience":"นักพัฒนา","tags":["TypeScript"],"read":3,"art":"model"}', true, 1
from generate_series(1,2) n;
update private.story_records s set current_revision_id = r.id from private.revisions r where r.story_id = s.id;
insert into private.revision_citations(revision_id,label,url,source_published_at,verified)
values ('30000000-0000-4000-8000-000000000001','Official source','https://example.com/news', now(), true);

set local role anon;
select pg_temp.assert_true((select count(*) = 0 from public.stories), 'drafts are not public');
select pg_temp.expect_error('select * from private.revisions','42501');
select pg_temp.expect_error('select public.admin_queue()','42501');
select pg_temp.expect_error('insert into public.stories default values','42501');
select pg_temp.expect_error('select public.review_story(null,null,1,''approve'',''test'')','42501');
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000002';
set local role authenticated;
select pg_temp.assert_true(not public.is_admin(), 'ordinary user is not admin');
select pg_temp.expect_error('select public.admin_queue()','42501');
select pg_temp.expect_error('select public.review_story(null,null,1,''approve'',''test'')','42501');
select pg_temp.expect_error('select public.set_editorial_policy(1,''Auto'',false)','42501');
select pg_temp.expect_error('insert into private.admin_users values (auth.uid(),true)','42501');
reset role;
set local request.jwt.claim.sub = '10000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true(public.is_admin(), 'allowlisted admin');
select pg_temp.assert_true(jsonb_array_length(public.admin_queue()) = 2, 'admin queue includes drafts');
select pg_temp.expect_error('update public.stories set withdrawn = false','42501');
select pg_temp.expect_error('delete from private.audit_events','42501');
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',1,''approve'','''')','22023');
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000002'',''30000000-0000-4000-8000-000000000002'',1,''approve'',''checked'')','22023');
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'approve','ตรวจต้นฉบับแล้ว');
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',1,''approve'',''stale'')','40001');
reset role;
select pg_temp.assert_true((select count(*) = 1 from private.reviews), 'exactly one review');
select pg_temp.assert_true((select count(*) = 1 from private.audit_events where actor_id = '10000000-0000-4000-8000-000000000001'), 'audit actor comes from auth');
set local role anon;
select pg_temp.assert_true((select count(*) = 1 from public.stories), 'approved story visible');
select pg_temp.assert_true((select count(*) = 1 from public.citations), 'approved citations visible');
select pg_temp.assert_true((select count(*) = 1 from public.search_stories('โมเดลเล็ก')), 'Thai substring search');
select pg_temp.assert_true((select count(*) = 0 from public.search_stories('%')), 'wildcards are literal');
reset role;

-- A fresh private revision never changes the published snapshot until approval.
insert into private.revisions(id,story_id,revision_number,content,checks_passed,evaluated_policy_version)
select '30000000-0000-4000-8000-000000000003',story_id,2,jsonb_set(content,'{title}','"ร่างแก้ไขที่ยังไม่เผยแพร่"'),true,1
from private.revisions where id = '30000000-0000-4000-8000-000000000001';
update private.story_records set current_revision_id = '30000000-0000-4000-8000-000000000003', version=version+1 where id = '20000000-0000-4000-8000-000000000001';
set local role anon;
select pg_temp.assert_true((select content->>'title' = 'โมเดลเล็กสำหรับนักพัฒนา' from public.stories), 'public snapshot unchanged');
reset role;
set local role authenticated;
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000001'',3,''approve'',''wrong revision'')','40001');
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',3,'withdraw','ถอนเพื่อตรวจข้อเท็จจริง');
reset role;
set local role anon;
select pg_temp.assert_true((select count(*) = 0 from public.stories), 'withdraw hides story');
select pg_temp.assert_true((select count(*) = 0 from public.citations), 'withdraw hides citations');
reset role;
set local role authenticated;
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000003'',4,''approve'',''cannot revive'')','22023');
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',4,'reopen','เปิดตรวจใหม่อย่างชัดเจน');
select public.review_story('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',1,'reject','หลักฐานไม่เพียงพอ');
reset role;
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002',1) = 'held_status', 'rejected never auto returns');
set local role authenticated;
select public.set_editorial_policy(1,'Hybrid',false, array['manual'],array['manual']);
select pg_temp.expect_error('select public.set_editorial_policy(1,''Auto'',false)','40001');
reset role;
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',1) = 'stale_policy', 'policy change cannot republish backlog');
update private.revisions set evaluated_policy_version = 2 where id = '30000000-0000-4000-8000-000000000003';
insert into private.revision_citations(revision_id,label,url,source_published_at,verified)
values ('30000000-0000-4000-8000-000000000003','Official source','https://example.com/revision',now(),true);
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',2) = 'manual', 'Manual wins conflicting source rules');
set local role authenticated;
select public.set_editorial_policy(2,'Auto',false);
reset role;
update private.revisions set evaluated_policy_version=3 where id='30000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',3) = 'eligible', 'safe Auto eligibility');
update private.revisions set injection_detected=true where id='30000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',3) = 'unsafe', 'prompt injection held');
set local role authenticated;
select pg_temp.expect_error('select public.review_story(''20000000-0000-4000-8000-000000000001'',''30000000-0000-4000-8000-000000000003'',5,''approve'',''unsafe'')','22023');
reset role;
update private.revisions set injection_detected=false where id='30000000-0000-4000-8000-000000000003';
update private.revision_citations set source_published_at=null where revision_id='30000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',3) = 'citations_need_review', 'missing dates require human review');
set local role authenticated;
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',5,'approve','ตรวจแล้ว ไม่ทราบวันที่ต้นฉบับ');
select public.set_editorial_policy(3,'Auto',true);
reset role;
select pg_temp.assert_true((select source_published_at is null from public.citations), 'unknown source date preserved');
select pg_temp.assert_true((select count(*) = 1 from public.stories), 'single canonical story after revision');
select pg_temp.assert_true((select count(*) = 1 from public.citations), 'old citations replaced atomically');
insert into private.revisions(id,story_id,revision_number,content,checks_passed,evaluated_policy_version)
select '30000000-0000-4000-8000-000000000004',story_id,3,content,true,4 from private.revisions where id='30000000-0000-4000-8000-000000000003';
update private.story_records set current_revision_id='30000000-0000-4000-8000-000000000004',version=version+1 where id='20000000-0000-4000-8000-000000000001';
set local role authenticated;
select pg_temp.assert_true((public.admin_queue()->0->>'revision_id')='30000000-0000-4000-8000-000000000004', 'published story new draft enters pending queue');
select pg_temp.assert_true((public.admin_queue()->0->>'has_publication')::boolean, 'pending revision retains active publication');
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000004',7,'reject','ไม่ใช้ร่างแก้ไขนี้');
select pg_temp.assert_true(jsonb_array_length(public.admin_queue())=0, 'rejected revision leaves pending queue');
reset role;
select pg_temp.assert_true((select current_revision_id='30000000-0000-4000-8000-000000000003' and status='published' from private.story_records where id='20000000-0000-4000-8000-000000000001'), 'reject restores approved revision pointer');
set local role anon;
select pg_temp.assert_true((select count(*)=1 from public.stories), 'rejecting draft does not withdraw publication');
select pg_temp.assert_true((select value->>'revision_id'='30000000-0000-4000-8000-000000000003' and jsonb_array_length(value->'citations')=1 from public.get_story('news-one') value), 'content and citations returned in one snapshot');
reset role;
update private.admin_users set active=false;
set local role authenticated;
select pg_temp.assert_true(not public.is_admin(), 'revocation effective on existing JWT');
select pg_temp.expect_error('select public.admin_queue()','42501');
reset role;

select pg_temp.assert_true((select revision_id='30000000-0000-4000-8000-000000000001' from private.reviews where decision='withdraw'), 'withdrawal records the approved revision, not the pending draft');

-- Budget/usage/run schema invariants; no reservation/execution capability is exposed.
-- A past month: the scheduler migration seeds the current one, and month_start is unique.
insert into private.budgets(id,month_start) values ('40000000-0000-4000-8000-000000000001','2026-02-01');
update private.budgets set cash_limit=1 where id='40000000-0000-4000-8000-000000000001';
select pg_temp.assert_true((select cash_limit=1 from private.budgets where id='40000000-0000-4000-8000-000000000001'),
  'funding a month is allowed now that the latch is a condition, not a prohibition');
select pg_temp.expect_error('update private.budgets set ai_enabled=true','23514');
insert into private.runs(id,run_key,trigger_kind,policy_version) values ('50000000-0000-4000-8000-000000000001','2026-09-20T00:00:00Z','scheduled',1);
select pg_temp.expect_error('insert into private.runs(run_key,trigger_kind,policy_version) values (''2026-09-20T00:00:00Z'',''manual'',1)','23505');
insert into private.invocations(idempotency_key,run_id,budget_id,step_key,attempt,purpose,provider,model,status,reserved_quota,quota_unit,pricing_snapshot)
values ('invoke-1','50000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','test',1,'test','fixture','fixture','unknown',100,'tokens','{"verified_free":true}');
select pg_temp.assert_true((select actual_cost is null and input_tokens is null and reserved_quota=100 from private.invocations), 'unknown retains reservation and null usage');
select pg_temp.expect_error('update private.invocations set actual_cost=0','23514');
select pg_temp.expect_error('update private.invocations set input_tokens=0','23514');
select pg_temp.expect_error('update private.invocations set cache_read_tokens=0','23514');
select pg_temp.expect_error('update private.invocations set cache_write_tokens=0','23514');
select pg_temp.expect_error('update private.invocations set currency=''THB''','23514');
select pg_temp.expect_error('insert into private.invocations select * from private.invocations','23505');
select pg_temp.assert_true(not exists(select 1 from pg_tables where schemaname in ('private','public') and not rowsecurity), 'all app tables enable RLS');
select pg_temp.assert_true(not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='private' and has_function_privilege('authenticated', p.oid, 'execute')), 'no private function execute grants');

select pg_temp.assert_true(not private.valid_citation_url('https://example.com:99999/path'), 'invalid port rejected');
select pg_temp.assert_true(not private.valid_content((select jsonb_set(content,'{title}',to_jsonb(E'\t'::text)) from private.revisions limit 1)), 'tab-only required text rejected');

-- A mistakenly added table grant still cannot bypass private-table RLS.
grant usage on schema private to authenticated;
grant select on private.revisions to authenticated;
set local role authenticated;
select pg_temp.assert_true((select count(*)=0 from private.revisions), 'private RLS denies accidental grants');
reset role;
select pg_temp.assert_true(not private.valid_content('{"title":"bad"}'), 'incomplete public payload rejected');
select pg_temp.assert_true(not private.valid_content((select jsonb_set(content,'{tags}','[{}]') from private.revisions limit 1)), 'non-string tags rejected');
select pg_temp.assert_true(not private.valid_content((select content || '{"internal_note":"private"}'::jsonb from private.revisions limit 1)), 'private keys cannot be copied to publication');
select pg_temp.assert_true(not private.valid_content((select jsonb_set(content,'{read}','1.5') from private.revisions limit 1)), 'fractional reading length rejected');
update private.story_records set status='pending' where id='20000000-0000-4000-8000-000000000001';
update private.revisions set evaluated_policy_version=4 where id='30000000-0000-4000-8000-000000000003';
select pg_temp.assert_true(private.publication_decision('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000003',4)='auto_stopped','stop switch evaluated at decision time');
\pset tuples_only on
\pset format unaligned
\o /tmp/ai-daily-contract.json
select value from public.get_story('news-one') value;
\o /dev/null
rollback;
\o
\echo 'Foundation checks: roles, snapshots, review concurrency guards, policy precedence, search, budget and usage.'
