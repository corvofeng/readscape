import { readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../src/adapters');
for(const d of readdirSync(root,{withFileTypes:true}).filter(d=>d.isDirectory())) {
  const m=JSON.parse(readFileSync(resolve(root,d.name,'manifest.json'),'utf8'));
  console.log(`${m.category}\t${m.id}\t${m.hosts.join(', ')}\t${m.name}`);
}
