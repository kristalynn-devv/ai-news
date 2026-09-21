import { Suspense } from 'react';
import { stories } from '@/lib/data';
import { StoryReader } from '@/components/story-reader';
export function generateStaticParams() { return stories.map(s => ({ id: s.id })); }
export default async function Page({params}: {params: Promise<{id: string}>}) { const {id} = await params; return <Suspense><StoryReader slug={id}/></Suspense>; }
