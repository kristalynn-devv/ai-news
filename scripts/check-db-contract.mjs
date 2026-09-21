import { rowSchema } from '../lib/contracts.ts';
let input='';
for await (const chunk of process.stdin) input+=chunk;
const row=rowSchema.parse(JSON.parse(input));
if(row.slug!=='news-one'||row.citations.length!==1||row.citations[0].source_published_at!==null) throw new Error('Unexpected PostgreSQL publication contract');
console.log('Actual PostgreSQL RPC payload passed the frontend Zod contract.');
