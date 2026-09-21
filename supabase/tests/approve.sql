begin;
set local request.jwt.claim.sub='10000000-0000-4000-8000-000000000001';
set local role authenticated;
select public.review_story('20000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001',1,'approve','ตรวจต้นฉบับแล้ว');
select pg_sleep(0.2);
commit;
