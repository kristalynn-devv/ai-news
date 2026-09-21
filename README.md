# AI Daily

ต้นแบบหนังสือพิมพ์ออนไลน์ภาษาไทยสำหรับติดตามข่าว AI ทั้งมุมมองผู้อ่านทั่วไปและ AI Fullstack Developer พร้อมหน้าหลังบ้านสำหรับสร้างร่าง ตรวจแก้ และอนุมัติข่าว

> สถานะปัจจุบัน: prototype สำหรับพัฒนาและทดสอบในเครื่อง ข้อมูลหน้าเว็บเริ่มต้นเป็นข้อมูลจำลอง และยังไม่ได้เชื่อมบริการ production หรือ deploy

## ความสามารถปัจจุบัน

- หน้าอ่านข่าวทั่วไปและมุมมองสำหรับนักพัฒนา
- หน้ารายละเอียดข่าวพร้อมแหล่งอ้างอิง
- หน้าหลังบ้านสำหรับคิวตรวจข่าว การสร้างและแก้ไขร่าง
- ประวัติ revision และการอนุมัติแบบ immutable
- Supabase schema, RLS และ RPC สำหรับ workflow ของบรรณาธิการ
- static export ที่พร้อมนำโฟลเดอร์ `out/` ไปใช้กับ static hosting
- unit tests, PostgreSQL contract tests และ Playwright browser tests

รายละเอียดผลิตภัณฑ์อยู่ใน [PRD.md](./PRD.md)

## เทคโนโลยี

- Next.js และ React
- TypeScript
- Tailwind CSS 4 และ daisyUI 5
- Supabase/PostgreSQL สำหรับ backend foundation
- Playwright สำหรับ browser tests

## เริ่มต้นใช้งาน

แนะนำ Node.js 22.18 ขึ้นไป

```bash
npm ci
npm run dev
```

เปิด `http://127.0.0.1:3000` โดยค่าเริ่มต้นระบบจะใช้ข้อมูลจำลอง จึงไม่ต้องมีบัญชีหรือ API key

## คำสั่งหลัก

```bash
npm test          # unit tests
npm run typecheck # TypeScript checks
npm run build     # production static export ไปยัง out/
npm start         # เปิด static preview หลัง build
npm run test:e2e  # Playwright browser tests
npm run test:db   # PostgreSQL contract tests ผ่าน Docker
```

`npm run test:db` ต้องใช้ Docker และ image `postgres:16` ที่มีอยู่ในเครื่อง คำสั่งทดสอบจะไม่ดาวน์โหลด image ให้อัตโนมัติ

## การตั้งค่า Supabase

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่เฉพาะค่า public ของโปรเจกต์ที่ได้รับอนุมัติ:

```env
NEXT_PUBLIC_DATA_SOURCE=supabase
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
```

ห้ามใส่ service-role key, provider key หรือ secret อื่นในตัวแปร `NEXT_PUBLIC_*` หรือ commit ลง repository

ฐานข้อมูลอยู่ใน `supabase/migrations/` และชุดทดสอบอยู่ใน `supabase/tests/` การมีไฟล์ migration ไม่ได้หมายความว่ามีการนำไปใช้กับ Supabase ภายนอกแล้ว

## โครงสร้างสำคัญ

```text
app/                 Next.js routes และ styles
components/          reader, newsroom และ admin UI
lib/                 contracts, data และ backend adapters
supabase/migrations/ PostgreSQL schema, RLS และ RPC
supabase/tests/      database contract tests
tests/               Playwright browser tests
unit/                Node unit tests
```

## License

โครงการนี้เผยแพร่ภายใต้ [MIT License](./LICENSE)
