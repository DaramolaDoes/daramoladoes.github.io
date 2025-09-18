import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(process.cwd(), '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT = path.join(process.cwd(), 'src', 'index.json');

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const EMBED_MODEL = process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small';

if (!OPENAI_API_KEY) { console.error('Missing OPENAI_API_KEY'); process.exit(1); }

const EXT_OK = new Set(['.md', '.mdx', '.html', '.htm']);

function strip(s){
  return s.replace(/<script[\s\S]*?<\/script>/gi,'')
          .replace(/<style[\s\S]*?<\/style>/gi,'')
          .replace(/<[^>]+>/g,'')
          .replace(/[\*_`>#]/g,'')
          .replace(/\s+\n/g,'\n')
          .replace(/\n{3,}/g,'\n\n')
          .trim();
}

function chunk(text, max=1200, overlap=120){
  const out=[]; let i=0;
  while(i<text.length){ const end=Math.min(text.length,i+max); out.push(text.slice(i,end)); if(end===text.length)break; i=end-overlap; }
  return out;
}

async function embedBatch(texts){
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method:'POST',
    headers:{Authorization:`Bearer ${OPENAI_API_KEY}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model: EMBED_MODEL, input: texts })
  });
  if(!r.ok) throw new Error(`Embed failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data.map(d=>d.embedding);
}

async function main(){
  const files = await fs.readdir(CONTENT_DIR);
  const chunks = [];

  for(const f of files){
    const ext = path.extname(f).toLowerCase();
    if(!EXT_OK.has(ext)) continue;

    const raw = await fs.readFile(path.join(CONTENT_DIR, f), 'utf8');
    const text = strip(raw);
    const parts = chunk(text);
    const embs  = await embedBatch(parts);

    const title = (text.split('\n')[0] || path.basename(f)).slice(0,120);
    const docId = path.basename(f, ext);

    parts.forEach((t,i)=>{
      chunks.push({
        id: `${docId}#${i+1}`,
        docId,
        title,
        // If you post as a standalone page, change to `/tripadvisor-2024.html`
        url: `/blog/${docId}`,
        text: t,
        embedding: embs[i]
      });
    });
  }

  const out = { meta:{ createdAt:new Date().toISOString(), embedModel: EMBED_MODEL }, chunks };
  await fs.mkdir(path.dirname(OUT), { recursive: true });
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`Wrote ${OUT} with ${chunks.length} chunks`);
}
main().catch(e => { console.error(e); process.exit(1); });
