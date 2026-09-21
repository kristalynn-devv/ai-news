'use client';
import { useState, type FormEvent } from 'react';
import { draftInputSchema, type DraftInput, type QueueStory } from '@/lib/contracts';

type FormCitation = { label: string; url: string; sourceDate: string; verified: boolean };
type FormState = {
  slug: string; title: string; summary: string; category: string; type: DraftInput['content']['type']; why: string;
  audience: string; tags: string; read: string; art: DraftInput['content']['art']; technical: boolean;
  impact: string; steps: string; caveat: string; citations: FormCitation[]; checksPassed: boolean;
  sourceConflict: boolean; unsupportedClaims: boolean; injectionDetected: boolean; reason: string;
};

function initialState(story?: QueueStory): FormState {
  const content = story?.content;
  return {
    slug: story?.slug ?? '', title: content?.title ?? '', summary: content?.summary ?? '', category: content?.category ?? '',
    type: content?.type ?? 'ข่าว', why: content?.why ?? '', audience: content?.audience ?? '', tags: content?.tags.join(', ') ?? '',
    read: String(content?.read ?? 3), art: content?.art ?? 'human', technical: Boolean(content?.technical),
    impact: content?.technical?.impact ?? '', steps: content?.technical?.steps.join('\n') ?? '', caveat: content?.technical?.caveat ?? '',
    citations: story?.citations.map(c => ({ label:c.label, url:c.url, sourceDate:c.source_published_at?.slice(0,16) ?? '', verified:false }))
      ?? [{ label:'', url:'', sourceDate:'', verified:false }],
    checksPassed: false, sourceConflict: story?.source_conflict ?? false,
    unsupportedClaims: story?.unsupported_claims ?? false, injectionDetected: story?.injection_detected ?? false, reason: '',
  };
}
function citationDate(value:string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toISOString();
}

