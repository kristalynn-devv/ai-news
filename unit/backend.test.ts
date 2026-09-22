import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEnv } from '../lib/env.ts';
import { createBackend } from '../lib/backend.ts';
import { contentSchema, citationSchema, type DraftInput } from '../lib/contracts.ts';
const config = { source: 'supabase' as const, url: 'https://fixture.supabase.co', publishableKey: 'sb_publishable_fixture_0000000000000000' };
const content = {title:'ข่าวภาษาไทย',summary:'สรุป',category:'เครื่องมือ',type:'ข่าว',why:'เหตุผล',audience:'นักพัฒนา',read:3,art:'model',tags:['TypeScript']} satisfies DraftInput['content'];
const row = {id:'20000000-0000-4000-8000-000000000001',slug:'new-after-build',revision_id:'30000000-0000-4000-8000-000000000001',content,published_at:'2026-09-20T00:00:00Z',updated_at:'2026-09-20T00:00:00Z',withdrawn:false};
const citation = {story_id:row.id,label:'Official',url:'https://example.com/news',source_published_at:null};
test('configuration defaults offline and fails closed without public Supabase credentials', () => {
  assert.deepEqual(parseEnv({}),{source:'mock'});
  for (const key of ['', 'sb_secret_do_not_echo', 'service_role', 'eyJhbGciOiJIUzI1NiJ9']) {
    assert.throws(()=>parseEnv({NEXT_PUBLIC_DATA_SOURCE:'supabase',NEXT_PUBLIC_SUPABASE_URL:config.url,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}), error => error instanceof Error && !error.message.includes('do_not_echo'));
  }
  assert.throws(()=>parseEnv({NEXT_PUBLIC_DATA_SOURCE:'other'}));
  assert.throws(()=>parseEnv({NEXT_PUBLIC_DATA_SOURCE:'supabase',NEXT_PUBLIC_SUPABASE_URL:'http://example.com',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.publishableKey}));
});
test('mock adapter never makes a network call and does not pretend to authorize', async () => {
  const backend=createBackend({source:'mock'},async()=>{throw new Error('unexpected network');});
  assert.equal((await backend.list('โมเดลเล็ก')).length,1);
  assert.equal((await backend.get('context-kit'))?.id,'context-kit');
  assert.equal(await backend.isAdmin(),false);
  await assert.rejects(()=>backend.signInWithGoogle('https://example.com/admin/'));
});
test('Google sign-in accepts only the admin callback and does not make a provider request itself', async () => {
  let count=0;const backend=createBackend(config,async()=>{count++;throw new Error('unexpected network');});
  await backend.signInWithGoogle('https://ai-daily.krista-lyn.com/admin/');
  assert.equal(count,0);
  for (const callback of ['javascript:alert(1)','https://user@example.com/admin/','https://example.com/news/','https://example.com/admin/?next=evil']) {
    await assert.rejects(()=>backend.signInWithGoogle(callback), /Google/);
  }
});
test('content contract rejects malformed arrays, extra private fields, read length, and unsafe citations', () => {
  for (const invalid of [{...content,tags:[{}]}, {...content,read:-1}, {...content,read:1.2}, {...content,private_note:'secret'}, {...content,technical:{impact:'ok',steps:'bad',caveat:'ok'}}]) assert.equal(contentSchema.safeParse(invalid).success,false);
  for (const url of ['javascript:alert(1)','data:text/html,<script>','https://user:password@example.com', 'https://example.com:99999/path']) assert.equal(citationSchema.safeParse({...citation,url}).success,false);
});
test('Supabase adapter reads a new post without build-time slugs and preserves unknown source dates', async () => {
  const requests: {url:string;body:unknown}[]=[];
  const backend=createBackend(config,async(input,init)=>{
    const url=String(input);requests.push({url,body:init?.body ? JSON.parse(String(init.body)) : null});
    return Response.json([{...row, citations:[citation]}]);
  });
  const result=await backend.list('ข่าวภาษาไทย');
  assert.equal(requests.length,1, 'content and citations must be read atomically');
  assert.equal(result[0].href,'/news/?id=new-after-build');
  assert.equal(result[0].citations?.[0].source_published_at,null);
  assert.deepEqual(requests[0].body,{p_query:'ข่าวภาษาไทย',p_limit:30,p_offset:0});
  assert.equal((await backend.get('new-after-build'))?.title,content.title);
});
test('Supabase errors never fall back to demo content or reflect server secrets', async () => {
  const backend=createBackend(config,async()=>Response.json({message:'provider-secret-do-not-render'}, {status:403}));
  await assert.rejects(()=>backend.list(), error=> error instanceof Error && !error.message.includes('provider-secret'));
  await assert.rejects(()=>backend.queue());
});
test('withdrawn or invalid rows fail closed; invalid slugs make no requests', async () => {
  let count=0;
  const backend=createBackend(config,async()=>{count++;return Response.json([{...row,withdrawn:true}]);});
  await assert.rejects(()=>backend.list());
  const before=count;assert.equal(await backend.get('../admin'),null);assert.equal(count,before);
});
test('draft adapter validates input and maps save/history RPC contracts', async () => {
  const requests: {url:string;body:Record<string,unknown>}[]=[];
  const result={id:row.id,slug:row.slug,revision_id:row.revision_id,version:2};
  const history=[{revision_id:row.revision_id,revision_number:1,title:content.title,change_note:'สร้างร่าง',created_by:null,
    created_at:'2026-09-21T00:00:00Z',is_current:true,is_published:false,reviews:[]}];
  const backend=createBackend(config,async(input,init)=>{
    const request={url:String(input),body:JSON.parse(String(init?.body))};requests.push(request);
    return Response.json(request.url.endsWith('/save_story_draft')?result:history);
  });
  const draft: DraftInput={storyId:row.id,expectedVersion:1,slug:row.slug,content,citations:[{label:citation.label,url:citation.url,source_published_at:null,verified:true}],checksPassed:true,
    sourceConflict:false,unsupportedClaims:false,injectionDetected:false,reason:'ตรวจต้นฉบับแล้ว'};
  assert.deepEqual(await backend.saveDraft(draft),result);
  assert.equal((await backend.history(row.id))[0].change_note,'สร้างร่าง');
  assert.deepEqual(requests[0].body,{p_story_id:row.id,p_expected_version:1,p_slug:row.slug,p_content:content,
    p_citations:draft.citations,p_checks_passed:true,p_source_conflict:false,p_unsupported_claims:false,p_injection_detected:false,p_reason:'ตรวจต้นฉบับแล้ว'});
  assert.deepEqual(requests[1].body,{p_story_id:row.id});
});
test('invalid drafts fail before a network request', async () => {
  let count=0;const backend=createBackend(config,async()=>{count++;return Response.json({});});
  await assert.rejects(()=>backend.saveDraft({storyId:null,expectedVersion:null,slug:'Bad Slug',content,
    citations:[{label:citation.label,url:citation.url,source_published_at:null,verified:true}],checksPassed:false,sourceConflict:false,unsupportedClaims:false,injectionDetected:false,reason:'สร้าง'}));
  assert.equal(count,0);
});
