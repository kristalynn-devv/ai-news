'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { initialQueue, type QueueItem, type Mode } from '@/lib/data';
type DemoState = { bookmarks: string[]; bookmark: (id: string) => void; queue: QueueItem[]; setQueue: React.Dispatch<React.SetStateAction<QueueItem[]>>; mode: Mode; setMode: (mode: Mode) => void; stopped: boolean; setStopped: (v: boolean) => void; audit: string[]; log: (message: string) => void; notice: string; notify: (message: string) => void };
const Context = createContext<DemoState | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [bookmarks, setBookmarks] = useState<string[]>([]);
  const [queue, setQueue] = useState(initialQueue);
  const [mode, setMode] = useState<Mode>('Manual');
  const [stopped, setStopped] = useState(false);
  const [audit, setAudit] = useState<string[]>([]);
  const [notice, notify] = useState('');
  useEffect(() => { try { const saved = JSON.parse(localStorage.getItem('ai-daily-bookmarks') || '[]'); if (Array.isArray(saved) && saved.every(x => typeof x === 'string')) setBookmarks(saved); } catch { /* Reading is still available when storage is disabled. */ } }, []);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => notify(''), 4500); return () => clearTimeout(timer); }, [notice]);
  function bookmark(id: string) { const next = bookmarks.includes(id) ? bookmarks.filter(x => x !== id) : [...bookmarks, id]; setBookmarks(next); try { localStorage.setItem('ai-daily-bookmarks', JSON.stringify(next)); } catch { notify('บันทึกได้ในหน้านี้ แต่ browser ไม่อนุญาตให้เก็บข้ามการรีเฟรช'); } }
  function log(message: string) { setAudit(old => [`${new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' })} · Demo Admin · ${message}`, ...old]); }
  return <Context.Provider value={{bookmarks, bookmark, queue, setQueue, mode, setMode, stopped, setStopped, audit, log, notice, notify}}>{children}<div className={`toast ${notice ? 'show' : ''}`} role="status">{notice}</div></Context.Provider>;
}
export function useDemo() { const value = useContext(Context); if (!value) throw new Error('DemoProvider missing'); return value; }