export function DraftEditor({ story, busy, onCancel, onSave }:{
  story?: QueueStory; busy:boolean; onCancel:()=>void; onSave:(draft:DraftInput)=>Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(() => initialState(story));
  const [error, setError] = useState('');
  const set = <K extends keyof FormState>(key:K, value:FormState[K]) => setForm(old => ({...old,[key]:value}));
  const setCitation = <K extends keyof FormCitation>(index:number,key:K,value:FormCitation[K]) => setForm(old => ({
    ...old,citations:old.citations.map((citation,i)=>i===index?{...citation,[key]:value}:citation),
  }));
  async function submit(event:FormEvent) {
    event.preventDefault(); setError('');
    const technical = form.technical ? { impact:form.impact, steps:form.steps.split('\n').map(x=>x.trim()).filter(Boolean), caveat:form.caveat } : undefined;
    const parsed = draftInputSchema.safeParse({
      storyId:story?.id ?? null, expectedVersion:story?.version ?? null, slug:form.slug.trim(),
      content:{ title:form.title, summary:form.summary, category:form.category, type:form.type, why:form.why,
        audience:form.audience, tags:[...new Set(form.tags.split(',').map(x=>x.trim()).filter(Boolean))],
        read:Number(form.read), art:form.art, ...(technical ? {technical}: {}) },
      citations:form.citations.map(c=>({label:c.label,url:c.url,source_published_at:citationDate(c.sourceDate),verified:c.verified})),
      checksPassed:form.checksPassed, sourceConflict:form.sourceConflict, unsupportedClaims:form.unsupportedClaims,
      injectionDetected:form.injectionDetected, reason:form.reason,
    });
    if (!parsed.success) { setError('ตรวจช่องที่จำเป็น รูปแบบ slug, URL, วันที่ และจำนวนคำอ่านอีกครั้ง'); return; }
    try { await onSave(parsed.data); } catch (cause) { setError(cause instanceof Error ? cause.message : 'บันทึกร่างไม่สำเร็จ'); }
  }
  return <form className="card border border-base-300 bg-base-100 p-5 md:p-7" onSubmit={submit}>
    <div className="flex flex-wrap items-start justify-between gap-3"><div><span className="eyebrow">MANUAL DRAFT</span><h2 className="text-2xl">{story?'แก้ร่างข่าว':'สร้างร่างข่าว'}</h2><p className="mt-2 text-sm text-base-content/65">ทุกครั้งที่บันทึกจะสร้าง revision ใหม่และส่งเข้าคิวตรวจ</p></div><button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>ปิดแบบฟอร์ม</button></div>
    {story?.has_publication && <div className="alert alert-info alert-soft mt-4">ฉบับที่เผยแพร่จะยังอยู่เหมือนเดิมจนกว่าร่างนี้จะอนุมัติ</div>}
    <div className="grid gap-4 py-5 md:grid-cols-2">
      <label>Slug ภาษาอังกฤษ<input className="input input-bordered w-full" value={form.slug} disabled={Boolean(story)} required maxLength={120} pattern="[a-z0-9]+(-[a-z0-9]+)*" onChange={e=>set('slug',e.target.value)}/></label>
      <label>หัวข้อ<input className="input input-bordered w-full" value={form.title} required maxLength={300} onChange={e=>set('title',e.target.value)}/></label>
      <label className="md:col-span-2">สรุป<textarea className="textarea textarea-bordered w-full" rows={3} value={form.summary} required maxLength={4000} onChange={e=>set('summary',e.target.value)}/></label>
      <label>หมวดหมู่<input className="input input-bordered w-full" value={form.category} required maxLength={100} onChange={e=>set('category',e.target.value)}/></label>
      <label>ประเภท<select className="select select-bordered w-full" value={form.type} onChange={e=>set('type',e.target.value as FormState['type'])}>{['ข่าว','ความคิดเห็น','งานวิจัย','ประกาศบริษัท','แนวปฏิบัติ'].map(x=><option key={x}>{x}</option>)}</select></label>
      <label className="md:col-span-2">ทำไมสำคัญ<textarea className="textarea textarea-bordered w-full" rows={2} value={form.why} required maxLength={4000} onChange={e=>set('why',e.target.value)}/></label>
      <label>เกี่ยวข้องกับใคร<input className="input input-bordered w-full" value={form.audience} required maxLength={4000} onChange={e=>set('audience',e.target.value)}/></label>
      <label>แท็ก คั่นด้วยจุลภาค<input className="input input-bordered w-full" value={form.tags} onChange={e=>set('tags',e.target.value)}/></label>
      <label>เวลาอ่าน (นาที)<input className="input input-bordered w-full" type="number" min={1} max={60} step={1} value={form.read} required onChange={e=>set('read',e.target.value)}/></label>
      <label>ภาพประกอบ<select className="select select-bordered w-full" value={form.art} onChange={e=>set('art',e.target.value as FormState['art'])}>{['orbit','model','context','human','workflow','release'].map(x=><option key={x}>{x}</option>)}</select></label>
    </div>
    <label className="flex items-center gap-3"><input className="checkbox" type="checkbox" checked={form.technical} onChange={e=>set('technical',e.target.checked)}/>เพิ่มมุมมองนักพัฒนา</label>
    {form.technical && <div className="grid gap-4 py-4 md:grid-cols-2"><label className="md:col-span-2">ผลกระทบ<input className="input input-bordered w-full" value={form.impact} required onChange={e=>set('impact',e.target.value)}/></label><label className="md:col-span-2">ขั้นตอน หนึ่งบรรทัดต่อข้อ<textarea className="textarea textarea-bordered w-full" rows={3} value={form.steps} required onChange={e=>set('steps',e.target.value)}/></label><label className="md:col-span-2">ข้อควรระวัง<input className="input input-bordered w-full" value={form.caveat} required onChange={e=>set('caveat',e.target.value)}/></label></div>}
    <div className="divider">แหล่งอ้างอิง</div>
    <div className="space-y-4">{form.citations.map((citation,index)=><fieldset key={index} className="rounded border border-base-300 p-4"><legend className="px-2 text-sm">แหล่งที่ {index+1}</legend><div className="grid gap-3 md:grid-cols-2"><label>ชื่อแหล่ง<input className="input input-bordered w-full" value={citation.label} required maxLength={300} onChange={e=>setCitation(index,'label',e.target.value)}/></label><label>URL<input className="input input-bordered w-full" type="url" value={citation.url} required maxLength={2048} onChange={e=>setCitation(index,'url',e.target.value)}/></label><label>วันที่ต้นฉบับ (ถ้าทราบ)<input className="input input-bordered w-full" type="datetime-local" value={citation.sourceDate} onChange={e=>setCitation(index,'sourceDate',e.target.value)}/></label><label className="flex items-center gap-3 self-end py-3"><input className="checkbox" type="checkbox" checked={citation.verified} onChange={e=>setCitation(index,'verified',e.target.checked)}/>ตรวจแหล่งแล้ว</label></div>{form.citations.length>1&&<button type="button" className="btn btn-ghost btn-sm mt-2 text-error" onClick={()=>set('citations',form.citations.filter((_,i)=>i!==index))}>ลบแหล่งนี้</button>}</fieldset>)}</div>
    <button type="button" className="btn btn-outline btn-sm mt-4 self-start" disabled={form.citations.length>=100} onClick={()=>set('citations',[...form.citations,{label:'',url:'',sourceDate:'',verified:false}])}>เพิ่มแหล่งอ้างอิง</button>
    <div className="divider">ผลการตรวจ</div>
    <div className="grid gap-3 md:grid-cols-2"><label className="flex items-center gap-3"><input className="checkbox" type="checkbox" checked={form.checksPassed} onChange={e=>set('checksPassed',e.target.checked)}/>ตรวจเนื้อหาและข้อเท็จจริงครบ</label><label className="flex items-center gap-3"><input className="checkbox" type="checkbox" checked={form.sourceConflict} onChange={e=>set('sourceConflict',e.target.checked)}/>พบข้อมูลขัดแย้ง</label><label className="flex items-center gap-3"><input className="checkbox" type="checkbox" checked={form.unsupportedClaims} onChange={e=>set('unsupportedClaims',e.target.checked)}/>มีข้อความที่ยังไม่มีหลักฐาน</label><label className="flex items-center gap-3"><input className="checkbox" type="checkbox" checked={form.injectionDetected} onChange={e=>set('injectionDetected',e.target.checked)}/>พบคำสั่งแฝงในต้นฉบับ</label></div>
    <label className="mt-5">เหตุผลที่สร้างหรือแก้ร่าง<textarea className="textarea textarea-bordered w-full" rows={3} value={form.reason} required maxLength={1000} onChange={e=>set('reason',e.target.value)} placeholder="สรุปสิ่งที่เปลี่ยนและหลักฐานที่ตรวจ"/></label>
    {error&&<p role="alert" className="alert alert-error alert-soft mt-4">{error}</p>}
    <div className="mt-5 flex flex-wrap gap-3"><button className="btn btn-primary" type="submit" disabled={busy}>{busy?'กำลังบันทึก…':'บันทึกเป็น revision ใหม่'}</button><button className="btn btn-outline" type="button" disabled={busy} onClick={onCancel}>ยกเลิก</button></div>
  </form>;
}
