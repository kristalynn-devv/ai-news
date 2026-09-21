import { z } from 'zod';
const text = z.string().trim().min(1).max(4000);
export const contentSchema = z.object({
  title: text.max(300), summary: text, category: text.max(100),
  type: z.enum(['ข่าว', 'ความคิดเห็น', 'งานวิจัย', 'ประกาศบริษัท', 'แนวปฏิบัติ']),
  why: text, audience: text, tags: z.array(z.string().min(1).max(60)).max(20),
  read: z.number().int().min(1).max(60), art: z.enum(['orbit','model','context','human','workflow','release']),
  technical: z.object({ impact: text, steps: z.array(text).min(1).max(20), caveat: text }).strict().optional(),
}).strict();
export const citationSchema = z.object({
  label: z.string().trim().min(1).max(300),
  url: z.string().max(2048).url().refine(value => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;
    } catch { return false; }
  }),
  source_published_at: z.iso.datetime({ offset: true }).nullable(),
});
export const draftCitationSchema = citationSchema.extend({ verified: z.boolean() }).strict();
export const rowSchema = z.object({
  id: z.uuid(), slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120),
  revision_id: z.uuid(), content: contentSchema,
  published_at: z.iso.datetime({ offset: true }), updated_at: z.iso.datetime({ offset: true }),
  withdrawn: z.literal(false), citations: z.array(citationSchema).min(1).max(100),
});
export const queueSchema = z.object({
  id: z.uuid(), slug: z.string(), revision_id: z.uuid(), version: z.number().int().positive(),
  status: z.enum(['pending','published','excluded','rejected','withdrawn']), has_publication: z.boolean(), content: contentSchema,
  checks_passed: z.boolean(), source_conflict: z.boolean(), unsupported_claims: z.boolean(), injection_detected: z.boolean(),
  policy_version: z.number().int().positive().nullable(),
  citations: z.array(draftCitationSchema).min(1).max(100),
});
export const draftInputSchema = z.object({
  storyId: z.uuid().nullable(), expectedVersion: z.number().int().positive().nullable(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).max(120), content: contentSchema,
  citations: z.array(draftCitationSchema).min(1).max(100),
  checksPassed: z.boolean(), sourceConflict: z.boolean(), unsupportedClaims: z.boolean(), injectionDetected: z.boolean(),
  reason: z.string().trim().min(1).max(1000),
}).strict().refine(value => (value.storyId === null) === (value.expectedVersion === null), { message: 'storyId and expectedVersion must be supplied together' });
export const draftResultSchema = z.object({
  id: z.uuid(), slug: z.string(), revision_id: z.uuid(), version: z.number().int().positive(),
});
const historyReviewSchema = z.object({
  decision: z.enum(['approve','reject','withdraw','reopen','auto_publish']), reason: z.string(),
  actor_id: z.uuid().nullable(), policy_version: z.number().int().positive(), created_at: z.iso.datetime({ offset: true }),
});
export const historyEntrySchema = z.object({
  revision_id: z.uuid(), revision_number: z.number().int().positive(), title: z.string(), change_note: z.string(),
  created_by: z.uuid().nullable(), created_at: z.iso.datetime({ offset: true }), is_current: z.boolean(), is_published: z.boolean(),
  reviews: z.array(historyReviewSchema).max(100),
});
export type QueueStory = z.infer<typeof queueSchema>;
export type DraftInput = z.infer<typeof draftInputSchema>;
export type DraftResult = z.infer<typeof draftResultSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;
export type ReviewAction = 'approve' | 'reject' | 'withdraw' | 'reopen';
