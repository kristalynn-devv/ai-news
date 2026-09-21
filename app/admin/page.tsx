'use client';
import { appConfig } from '@/lib/env';
import { LiveEditorial } from '@/components/live-editorial';

import { useState } from 'react';
import { Check, ChevronRight, FileText, Filter, Pause, Play, RotateCcw, ShieldCheck, X } from 'lucide-react';
import { AdminNav, DemoNote } from '@/components/shared';
import { useDemo } from '@/components/state';
import { evaluate, statusLabels, type Mode, type ReviewStatus } from '@/lib/data';

const selectClass = 'select select-bordered select-sm';

function DemoAdmin() {
  const { queue, setQueue, mode, setMode, stopped, setStopped, audit, log, notify } = useDemo();
  const [status, setStatus] = useState('all');
  const [source, setSource] = useState('all');
  const [category, setCategory] = useState('all');
  const [selected, setSelected] = useState('q1');
  const [reason, setReason] = useState('');
  const [keyword, setKeyword] = useState('');
  const [results, setResults] = useState<{ id: string; result: string }[]>([]);
  const [runState, setRunState] = useState('ยังไม่จำลองรอบ');
  const visible = queue.filter((item) => (status === 'all' || item.status === status) && (source === 'all' || item.source === source) && (category === 'all' || item.category === category));
  const item = visible.find((entry) => entry.id === selected) || visible[0];

  function decide(next: ReviewStatus) {
    if (!item) return;
    if ((next === 'rejected' || next === 'withdrawn') && !reason.trim()) {
      notify('กรุณาระบุเหตุผลก่อนปฏิเสธหรือถอนเผยแพร่');
      return;
    }
    setQueue((old) => old.map((entry) => entry.id === item.id ? { ...entry, status: next, reason: reason.trim() || 'Demo Admin ตรวจและอนุมัติในต้นแบบ' } : entry));
    log(`${statusLabels[next]} ${item.id}: ${reason.trim() || 'ตรวจและอนุมัติจำลอง'}`);
    setReason('');
    setResults([]);
    notify(`${statusLabels[next]}แล้ว · มีผลในต้นแบบเท่านั้น`);
  }

  function changeMode(next: Mode) {
    setMode(next);
    setResults([]);
    log(`เปลี่ยนโหมดเป็น ${next} · ไม่มีผลกับร่างเก่า`);
  }

  function dryRun() {
    setResults(queue.map((entry) => ({ id: entry.id, result: evaluate(entry, mode, stopped, keyword) })));
    log(`ทดลองกฎ ${mode} · ไม่เผยแพร่ · ไม่มี usage จริง`);
  }

  function simulate() {
    setQueue(queue.map((entry) => {
      const result = evaluate(entry, mode, stopped, keyword);
      if (result.startsWith('ผ่าน')) return { ...entry, status: 'published' as const, reason: `ผ่านนโยบาย ${mode} ในรอบจำลอง` };
      if (result.startsWith('ตัดออก')) return { ...entry, status: 'excluded' as const, reason: result };
      return entry;
    }));
    setResults([]);
    setRunState('success จำลอง · ประเมินรายการค้างแล้ว');
    log(`ประเมินรายการค้าง ${mode}${stopped ? ' · Auto ถูกหยุด' : ''}`);
    notify('จบรอบจำลอง · ไม่มีการดึงข้อมูลหรือเรียก AI');
  }

  return <main id="main" className="shell admin-page">
    <AdminNav />
    <div className="admin-heading">
      <div><span className="eyebrow">EDITORIAL WORKSPACE</span><h1>โต๊ะบรรณาธิการ<span className="blue">.</span></h1><p>คัดเรื่องที่มีคุณค่า พร้อมเหตุผลที่ตรวจสอบได้</p></div>
      <span className="badge badge-outline sandbox-pill"><ShieldCheck size={15} /> Demo Admin · ไม่มีระบบล็อกอิน</span>
    </div>
    <DemoNote>Sandbox · การอนุมัติ/ปฏิเสธมีผลเฉพาะคิวจำลองและรีเซ็ตเมื่อรีเฟรช ไม่เปลี่ยนข่าวตัวอย่างหน้าอ่าน</DemoNote>

    <div className="stats stats-grid">
      <div className="stat"><span>รอตรวจ</span><strong>{queue.filter((entry) => entry.status === 'pending').length.toString().padStart(2, '0')}</strong><small>รายการในคิวจำลอง</small></div>
      <div className="stat"><span>เผยแพร่จำลอง</span><strong>{queue.filter((entry) => entry.status === 'published').length.toString().padStart(2, '0')}</strong><small>ยังไม่มีข่าวเผยแพร่จริง</small></div>
      <div className="stat"><span>โหมดปัจจุบัน</span><strong className="text-stat">{mode}</strong><small>{stopped ? 'หยุด Auto ทั้งระบบ' : 'เปลี่ยนโหมดแล้วต้องประเมินใหม่'}</small></div>
      <div className="stat"><span>ตารางตามแผน</span><strong className="text-stat">07:00 / 19:00</strong><small>Asia/Bangkok · cron ยังไม่ทำงาน</small></div>
    </div>

    <section className="card bg-base-100 policy-panel">
      <div className="policy-top">
        <div><h2>นโยบายการคัดข่าว</h2><p>กฎตัวอย่าง v1 · แยกการคัดเลือกออกจากการเผยแพร่</p></div>
        <button className={`btn btn-outline btn-sm plain-button ${stopped ? 'danger-text' : ''}`} onClick={() => { setStopped(!stopped); setResults([]); log(stopped ? 'คืนการทำงาน Auto จำลอง' : 'หยุด Auto ทั้งระบบ'); }}>{stopped ? <Play size={15} /> : <Pause size={15} />} {stopped ? 'คืน Auto จำลอง' : 'หยุด Auto ทั้งระบบ'}</button>
      </div>
      <div className="mode-options">{(['Manual', 'Hybrid', 'Auto'] as Mode[]).map((itemMode) => <button key={itemMode} className={`btn btn-ghost ${mode === itemMode ? 'btn-active selected' : ''}`} aria-pressed={mode === itemMode} onClick={() => changeMode(itemMode)}><span className="radio-dot" /><div><strong>{itemMode}</strong><small>{itemMode === 'Manual' ? 'ตรวจเองทุกรายการ · ค่าเริ่มต้น' : itemMode === 'Hybrid' ? 'Official: Auto / Community: Manual' : 'ผ่านเกณฑ์จึงเผยแพร่จำลอง'}</small></div></button>)}</div>
      <div className="policy-controls">
        <label>คำสำคัญที่ต้องมีในหัวข้อ/เนื้อหา<input className="input input-bordered input-sm" value={keyword} onChange={(event) => { setKeyword(event.target.value); setResults([]); }} placeholder="เช่น Context (เว้นว่างเพื่อรับทุกเรื่อง)" /></label>
        <button className="btn btn-outline btn-sm plain-button" onClick={dryRun}><Filter size={15} /> ทดลองกฎ</button>
        <button className="btn btn-primary btn-sm primary-button" onClick={simulate}><Play size={15} /> ประเมินรายการค้างจำลอง</button>
      </div>
      <small className="muted">รายการไม่ปลอดภัยรอตรวจเสมอ · รายการปฏิเสธ/ถอนคงสถานะเดิม · เปลี่ยนโหมดไม่เผยแพร่ย้อนหลัง</small>
      {results.length > 0 && <div className="rule-results" aria-live="polite"><h3>ผลทดลอง · ยังไม่มีการเปลี่ยนสถานะ</h3>{results.map((result) => <div key={result.id}><span>{queue.find((entry) => entry.id === result.id)?.title}</span><strong>{result.result}</strong></div>)}</div>}
    </section>

    <div className="queue-heading">
      <h2>คิวข่าว <span className="badge badge-neutral badge-sm count-pill">{visible.length}</span></h2>
      <div className="queue-filters">
        <label><span className="sr-only">กรองสถานะ</span><select className={selectClass} aria-label="กรองสถานะ" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">ทุกสถานะ</option>{Object.entries(statusLabels).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
        <label><span className="sr-only">กรองแหล่งข่าว</span><select className={selectClass} aria-label="กรองแหล่งข่าว" value={source} onChange={(event) => setSource(event.target.value)}><option value="all">ทุกแหล่งข่าว</option>{Array.from(new Set(queue.map((entry) => entry.source))).map((entrySource) => <option key={entrySource}>{entrySource}</option>)}</select></label>
        <select className={selectClass} aria-label="กรองหมวดหมู่" value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">ทุกหมวดหมู่</option>{Array.from(new Set(queue.map((entry) => entry.category))).map((entryCategory) => <option key={entryCategory}>{entryCategory}</option>)}</select>
      </div>
    </div>

    <div className="review-grid">
      <div className="queue-list">
        {visible.length === 0 && <div className="empty-state"><FileText /><h3>ไม่มีรายการในตัวกรองนี้</h3><button className="btn btn-outline btn-sm plain-button" onClick={() => { setStatus('all'); setSource('all'); setCategory('all'); }}>ล้างตัวกรอง</button></div>}
        {visible.map((entry) => <button className={`queue-item ${item?.id === entry.id ? 'selected' : ''}`} key={entry.id} onClick={() => { setSelected(entry.id); setReason(''); }}><div className="queue-item-meta"><span>{entry.source}</span><span className={`badge badge-sm queue-status status-${entry.status}`}>{statusLabels[entry.status]}</span></div><h3>{entry.title}</h3><p>{entry.reason}</p><span className="queue-open">ตรวจรายละเอียด <ChevronRight size={14} /></span></button>)}
      </div>
      <section className="review-detail">{item ? <>
        <div className="story-kicker">DRAFT REVIEW <span>#{item.id} · นโยบาย v1</span></div><h2>{item.title}</h2>
        <div className="review-source"><h3>ต้นฉบับจำลอง</h3><p>{item.original}</p><small>ไม่มีลิงก์ต้นฉบับจริง</small></div>
        <h3>ร่างเรียบเรียง</h3><p>{item.draft}</p><div className="alert alert-warning alert-soft caution"><div><strong>เหตุผลการคัด</strong><p>{item.reason}</p></div></div>
        {item.status === 'pending' || item.status === 'published' ? <><label className="reason-label">เหตุผลการตัดสิน <small>(ต้องระบุเมื่อปฏิเสธ/ถอน)</small><textarea className="textarea textarea-bordered" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="บันทึกสิ่งที่ตรวจพบ…" rows={3} /></label><div className="review-actions">{item.status === 'pending' ? <><button className="btn btn-primary btn-sm primary-button" onClick={() => decide('published')}><Check size={16} /> อนุมัติจำลอง</button><button className="btn btn-outline btn-sm plain-button danger-text" onClick={() => decide('rejected')}><X size={16} /> ปฏิเสธ</button></> : <button className="btn btn-outline btn-sm plain-button danger-text" onClick={() => decide('withdrawn')}>ถอนเผยแพร่จำลอง</button>}</div></> : <p className="muted">รายการนี้คงสถานะเดิมเมื่อประเมินรอบใหม่</p>}
      </> : <p className="muted">เลือกรายการเพื่ออ่านร่างและเหตุผล</p>}</section>
    </div>

    <div className="admin-bottom">
      <section className="card bg-base-100 panel"><h2>สถานะรอบจำลอง</h2><p>{runState}</p><small>เวลาอัปเดตสำเร็จตัวอย่าง: 20 ก.ย. 2569 07:00 น.</small><p className="muted">เวลาเริ่มรอบตามแผน: 07:00 / 19:00 Asia/Bangkok</p><button className="btn btn-outline btn-sm plain-button" onClick={() => { setRunState('failed จำลอง · แหล่งตัวอย่างตอบกลับผิดพลาด · คงข่าวและเวลาอัปเดตเดิม'); log('ทดลองรอบล้มเหลว · คงข้อมูลเดิม'); }}><RotateCcw size={14} /> ทดลองรอบล้มเหลว</button></section>
      <section className="card bg-base-100 panel"><h2>Audit log <span className="badge badge-outline badge-sm pill">จำลอง</span></h2><div className="audit-log">{audit.length ? audit.map((entry, index) => <p key={index}>{entry}</p>) : <p className="muted">การเปลี่ยนโหมดและการตัดสินข่าวจะแสดงที่นี่</p>}</div></section>
    </div>
  </main>;
}

export default function Admin() { return appConfig.source === 'supabase' ? <LiveEditorial/> : <DemoAdmin/>; }
