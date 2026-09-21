import { test, expect } from '@playwright/test';
test.skip(process.env.TEST_SUPABASE !== '1', 'Requires a Supabase-mode static build with the fixture public config');
const id='20000000-0000-4000-8000-000000000001';
const revision='30000000-0000-4000-8000-000000000001';
const content={title:'ข่าวใหม่หลัง build สำหรับนักพัฒนา',summary:'เนื้อหาที่ผ่านการอนุมัติ',category:'เครื่องมือ',type:'ข่าว',why:'เหตุผลที่ตรวจได้',audience:'นักพัฒนา',read:3,art:'model',tags:['TypeScript'],technical:{impact:'ผลกระทบทางเทคนิค',steps:['ตรวจเอกสารต้นฉบับ'],caveat:'ยังไม่มีผลทดลองภายใน'}};
const story={id,slug:'after-build',revision_id:revision,content,published_at:'2026-09-20T00:00:00Z',updated_at:'2026-09-20T00:00:00Z',withdrawn:false};
const citation={story_id:id,label:'เอกสารต้นฉบับ',url:'https://example.com/original',source_published_at:null};
const queue={id,slug:'after-build',revision_id:revision,version:1,status:'pending',has_publication:false,content,checks_passed:true,source_conflict:false,unsupported_claims:false,injection_detected:false,policy_version:1,citations:[{label:citation.label,url:citation.url,source_published_at:null,verified:true}]};

