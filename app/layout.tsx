import type { Metadata } from 'next';
import '@fontsource/sarabun/400.css';
import '@fontsource/sarabun/500.css';
import '@fontsource/sarabun/600.css';
import '@fontsource/sarabun/700.css';
import './globals.css';
import './daisy.css';
import { DemoProvider } from '@/components/state';
import { Header, Footer } from '@/components/shared';
export const metadata: Metadata = { title: 'AI Daily — เข้าใจ AI ทุกวัน', description: 'ต้นแบบหนังสือพิมพ์ AI ภาษาไทย ข้อมูลทั้งหมดเป็นข้อมูลจำลอง', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="th" data-theme="aidaily" data-scroll-behavior="smooth"><body><DemoProvider><a className="skip-link" href="#main">ข้ามไปเนื้อหา</a><Header />{children}<Footer /></DemoProvider></body></html>; }
