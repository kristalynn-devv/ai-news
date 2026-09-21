'use client';
import { useEffect, useState } from 'react';
import { AdminNav } from './shared';
import { DraftEditor } from './draft-editor';
import { getBackend } from '@/lib/backend';
import type { DraftInput, HistoryEntry, QueueStory, ReviewAction } from '@/lib/contracts';
const labels: Record<string,string> = { pending:'รอตรวจ', published:'เผยแพร่แล้ว', rejected:'ปฏิเสธ', withdrawn:'ถอนเผยแพร่', excluded:'ตัดออก' };
export function LiveEditorial() {
  const [items, setItems] = useState<QueueStory[]>([]);
  const [selected, setSelected] = useState('');
  const [status, setStatus] = useState('pending');
  const [offset, setOffset] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [editing, setEditing] = useState<'new'|QueueStory|null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyBusy, setHistoryBusy] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyRefresh, setHistoryRefresh] = useState(0);
  useEffect(() => {
    let active = true; setBusy(true); setItems([]); setReason('');
    getBackend().queue(status, offset).then(data => { if (active) { setItems(data); setSelected(current => data.some(item => item.id === current) ? current : data[0]?.id ?? ''); } })
      .catch(() => { if (active) setMessage('อ่านคิวไม่ได้ กรุณาตรวจสิทธิ์หรือเข้าสู่ระบบใหม่'); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [status, offset, refresh]);
  const item = items.find(x => x.id === selected);
  useEffect(() => {
    if (!item) { setHistory([]); setHistoryError(''); return; }
    let active=true;setHistoryBusy(true);setHistoryError('');
    getBackend().history(item.id).then(data=>{if(active)setHistory(data);}).catch(()=>{if(active){setHistory([]);setHistoryError('อ่านประวัติไม่ได้ กรุณาตรวจสิทธิ์หรือโหลดใหม่');}}).finally(()=>{if(active)setHistoryBusy(false);});
    return ()=>{active=false;};
  },[item?.id,item?.revision_id,refresh,historyRefresh]);
  async function decide(action: ReviewAction) {
    if (!item) return;
    setBusy(true); setMessage('');
    try { await getBackend().review(item, action, reason); setReason(''); setMessage('บันทึกการตัดสินและประวัติแล้ว'); setRefresh(x => x + 1); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ'); }
    finally { setBusy(false); }
  }
  async function saveDraft(draft:DraftInput) {
    setBusy(true);setMessage('');
    try { await getBackend().saveDraft(draft); setEditing(null); setStatus('pending'); setOffset(0); setMessage('บันทึก revision ใหม่และส่งเข้าคิวตรวจแล้ว'); setRefresh(x=>x+1); }
    finally { setBusy(false); }
  }
  return <main id="main" className="shell admin-page"><AdminNav/><div className="admin-heading"><div><span className="eyebrow">EDITORIAL WORKSPACE</span><h1>โต๊ะบรรณาธิการ<span className="blue">.</span></h1><p>ตรวจต้นฉบับก่อนอนุมัติ · การตัดสินบันทึกในฐานข้อมูล</p></div></div>
    <div className="alert alert-info alert-soft">AI และ scheduler ยังปิดอยู่ · หน้านี้ใช้การตรวจด้วยตนเอง</div>
    <div className="flex flex-wrap gap-3 py-4"><button className="btn btn-primary" disabled={busy} onClick={()=>setEditing('new')}>สร้างร่างข่าว</button><label>สถานะ <select className="select select-bordered" value={status} disabled={busy} onChange={e => {setStatus(e.target.value);setOffset(0);setEditing(null);}}>{Object.entries(labels).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="btn btn-outline" disabled={busy} onClick={() => setRefresh(x => x + 1)}>โหลดคิวใหม่</button></div>
    {message && <p role="status" className="alert alert-soft">{message}</p>}
    {editing && <div className="mb-6"><DraftEditor key={editing==='new'?'new':editing.revision_id} story={editing==='new'?undefined:editing} busy={busy} onCancel={()=>setEditing(null)} onSave={saveDraft}/></div>}
    {busy ? <p role="status">กำลังโหลดหรือบันทึก…</p> : !items.length ? <div className="empty-state"><h2>ไม่มีข่าวในหน้านี้</h2><p>ยังไม่มีรายการสถานะ {labels[status]}</p></div> : <div className="review-grid">
      <div className="queue-list">{items.map(x => <button className={`queue-item ${selected===x.id?'selected':''}`} key={x.id} onClick={() => {setSelected(x.id);setReason('');}}><span className="badge badge-outline">{labels[x.status]}</span><h3>{x.content.title}</h3><p>นโยบาย {x.policy_version ?? 'ยังไม่ประเมิน'} · เวอร์ชัน {x.version}</p></button>)}</div>
      {item && <section className="review-detail"><h2>{item.content.title}</h2><p>{item.content.summary}</p><h3>ทำไมสำคัญ</h3><p>{item.content.why}</p><h3>เกี่ยวข้องกับใคร</h3><p>{item.content.audience}</p>
        {item.content.technical && <><h3>ผลต่อนักพัฒนา</h3><p>{item.content.technical.impact}</p><ol>{item.content.technical.steps.map((s,i)=><li key={i}>{s}</li>)}</ol><p>{item.content.technical.caveat}</p></>}
        {item.status==='pending' && item.has_publication && <p className="alert alert-info">ร่างแก้ไขรอตรวจ · ข่าวฉบับเดิมยังเผยแพร่อยู่</p>}<h3>แหล่งอ้างอิง</h3><ul>{item.citations.map(c => <li key={c.url}><a href={c.url} target="_blank" rel="noopener noreferrer" className="link">{c.label}</a> · {c.verified?'ตรวจแหล่งแล้ว':'ยังไม่ตรวจ'} · {c.source_published_at ? new Date(c.source_published_at).toLocaleDateString('th-TH',{timeZone:'Asia/Bangkok'}) : 'ไม่ทราบวันที่'}</li>)}</ul>
        {(!item.checks_passed || item.source_conflict || item.unsupported_claims || item.injection_detected) && <p className="alert alert-warning">ยังไม่ผ่านการตรวจความปลอดภัยหรือหลักฐาน ต้องแก้ร่างก่อนอนุมัติ</p>}
        <label className="block py-4">เหตุผลการตัดสิน<textarea className="textarea textarea-bordered w-full" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)}/></label>
        <div className="flex flex-wrap gap-2">{(item.status==='pending'||item.status==='published') && <button className="btn btn-outline" onClick={()=>setEditing(item)}>แก้ร่าง</button>}{item.status==='pending' && <button disabled={!reason.trim()} className="btn btn-primary" onClick={() => decide('approve')}>อนุมัติเผยแพร่</button>}{item.status==='pending' && <button disabled={!reason.trim()} className="btn btn-outline" onClick={() => decide('reject')}>ปฏิเสธ</button>}{item.has_publication && <button disabled={!reason.trim()} className="btn btn-error" onClick={() => decide('withdraw')}>ถอนเผยแพร่</button>}{['rejected','withdrawn','excluded'].includes(item.status) && <button disabled={!reason.trim()} className="btn btn-outline" onClick={() => decide('reopen')}>เปิดตรวจใหม่</button>}</div>
        <div className="divider">ประวัติ revision และการตรวจ</div>{historyBusy?<p role="status">กำลังโหลดประวัติ…</p>:historyError?<div role="alert" className="alert alert-error alert-soft"><span>{historyError}</span><button className="btn btn-outline btn-sm" onClick={()=>setHistoryRefresh(x=>x+1)}>ลองใหม่</button></div>:<ol className="space-y-3">{history.map(entry=><li key={entry.revision_id} className="rounded border border-base-300 p-3"><div className="flex flex-wrap gap-2"><strong>Revision {entry.revision_number}</strong>{entry.is_current&&<span className="badge badge-info badge-sm">ฉบับปัจจุบัน</span>}{entry.is_published&&<span className="badge badge-success badge-sm">ฉบับเผยแพร่</span>}</div><p className="mt-1 text-sm">{entry.title}</p><p className="mt-1 text-xs text-base-content/65">{entry.change_note} · {new Date(entry.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})}</p>{entry.reviews.map((review,index)=><p className="mt-2 border-l-2 border-base-300 pl-2 text-xs" key={`${review.created_at}-${index}`}>{labels[review.decision]??review.decision}: {review.reason}</p>)}</li>)}</ol>}
      </section>}
    </div>}
    <div className="flex gap-3 py-6"><button className="btn btn-outline" disabled={busy||offset===0} onClick={()=>setOffset(x=>Math.max(0,x-50))}>หน้าก่อน</button><button className="btn btn-outline" disabled={busy||items.length<50} onClick={()=>setOffset(x=>x+50)}>หน้าถัดไป</button></div>
  </main>;
}
export function InactiveBackendPage({title}:{title:string}) { return <main id="main" className="shell admin-page"><AdminNav/><h1>{title}</h1><div className="alert alert-info">ยังไม่เปิด AI provider, credentials หรือ pipeline · ไม่มีการเรียก AI และไม่มีรายงาน usage จริงให้แสดง</div></main>; }