test('new static URL, Thai search, developer view, unknown dates and refresh failure',async({page},testInfo)=>{
  let fail=false;
  await page.route('https://fixture.supabase.co/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    if(fail) return route.fulfill({status:503,json:{message:'offline'}});
    await route.fulfill({json:[{...story,citations:[citation]}]});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:content.title}).first()).toBeVisible();
  await page.getByRole('textbox',{name:'ค้นหาข่าว'}).fill('ข่าวใหม่');
  await expect(page.getByRole('heading',{name:'ผลการค้นหา · 1 เรื่อง'})).toBeVisible();
  await page.getByRole('heading',{name:content.title}).getByRole('link').click();
  await expect(page).toHaveURL(/\/news\/\?id=after-build/);
  await expect(page.getByRole('heading',{level:1})).toHaveText(content.title);
  await expect(page.getByText('วันที่ต้นฉบับ: ไม่ทราบ')).toBeVisible();
  await expect(page.getByRole('link',{name:'เอกสารต้นฉบับ',exact:true})).toHaveAttribute('href',citation.url);
  await page.getByRole('button',{name:'มุมมองนักพัฒนา',exact:true}).click();
  await expect(page.getByText('ผลกระทบทางเทคนิค',{exact:true})).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading',{level:1})).toHaveText(content.title);
  await page.screenshot({path:`.leancode/${testInfo.project.name}-supabase-article.png`,fullPage:true});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:content.title}).first()).toBeVisible();
  fail=true;
  await page.getByRole('button',{name:'โหลดข่าวใหม่'}).click();
  await expect(page.locator('main').getByRole('alert')).toContainText('กำลังแสดงผลที่โหลดสำเร็จก่อนหน้า');
  await expect(page.getByRole('heading',{name:content.title}).first()).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('admin authorization, explicit review, logout and inactive settings',async({page},testInfo)=>{
  let admin=false,approved=false;
  const decisions:unknown[]=[];
  await page.route('https://fixture.supabase.co/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path.endsWith('/token')) {
      admin=request.postDataJSON().email==='editor@fixture.invalid';
      const token=[{alg:'HS256',typ:'JWT'},{sub:'10000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
      return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture-refresh',user:{id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',email:request.postDataJSON().email}}});
    }
    if(path.endsWith('/is_admin')) return route.fulfill({json:admin});
    if(path.endsWith('/logout')) return route.fulfill({status:204});
    if(path.endsWith('/admin_queue')) return route.fulfill({status:admin?200:403,json:admin?(approved?[]:[queue]):{message:'denied'}});
    if(path.endsWith('/admin_story_history')) return route.fulfill({json:[{revision_id:revision,revision_number:1,title:content.title,change_note:'สร้างร่าง',created_by:null,created_at:'2026-09-20T00:00:00Z',is_current:true,is_published:false,reviews:[]}]});
    if(path.endsWith('/review_story')) {decisions.push(request.postDataJSON());approved=true;return route.fulfill({json:null});}
    return route.fulfill({status:404,json:{message:'unexpected request'}});
  });
  await page.goto('/admin/');
  await expect(page.getByRole('heading',{name:'เข้าสู่ระบบบรรณาธิการ'})).toBeVisible();
  await page.getByLabel('อีเมล',{exact:true}).fill('reader@fixture.invalid');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill('fixture-only-password');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await expect(page.locator('main').getByRole('alert')).toHaveText('บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล');
  await page.getByLabel('อีเมล',{exact:true}).fill('editor@fixture.invalid');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill('fixture-only-password');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await expect(page.getByRole('button',{name:'อนุมัติเผยแพร่',exact:true})).toBeDisabled();
  await page.getByLabel('เหตุผลการตัดสิน').fill('ตรวจต้นฉบับแล้ว');
  await page.screenshot({path:`.leancode/${testInfo.project.name}-supabase-admin.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole('button',{name:'อนุมัติเผยแพร่',exact:true}).click();
  await expect(page.getByRole('heading',{name:'ไม่มีข่าวในหน้านี้'})).toBeVisible();
  expect(decisions).toEqual([{p_story_id:id,p_revision_id:revision,p_expected_version:1,p_action:'approve',p_reason:'ตรวจต้นฉบับแล้ว'}]);
  await page.getByRole('link',{name:'Agents & Providers'}).click();
  await expect(page.getByRole('heading',{level:1})).toHaveText('Agents & Providers');
  await expect(page.locator('main').getByRole('alert')).toHaveCount(0);
  await page.getByRole('button',{name:'ออกจากระบบ'}).click();
  await expect(page.getByRole('heading',{name:'เข้าสู่ระบบบรรณาธิการ'})).toBeVisible();
});

test('admin creates and revises a manual draft with visible history',async({page},testInfo)=>{
  const secondRevision='30000000-0000-4000-8000-000000000002';
  const saves:Record<string,unknown>[]=[];
  let queueItems:unknown[]=[];
  let historyItems:unknown[]=[];
  await page.route('https://fixture.supabase.co/**',async route=>{
    const request=route.request();const path=new URL(request.url()).pathname;
    if(path.endsWith('/token')) {
      const token=[{alg:'HS256',typ:'JWT'},{sub:'10000000-0000-4000-8000-000000000001',exp:Math.floor(Date.now()/1000)+3600},'fixture'].map(x=>Buffer.from(typeof x==='string'?x:JSON.stringify(x)).toString('base64url')).join('.');
      return route.fulfill({json:{access_token:token,token_type:'bearer',expires_in:3600,refresh_token:'fixture-refresh',user:{id:'10000000-0000-4000-8000-000000000001',aud:'authenticated',email:'editor@fixture.invalid'}}});
    }
    if(path.endsWith('/is_admin')) return route.fulfill({json:true});
    if(path.endsWith('/admin_queue')) return route.fulfill({json:queueItems});
    if(path.endsWith('/admin_story_history')) return route.fulfill({json:historyItems});
    if(path.endsWith('/save_story_draft')) {
      const body=request.postDataJSON() as Record<string,unknown>;saves.push(body);
      const version=saves.length;const currentRevision=version===1?revision:secondRevision;
      queueItems=[{...queue,slug:'manual-story',revision_id:currentRevision,version,content:body.p_content,citations:body.p_citations,checks_passed:body.p_checks_passed,
        source_conflict:body.p_source_conflict,unsupported_claims:body.p_unsupported_claims,injection_detected:body.p_injection_detected}];
      historyItems=[{revision_id:currentRevision,revision_number:version,title:(body.p_content as typeof content).title,change_note:body.p_reason,created_by:id,
        created_at:`2026-09-21T0${version}:00:00Z`,is_current:true,is_published:false,reviews:[]},...historyItems.map((entry:any)=>({...entry,is_current:false}))];
      return route.fulfill({json:{id,slug:'manual-story',revision_id:currentRevision,version}});
    }
    return route.fulfill({status:404,json:{message:'unexpected request'}});
  });
  await page.goto('/admin/');
  await page.getByLabel('อีเมล',{exact:true}).fill('editor@fixture.invalid');
  await page.getByLabel('รหัสผ่าน',{exact:true}).fill('fixture-only-password');
  await page.getByRole('button',{name:'เข้าสู่ระบบ',exact:true}).click();
  await page.getByRole('button',{name:'สร้างร่างข่าว',exact:true}).click();
  await page.getByLabel('Slug ภาษาอังกฤษ').fill('manual-story');
  await page.getByLabel('หัวข้อ').fill('ร่างข่าวจากบรรณาธิการ');
  await page.getByLabel('สรุป').fill('สรุปข่าวที่เขียนและตรวจด้วยตนเอง');
  await page.getByLabel('หมวดหมู่').fill('เครื่องมือ');
  await page.getByLabel('ทำไมสำคัญ').fill('ช่วยให้นักพัฒนาตัดสินใจจากหลักฐาน');
  await page.getByLabel('เกี่ยวข้องกับใคร').fill('นักพัฒนา');
  await page.getByLabel('แท็ก คั่นด้วยจุลภาค').fill('Manual, TypeScript');
  await page.getByLabel('ชื่อแหล่ง').fill('เอกสารต้นฉบับ');
  await page.getByLabel('URL',{exact:true}).fill('https://example.com/manual');
  await page.getByLabel('ตรวจแหล่งแล้ว').check();
  await page.getByLabel('ตรวจเนื้อหาและข้อเท็จจริงครบ').check();
  await page.getByLabel('เหตุผลที่สร้างหรือแก้ร่าง').fill('สร้างจากเอกสารต้นฉบับ');
  await page.getByRole('button',{name:'บันทึกเป็น revision ใหม่'}).click();
  await expect(page.getByRole('heading',{level:2,name:'ร่างข่าวจากบรรณาธิการ'})).toBeVisible();
  await expect(page.getByText('สร้างจากเอกสารต้นฉบับ')).toBeVisible();
  await page.getByRole('button',{name:'แก้ร่าง'}).click();
  await expect(page.getByLabel('ตรวจแหล่งแล้ว')).not.toBeChecked();
  await expect(page.getByLabel('ตรวจเนื้อหาและข้อเท็จจริงครบ')).not.toBeChecked();
  await page.getByLabel('หัวข้อ').fill('ร่างข่าวฉบับแก้ไข');
  await page.getByLabel('เหตุผลที่สร้างหรือแก้ร่าง').fill('แก้หัวข้อให้อ่านชัดขึ้น');
  await page.getByRole('button',{name:'บันทึกเป็น revision ใหม่'}).click();
  await expect(page.getByRole('heading',{level:2,name:'ร่างข่าวฉบับแก้ไข'})).toBeVisible();
  await expect(page.getByText('Revision 2')).toBeVisible();
  await expect(page.getByText('แก้หัวข้อให้อ่านชัดขึ้น')).toBeVisible();
  expect(saves).toHaveLength(2);
  expect(saves[0]).toMatchObject({p_story_id:null,p_expected_version:null,p_slug:'manual-story',p_checks_passed:true});
  expect(saves[1]).toMatchObject({p_story_id:id,p_expected_version:1,p_slug:'manual-story',p_checks_passed:false,p_citations:[{verified:false}]});
  await page.screenshot({path:`.leancode/${testInfo.project.name}-supabase-draft.png`,fullPage:true});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});

test('empty and failed Supabase responses never show mock news',async({page})=>{
  let fail=false;
  await page.route('https://fixture.supabase.co/**',route=>route.fulfill({status:fail?503:200,json:fail?{message:'unavailable'}:[]}));
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'ยังไม่มีข่าวเผยแพร่'})).toBeVisible();
  await expect(page.getByText('เมื่อ AI ไม่ได้แค่ตอบคำถาม แต่เริ่มช่วยเราทำงานจนเสร็จ')).toHaveCount(0);
  fail=true;await page.getByRole('button',{name:'โหลดข่าวใหม่'}).click();
  await expect(page.getByRole('heading',{name:'ยังโหลดข่าวไม่ได้'})).toBeVisible();
});
