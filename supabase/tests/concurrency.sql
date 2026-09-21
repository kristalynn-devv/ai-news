insert into auth.users values ('10000000-0000-4000-8000-000000000001');
insert into private.admin_users values ('10000000-0000-4000-8000-000000000001',true);
insert into private.story_records(id,event_key,slug,source_key)
values ('20000000-0000-4000-8000-000000000001','race','race','official');
insert into private.revisions(id,story_id,revision_number,content,checks_passed,evaluated_policy_version)
values ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',1,
'{"title":"ข่าวทดสอบ","summary":"สรุป","category":"เครื่องมือ","type":"ข่าว","why":"เหตุผล","audience":"ผู้อ่าน","read":3,"art":"model","tags":[]}',true,1);
update private.story_records set current_revision_id='30000000-0000-4000-8000-000000000001';
insert into private.revision_citations(revision_id,label,url,verified)
values ('30000000-0000-4000-8000-000000000001','Original','https://example.com/news',true);
