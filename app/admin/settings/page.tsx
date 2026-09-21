'use client';
import { appConfig } from '@/lib/env';
import { InactiveBackendPage } from '@/components/live-editorial';

import { useState } from 'react';
import { Bot, Check, KeyRound, Plug, Save, ShieldCheck } from 'lucide-react';
import { AdminNav, DemoNote } from '@/components/shared';
import { useDemo } from '@/components/state';

const models = {
  'OpenAI (จำลอง)': ['demo-balanced', 'demo-small'],
  'Anthropic (จำลอง)': ['demo-reasoning', 'demo-fast'],
  'Google (จำลอง)': ['demo-flash', 'demo-pro'],
};
type Provider = keyof typeof models;
type AgentConfig = { provider: Provider; model: string; enabled: boolean; limit: number; timeout: number; retry: number };
const roles = ['คัดข่าว', 'เรียบเรียง', 'ตรวจคุณภาพ'];
const fieldClass = 'input input-bordered input-sm';
const selectClass = 'select select-bordered select-sm';

function DemoSettings() {
  const { notify, log } = useDemo();
  const [role, setRole] = useState('คัดข่าว');
  const [configs, setConfigs] = useState<Record<string, AgentConfig>>(
    Object.fromEntries(roles.map((item) => [item, {
      provider: 'OpenAI (จำลอง)', model: 'demo-balanced', enabled: true, limit: 2000, timeout: 60, retry: 2,
    }])),
  );
  const [connected, setConnected] = useState(false);
  const [saved, setSaved] = useState(false);
  const config = configs[role];

  function update(values: Partial<AgentConfig>) {
    setConfigs((old) => ({ ...old, [role]: { ...old[role], ...values } }));
    setSaved(false);
    setConnected(false);
  }

  return <main id="main" className="shell admin-page">
    <AdminNav />
    <div className="admin-heading">
      <div><span className="eyebrow">AGENT CONFIGURATION</span><h1>ทีมเบื้องหลัง<span className="blue">ทุกฉบับ</span></h1><p>เลือกหน้าที่ provider และ model ให้เหมาะกับงาน</p></div>
      <span className="badge badge-outline sandbox-pill"><ShieldCheck size={15} /> ไม่มีการเชื่อมต่อ AI จริง</span>
    </div>
    <DemoNote>ทุก model เป็นชื่อจำลอง การทดสอบไม่ส่ง request และไม่เกิดค่าใช้จ่าย การตั้งค่าหน้านี้จะรีเซ็ตเมื่อออกจากหน้า</DemoNote>
    <div className="settings-grid">
      <aside className="agent-list">
        {roles.map((item, index) => <button key={item} className={`btn btn-ghost ${role === item ? 'btn-active selected' : ''}`} aria-pressed={role === item} onClick={() => { setRole(item); setConnected(false); setSaved(false); }}>
          <Bot size={20} /><div><strong>{item}</strong><small>Agent 0{index + 1} · {configs[item].enabled ? 'เปิดใช้จำลอง' : 'ปิดใช้'}</small></div><span className={configs[item].enabled ? 'blue-dot' : 'gray-dot'} />
        </button>)}
        <p className="muted">หน้าที่แยกกัน แต่ใช้ชุดข่าวเดียวกัน ไม่มี autonomous workflow จริง</p>
      </aside>
      <form className="card bg-base-100 panel settings-panel" onSubmit={(event) => { event.preventDefault(); setSaved(true); log(`บันทึก Agent ${role} จำลอง`); notify('บันทึกการตั้งค่าในหน้านี้แล้ว · ไม่ได้เชื่อม provider'); }}>
        <div className="policy-top">
          <div><span className="eyebrow">AGENT / {role}</span><h2>ตั้งค่า Agent</h2></div>
          <label className="checkbox-label"><input className="checkbox checkbox-primary checkbox-sm" type="checkbox" checked={config.enabled} onChange={(event) => update({ enabled: event.target.checked })} /> เปิดใช้จำลอง</label>
        </div>
        <div className="form-grid">
          <label>ชื่อ Agent<input className={fieldClass} value={`AI Daily · ${role}`} readOnly /></label>
          <label>หน้าที่<input className={fieldClass} value={role} readOnly /></label>
          <label>Provider<select className={selectClass} value={config.provider} onChange={(event) => { const provider = event.target.value as Provider; update({ provider, model: models[provider][0] }); }}>{Object.keys(models).map((item) => <option key={item}>{item}</option>)}</select></label>
          <label>Model<select className={selectClass} value={config.model} onChange={(event) => update({ model: event.target.value })}>{models[config.provider].map((item) => <option key={item}>{item}</option>)}</select></label>
        </div>
        <div className="credential-box">
          <div><KeyRound size={19} /><strong>Credential reference</strong><span className="badge badge-outline badge-sm pill">Mock only</span></div>
          <label>API key — ช่องนี้ไม่รับข้อมูลจริง<input className={fieldClass} disabled value="demo-key-placeholder · ไม่ใช่ API key" readOnly aria-label="API key จำลอง ไม่รับ key จริง" /></label>
          <small>ใช้ demo-credential-01 ร่วมกันทั้ง 3 Agents · ไม่มีการรับหรือเก็บ secrets</small>
          <button type="button" className="btn btn-outline btn-sm plain-button" onClick={() => { setConnected(true); log(`ทดสอบ UI การเชื่อมต่อ ${role} · ไม่มี API request`); }}><Plug size={15} /> ทดสอบการเชื่อมต่อจำลอง</button>
          {connected && <p className="alert alert-success alert-soft success-message" role="status"><Check size={16} /> จำลองสำเร็จ · ยังไม่ได้ยืนยัน credential หรือ model จริง</p>}
        </div>
        <h3>ขอบเขตการทำงาน</h3>
        <div className="form-grid three">
          <label>Output token limit<input className={fieldClass} type="number" min="1" max="100000" required value={config.limit} onChange={(event) => update({ limit: Number(event.target.value) })} /></label>
          <label>Timeout (วินาที)<input className={fieldClass} type="number" min="1" max="600" required value={config.timeout} onChange={(event) => update({ timeout: Number(event.target.value) })} /></label>
          <label>Retry limit<input className={fieldClass} type="number" min="0" max="3" required value={config.retry} onChange={(event) => update({ retry: Number(event.target.value) })} /></label>
        </div>
        <p className="muted">Prompt version: editorial-demo-v1 · ตัวเลขเป็นค่าตั้งตัวอย่าง ไม่ได้ควบคุม worker จริง</p>
        <div className="form-footer"><span>{saved ? 'บันทึกในหน้านี้แล้ว' : 'ทดลองเปลี่ยนค่าและบันทึกได้'}</span><button className="btn btn-primary btn-sm primary-button" type="submit"><Save size={16} /> บันทึกจำลอง</button></div>
      </form>
    </div>
  </main>;
}

export default function Settings() { return appConfig.source === 'supabase' ? <InactiveBackendPage title="Agents & Providers"/> : <DemoSettings/>; }
