'use client';
import { useEffect, useState, type ReactNode } from 'react';
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
      .catch(error => { if (active) { setAllowed(false); setMessage(error instanceof Error && error.message === 'บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล'
        ? error.message : 'ตรวจสิทธิ์ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่'); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path]);
  async function login() {
    setBusy(true); setMessage('');
    try {
      await getBackend().signInWithGoogle(`${window.location.origin}/admin/`);
    } catch { setAllowed(false); setMessage('เข้าสู่ระบบหรือตรวจสิทธิ์ไม่สำเร็จ กรุณาลองใหม่'); }
    finally { setBusy(false); }
  }
  if (appConfig.source === 'mock') return children;
  if (busy) return <main id="main" className="shell empty-state"><h1>กำลังตรวจสิทธิ์ผู้ดูแล</h1><p role="status">โปรดรอสักครู่</p></main>;
  if (!allowed) return <main id="main" className="shell admin-page"><h1>เข้าสู่ระบบบรรณาธิการ</h1><p>ใช้บัญชี Google ที่เจ้าของระบบอนุญาตไว้</p>
    <div className="flex max-w-sm flex-col gap-4 py-6">
      <button className="btn btn-primary" type="button" onClick={login}>เข้าสู่ระบบด้วย Google</button>
    </div>{message && <p role="alert" className="alert alert-error">{message}</p>}
    <p>AI และงานตามเวลายังไม่เปิดใช้งาน</p></main>;
  return <><div className="shell flex justify-end py-2"><button className="btn btn-outline btn-sm" onClick={async () => { setAllowed(false); await getBackend().signOut(); }}>ออกจากระบบ</button></div>{children}</>;
}
