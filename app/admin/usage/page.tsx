'use client';
import { appConfig } from '@/lib/env';
import { InactiveBackendPage } from '@/components/live-editorial';

import { useState } from 'react';
import { CircleDollarSign, Info, Save } from 'lucide-react';
import { AdminNav, DemoNote } from '@/components/shared';
import { useDemo } from '@/components/state';

const usage = [
  { id: 'demo-001', agent: 'คัดข่าว', model: 'demo-small', input: 42000, output: 3000, cost: 0.024, quality: 'provider-reported (จำลอง)' },
  { id: 'demo-002', agent: 'เรียบเรียง', model: 'demo-balanced', input: 68000, output: 17000, cost: 0.238, quality: 'estimated (จำลอง)' },
  { id: 'demo-003', agent: 'ตรวจคุณภาพ', model: 'demo-balanced', input: 18000, output: 4000, cost: 0.072, quality: 'provider-reported (จำลอง)' },
  { id: 'demo-004', agent: 'ตรวจคุณภาพ', model: 'demo-balanced', input: null, output: null, cost: null, quality: 'unavailable (จำลอง)' },
];
const fieldClass = 'input input-bordered input-sm';

function DemoUsage() {
  const { notify, log } = useDemo();
  const [agent, setAgent] = useState('ทั้งหมด');
  const [budget, setBudget] = useState(10);
  const [draftBudget, setDraftBudget] = useState(10);
  const [perRun, setPerRun] = useState(1);
  const [alert, setAlert] = useState(80);
  const rows = usage.filter((item) => agent === 'ทั้งหมด' || item.agent === agent);
  const total = rows.reduce((sum, item) => sum + (item.cost ?? 0), 0);
  const unknown = rows.some((item) => item.cost === null);
  const percent = Math.min(100, 0.334 / budget * 100);

  return <main id="main" className="shell admin-page">
    <AdminNav />
    <div className="admin-heading">
      <div><span className="eyebrow">USAGE & BUDGET</span><h1>มองเห็นการใช้<span className="blue"> คุมได้ทั้งงบ</span></h1><p>หนึ่งข่าว สองมุมมอง นับ usage เพียงครั้งเดียว</p></div>
      <span className="badge badge-outline sandbox-pill"><CircleDollarSign size={15} /> USD · ข้อมูลจำลองเท่านั้น</span>
    </div>
    <DemoNote>Token ราคา และกราฟทั้งหมดเป็นตัวเลขสมมติ ไม่ใช่ usage จริงหรือราคาปัจจุบันของ provider · ไม่รวม IDE หรือบัญชีภายนอก</DemoNote>
    <div className="usage-toolbar"><span>รอบตัวอย่าง: 20 กันยายน 2569 · ฉบับเช้า 07:00</span><label>Agent <select className="select select-bordered select-sm" aria-label="กรอง Agent ในรายงาน" value={agent} onChange={(event) => setAgent(event.target.value)}>{['ทั้งหมด', 'คัดข่าว', 'เรียบเรียง', 'ตรวจคุณภาพ'].map((item) => <option key={item}>{item}</option>)}</select></label></div>
    <div className="stats stats-grid">
      <div className="stat"><span>ต้นทุนที่มีข้อมูล · จำลอง</span><strong>${total.toFixed(3)}</strong><small>{unknown ? '+ 1 invocation ยังไม่ทราบยอด' : 'ไม่ใช่บิลเรียกเก็บจริง'}</small></div>
      <div className="stat"><span>Input tokens · จำลอง</span><strong>{rows.reduce((sum, item) => sum + (item.input ?? 0), 0).toLocaleString()}</strong><small>{unknown ? 'ไม่รวมรายการ unavailable' : 'ยอดตามตัวกรอง'}</small></div>
      <div className="stat"><span>Output tokens · จำลอง</span><strong>{rows.reduce((sum, item) => sum + (item.output ?? 0), 0).toLocaleString()}</strong><small>ไม่บวก reasoning ซ้ำ</small></div>
      <div className="stat"><span>Invocations · จำลอง</span><strong>{rows.length.toString().padStart(2, '0')}</strong><small>นับตาม invocation ID ที่ไม่ซ้ำ</small></div>
    </div>
    <div className="usage-grid">
      <section className="card bg-base-100 panel"><div className="policy-top"><div><span className="eyebrow">COST BREAKDOWN</span><h2>ต้นทุนแต่ละขั้นตอน</h2></div><span className="badge badge-outline badge-sm pill">รอบตัวอย่าง</span></div><div className="bar-chart" aria-label="กราฟค่าใช้จ่ายจำลอง">{rows.filter((item) => item.cost !== null).map((item) => <div className="chart-row" key={item.id}><span>{item.agent}</span><div className="bar-track"><div style={{ width: `${(item.cost! / 0.25) * 100}%` }} /></div><strong>${item.cost!.toFixed(3)}</strong></div>)}</div><p className="muted">สัดส่วนจากยอดที่ทราบเท่านั้น ไม่แทนรายการ unavailable ด้วยศูนย์</p><div className="alert alert-soft usage-explainer"><Info size={18} /><p>นับต้นทุนร่วมที่ invocation เดียว แม้เรื่องนั้นแสดงทั้งหน้าอ่านทั่วไปและหน้านักพัฒนา</p></div></section>
      <section className="card bg-base-100 panel budget-panel"><span className="eyebrow">MONTHLY BUDGET · DEMO</span><h2>พื้นที่สำหรับงบประมาณ</h2><div className="budget-value">$0.334 <span>/ ${budget.toFixed(2)}</span></div><progress className="progress progress-primary" max="100" value={percent} /><p className={percent >= alert ? 'danger-text' : 'muted'}>{percent >= 100 ? 'ถึงเพดานจำลอง · ถ้าเป็นระบบจริงจะหยุดเริ่มงานใหม่' : percent >= alert ? 'ถึงระดับแจ้งเตือนจำลอง' : `ใช้ยอดที่ทราบ ${percent.toFixed(1)}% ของงบสมมติ`}</p><small>ยังมีรายการไม่ทราบยอด · ไม่ได้คำนวณวงเงินคงเหลือที่ใช้ได้จริง</small><hr /><form onSubmit={(event) => { event.preventDefault(); setBudget(draftBudget); log('บันทึกงบประมาณจำลอง'); notify('บันทึกงบจำลองแล้ว · ไม่มีผลกับบัญชี provider'); }}><div className="form-grid"><label>งบต่อเดือน (USD)<input className={fieldClass} type="number" min="0.01" step="0.01" required value={draftBudget} onChange={(event) => setDraftBudget(Number(event.target.value))} /></label><label>งบต่อรอบ (USD)<input className={fieldClass} type="number" min="0.01" step="0.01" required max={draftBudget} value={perRun} onChange={(event) => setPerRun(Number(event.target.value))} /></label><label>แจ้งเตือนที่ (%)<input className={fieldClass} type="number" min="1" max="100" required value={alert} onChange={(event) => setAlert(Number(event.target.value))} /></label><div className="budget-note">รีเซ็ตเดือนตาม<br /><strong>Asia/Bangkok</strong></div></div><button className="btn btn-primary btn-sm primary-button" type="submit"><Save size={15} /> บันทึกงบจำลอง</button></form></section>
    </div>
    <section className="ledger"><h2>Invocation ledger <span className="badge badge-outline badge-sm pill">ข้อมูลสมมติ</span></h2><div className="table-scroll"><table className="table table-sm"><thead><tr><th>Invocation / Agent</th><th>Model</th><th>Input / Output</th><th>สถานะข้อมูล</th><th>ต้นทุน USD</th></tr></thead><tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.agent}</strong><small>{item.id}</small></td><td><code>{item.model}</code></td><td>{item.input === null ? 'ไม่ทราบ' : `${item.input.toLocaleString()} / ${item.output?.toLocaleString()}`}</td><td><span className={`badge badge-sm pill ${item.cost === null ? 'badge-warning warning' : 'badge-outline'}`}>{item.quality}</span></td><td>{item.cost === null ? 'ไม่ทราบ' : `$${item.cost.toFixed(3)}`}</td></tr>)}</tbody></table></div><p className="muted">ตัวอย่างนี้ไม่มี cache/reasoning แยกรายการ · pricing snapshot: demo-v1 · ไม่แปลง THB · ค่าโฮสต์ไม่รวมในยอด</p></section>
  </main>;
}

export default function Usage() { return appConfig.source === 'supabase' ? <InactiveBackendPage title="Usage & Budget"/> : <DemoUsage/>; }
