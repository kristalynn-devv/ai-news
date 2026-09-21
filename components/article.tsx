'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, Code2, Newspaper } from 'lucide-react';
import type { Story } from '@/lib/data';
import { Art, BookmarkButton, DemoNote } from './shared';

export function Article({ story }: { story: Story }) {
  const mock = !story.publishedAt;
  const date = (value: string) => new Date(value).toLocaleString('th-TH', {timeZone:'Asia/Bangkok'});
  const [technical, setTechnical] = useState(false);

  return <main id="main" className="shell article-page">
    <Link className="back-link" href="/"><ArrowLeft size={15} /> กลับไปหน้าข่าว AI</Link>
    <div className="article-grid">
      <article>
        <div className="story-kicker">{story.category}<span> / {story.type}{mock ? ' · ตัวอย่าง' : ''}</span></div>
        <h1>{story.title}</h1>
        <p className="article-deck">{story.summary}</p>
        <div className="article-byline"><div className="avatar">AD</div><div><strong>โต๊ะข่าว AI Daily{mock ? ' · ข้อมูลจำลอง' : ''}</strong><small>{mock ? `ต้นฉบับตัวอย่าง 20 ก.ย. 2569 ${story.time} น. · อัปเดตตัวอย่าง 07:00 น.` : `เผยแพร่ ${date(story.publishedAt!)} · อัปเดต ${date(story.updatedAt!)} · เวลาไทย`} · อ่าน {story.read} นาที</small></div><BookmarkButton id={story.id} /></div>
        <Art kind={story.art} />
        {mock && <DemoNote />}
        <div className="tabs article-toggle" aria-label="ระดับรายละเอียด">
          <button aria-pressed={!technical} className={`tab ${!technical ? 'tab-active selected' : ''}`} onClick={() => setTechnical(false)}><Newspaper size={16} /> อ่านแบบทั่วไป</button>
          <button aria-pressed={technical} className={`tab ${technical ? 'tab-active selected' : ''}`} onClick={() => setTechnical(true)}><Code2 size={16} /> มุมมองนักพัฒนา</button>
        </div>
        <div className="article-body">
          <h2>เกิดอะไรขึ้น</h2>
          <p>{story.summary} {mock ? 'เนื้อหาเรื่องนี้เขียนขึ้นเพื่อสาธิตประสบการณ์อ่านข่าวของ AI Daily เท่านั้น ไม่มีเหตุการณ์จริงที่นำมายืนยันในตัวอย่างนี้' : ''}</p>
          <h2>ทำไมเรื่องนี้สำคัญ</h2>
          <p>{story.why}</p>
          <h2>เกี่ยวข้องกับใคร</h2>
          <p>{story.audience}</p>
          {technical && (story.technical ? <section className="technical-panel">
            <span className="eyebrow">DEVELOPER TAKEAWAY</span>
            <h2>จากเรื่องที่อ่าน สู่สิ่งที่ลองทำ</h2>
            <p>{story.technical.impact}</p>
            <h3>ขั้นตอนทดลอง</h3>
            <ol>{story.technical.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            <h3>ตรวจผลอย่างไร</h3>
            <p>ตรวจผลกับเกณฑ์ที่ตั้งไว้ บันทึกข้อผิดพลาดและเงื่อนไขของงานก่อนสรุปว่าดีกว่าเดิม</p>
            <div role="alert" className="alert alert-warning alert-soft caution">ข้อจำกัด: {story.technical.caveat}</div>
          </section> : <DemoNote>เรื่องนี้ไม่มีรายละเอียดเทคนิคเพิ่มเติม ใช้ข้อเท็จจริงชุดเดียวกับมุมมองทั่วไป</DemoNote>)}
          <h2 id="sources">แหล่งข้อมูลและสถานะหลักฐาน</h2>
          {mock ? <div className="alert alert-soft source-box"><div><strong>{story.source}</strong><p>แหล่งสมมติ · ไม่มี URL ต้นฉบับจริง · ยังไม่ผ่านการตรวจสอบ</p><small>แยกข้อมูลจำลองออกจากข่าวจริง และไม่มีป้าย “ทดลองภายใน”</small></div></div> : <ul>{story.citations?.map(c => <li key={c.url}><a className="link" href={c.url} rel="noopener noreferrer" target="_blank">{c.label}</a><p>วันที่ต้นฉบับ: {c.source_published_at ? date(c.source_published_at) : 'ไม่ทราบ'}</p></li>)}</ul>}
          <details><summary>ประวัติการแก้ไข</summary><p>{mock ? '20 ก.ย. 2569 · ฉบับตัวอย่างแรกสำหรับทดสอบ UI · ยังไม่มีการตรวจบรรณาธิการจริง' : `ฉบับที่อนุมัติล่าสุด ${date(story.updatedAt!)} · ประวัติการตัดสินเก็บในระบบหลังบ้าน`}</p></details>
        </div>
      </article>
      <aside className="article-aside">
        <span className="eyebrow">IN THIS STORY</span>
        <h3>อ่านให้เข้าใจในหนึ่งเรื่อง</h3>
        <p>{story.why}</p>
        <div className="tags">{story.tags.map((tag) => <span className="badge badge-outline badge-sm" key={tag}>{tag}</span>)}</div>
        <hr />
        <p>{mock ? 'เนื้อหาตัวอย่างใช้ AI ช่วยเรียบเรียง เพื่อทดสอบหน้าจอเท่านั้น' : 'เนื้อหาผ่านการตรวจโดยบรรณาธิการก่อนเผยแพร่'}</p>
        <Link href="/developers" className="read-link">ไปมุมนักพัฒนา <ArrowRight size={15} /></Link>
      </aside>
    </div>
  </main>;
}
