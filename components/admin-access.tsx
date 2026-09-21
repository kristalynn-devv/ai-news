'use client';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { appConfig } from '@/lib/env';
import { getBackend } from '@/lib/backend';

export function AdminAccess({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (appConfig.source === 'mock') return;
    let active = true;
    setBusy(true);
    getBackend().isAdmin().then(value => { if (active) setAllowed(value); })
      .catch(() => { if (active) { setAllowed(false); setMessage('ตรวจสิทธิ์ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่'); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path]);
  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage('');
    const form = event.currentTarget; const data = new FormData(form);
    try {
      await getBackend().signIn(String(data.get('email')), String(data.get('password')));
      const admin = await getBackend().isAdmin(); setAllowed(admin);
      if (!admin) { await getBackend().signOut(); setMessage('บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล'); }
    } catch { setAllowed(false); setMessage('เข้าสู่ระบบหรือตรวจสิทธิ์ไม่สำเร็จ กรุณาลองใหม่'); }
    finally { form.reset(); setBusy(false); }
  }
  if (appConfig.source === 'mock') return children;
  if (busy) return <main id="main" className="shell empty-state"><h1>กำลังตรวจสิทธิ์ผู้ดูแล</h1><p role="status">โปรดรอสักครู่</p></main>;
  if (!allowed) return <main id="main" className="shell admin-page"><h1>เข้าสู่ระบบบรรณาธิการ</h1><p>ใช้บัญชี Supabase Auth ที่ได้รับสิทธิ์ผู้ดูแลจากเจ้าของระบบ</p>
    <form onSubmit={login} className="flex max-w-sm flex-col gap-4 py-6">
      <label>อีเมล<input className="input input-bordered w-full" name="email" type="email" autoComplete="username" required maxLength={254}/></label>
      <label>รหัสผ่าน<input className="input input-bordered w-full" name="password" type="password" autoComplete="current-password" required maxLength={256}/></label>
      <button className="btn btn-primary" type="submit">เข้าสู่ระบบ</button>
    </form>{message && <p role="alert" className="alert alert-error">{message}</p>}
    <p>AI และงานตามเวลายังไม่เปิดใช้งาน</p></main>;
  return <><div className="shell flex justify-end py-2"><button className="btn btn-outline btn-sm" onClick={async () => { setAllowed(false); await getBackend().signOut(); }}>ออกจากระบบ</button></div>{children}</>;
}
