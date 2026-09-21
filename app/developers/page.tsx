import { Newsroom } from '@/components/newsroom';
import { Suspense } from 'react';
import Loading from '../loading';
export default function Page() { return <Suspense fallback={<Loading/>}><Newsroom developer/></Suspense>; }
