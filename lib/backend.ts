import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { appConfig, type AppConfig } from './env.ts';
import { stories, type Story } from './data.ts';
import { rowSchema, queueSchema, draftInputSchema, draftResultSchema, historyEntrySchema,
  type QueueStory, type ReviewAction, type DraftInput, type DraftResult, type HistoryEntry } from './contracts.ts';

export type Backend = {
  source: 'mock' | 'supabase';
  list: (query?: string, offset?: number) => Promise<Story[]>;
  get: (slug: string) => Promise<Story | null>;
  signInWithGoogle: (redirectTo: string) => Promise<void>;
  signOut: () => Promise<void>;
  isAdmin: () => Promise<boolean>;
  queue: (status?: string, offset?: number) => Promise<QueueStory[]>;
  review: (story: QueueStory, action: ReviewAction, reason: string) => Promise<void>;
  saveDraft: (draft: DraftInput) => Promise<DraftResult>;
  history: (storyId: string) => Promise<HistoryEntry[]>;
};
const unavailable = async (): Promise<never> => { throw new Error('ส่วนนี้ยังไม่เชื่อม Supabase'); };
export const PAGE_SIZE = 30;
export function createBackend(config: AppConfig, fetcher: typeof fetch = fetch): Backend {
  if (config.source === 'mock') return {
    source: 'mock',
    async list(query = '', offset = 0) { return stories.filter(s => `${s.title} ${s.summary} ${s.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).slice(offset, offset + PAGE_SIZE); },
    async get(slug) { return stories.find(s => s.id === slug) ?? null; },
    signInWithGoogle: unavailable, signOut: async () => {}, isAdmin: async () => false, queue: unavailable, review: unavailable,
    saveDraft: unavailable, history: unavailable,
  };
  const client = createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    global: { fetch: (input, init) => fetcher(input, { ...init, signal: AbortSignal.any([AbortSignal.timeout(10000), ...(init?.signal ? [init.signal] : [])]) }) },
  });
  async function decodeRows(data: unknown): Promise<Story[]> {
    const rows = z.array(rowSchema).max(50).parse(data);
    if (!rows.length) return [];
    return rows.map(row => ({ ...row.content, id: row.slug, source: row.citations[0].label,
      time: new Date(row.published_at).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' }),
      href: `/news/?id=${encodeURIComponent(row.slug)}`, publishedAt: row.published_at, updatedAt: row.updated_at,
      citations: row.citations,
    }));
  }
  return {
    source: 'supabase',
    async list(query = '', offset = 0) {
      const { data, error } = await client.rpc('search_stories', { p_query: query.slice(0,200), p_limit: PAGE_SIZE, p_offset: offset });
      if (error) throw new Error('โหลดข่าวไม่สำเร็จ');
      return decodeRows(data);
    },
    async get(slug) {
      if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 120) return null;
      const { data, error } = await client.rpc('get_story', {p_slug: slug});
      if (error) throw new Error('โหลดข่าวไม่สำเร็จ');
      return (await decodeRows(data))[0] ?? null;
    },
    async signInWithGoogle(redirectTo) {
      let callback: URL;
      try { callback = new URL(redirectTo); }
      catch { throw new Error('ที่อยู่กลับจาก Google ไม่ถูกต้อง'); }
      const local = ['127.0.0.1', 'localhost'].includes(callback.hostname);
      if ((callback.protocol !== 'https:' && !(local && callback.protocol === 'http:')) || callback.username || callback.password ||
        callback.search || callback.hash || !['/admin', '/admin/'].includes(callback.pathname)) {
        throw new Error('ที่อยู่กลับจาก Google ไม่ถูกต้อง');
      }
      const { data, error } = await client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callback.href } });
      if (error || !data.url) throw new Error('เริ่ม Google Login ไม่สำเร็จ กรุณาลองใหม่');
    },
    async signOut() { await client.auth.signOut({ scope: 'local' }); },
    async isAdmin() {
      const { data: session } = await client.auth.getSession();
      if (!session.session) return false;
      const { data, error } = await client.rpc('is_admin');
      if (error) throw new Error('ตรวจสิทธิ์ไม่สำเร็จ กรุณาเข้าสู่ระบบใหม่');
      if (data !== true) {
        await client.auth.signOut({ scope: 'local' });
        throw new Error('บัญชีนี้ไม่มีสิทธิ์ผู้ดูแล');
      }
      return true;
    },
    async queue(status = 'pending', offset = 0) {
      const { data, error } = await client.rpc('admin_queue', { p_status: status, p_offset: offset });
      if (error) throw new Error('อ่านคิวไม่ได้ ตรวจสิทธิ์หรือเข้าสู่ระบบใหม่');
      return z.array(queueSchema).max(50).parse(data);
    },
    async review(story, action, reason) {
      if (!reason.trim() || reason.trim().length > 1000) throw new Error('ระบุเหตุผล 1–1,000 ตัวอักษร');
      const { error } = await client.rpc('review_story', { p_story_id: story.id, p_revision_id: story.revision_id,
        p_expected_version: story.version, p_action: action, p_reason: reason.trim() });
      if (error) throw new Error(error.code === '40001' ? 'ข่าวเปลี่ยนแล้ว กรุณาโหลดคิวใหม่ก่อนตัดสิน' : 'บันทึกไม่ได้ ตรวจสิทธิ์ สถานะข่าว และหลักฐาน แล้วโหลดคิวใหม่');
    },
    async saveDraft(input) {
      const draft = draftInputSchema.parse(input);
      const { data, error } = await client.rpc('save_story_draft', {
        p_story_id: draft.storyId, p_expected_version: draft.expectedVersion, p_slug: draft.slug,
        p_content: draft.content, p_citations: draft.citations, p_checks_passed: draft.checksPassed,
        p_source_conflict: draft.sourceConflict, p_unsupported_claims: draft.unsupportedClaims,
        p_injection_detected: draft.injectionDetected, p_reason: draft.reason,
      });
      if (error) throw new Error(error.code === '40001' ? 'ข่าวเปลี่ยนแล้ว กรุณาโหลดคิวใหม่ก่อนบันทึก' : 'บันทึกร่างไม่ได้ ตรวจข้อมูล สิทธิ์ และ slug ที่ไม่ซ้ำ');
      return draftResultSchema.parse(data);
    },
    async history(storyId) {
      const id = z.uuid().parse(storyId);
      const { data, error } = await client.rpc('admin_story_history', { p_story_id: id });
      if (error) throw new Error('อ่านประวัติไม่ได้ ตรวจสิทธิ์หรือเข้าสู่ระบบใหม่');
      return z.array(historyEntrySchema).max(100).parse(data);
    },
  };
}
let instance: Backend | undefined;
export function getBackend(): Backend { return instance ??= createBackend(appConfig); }
