'use client';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { getBackend } from '@/lib/backend';
import type { Story } from '@/lib/data';
import { Article } from './article';
export function StoryReader({ slug }: { slug?: string }) {
  const params = useSearchParams(); const id = slug ?? params.get('id') ?? '';
  const [story,setStory] = useState<Story|null>(null);
  const [loading,setLoading] = useState(true); const [error,setError] = useState(false);
  useEffect(() => {
    let active=true; setLoading(true);setError(false);setStory(null);
    getBackend().get(id).then(value=>{if(active)setStory(value);}).catch(()=>{if(active)setError(true);}).finally(()=>{if(active)setLoading(false);});
    return ()=>{active=false;};
  },[id]);
  if(loading) return <main id="main" className="shell empty-state"><h1>กำลังโหลดข่าว</h1></main>;
  if(error||!story) return <main id="main" className="shell empty-state"><h1>{error?'โหลดข่าวไม่สำเร็จ':'ไม่พบข่าวที่เผยแพร่'}</h1><p>{error?'ลองเปิดหน้านี้ใหม่อีกครั้ง':'ข่าวอาจยังไม่เผยแพร่หรือถูกถอนแล้ว'}</p></main>;
  return <Article story={story}/>;
}
