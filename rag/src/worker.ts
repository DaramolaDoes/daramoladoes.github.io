import indexData from './index.json';
import { rank, packContext, IndexFile } from './retriever';

type Env = {
  OPENAI_API_KEY: string;
  OPENAI_EMBED_MODEL: string;
  OPENAI_CHAT_MODEL: string;
  TOP_K: string;
  MAX_CONTEXT_CHARS: string;
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    const url = new URL(req.url);
    if (url.pathname !== '/api/olu') return new Response('Not Found', { status: 404, headers: CORS });

    try {
      const { query } = await req.json();
      if (!query || typeof query !== 'string') return json({ error:'Provide { "query": "..." }' }, 400);

      const qEmb = await embed(query, env.OPENAI_API_KEY, env.OPENAI_EMBED_MODEL || 'text-embedding-3-small');
      const idx = indexData as unknown as IndexFile;
      const top = rank(qEmb, idx.chunks, Number(env.TOP_K || 8));
      const { context, sources } = packContext(top, Number(env.MAX_CONTEXT_CHARS || 8000));

      const prompt = [
        { role:'system', content:'You are Olu, an MIT-grade AI/Software Engineering assistant for OMS. Be precise, concise, and executive-ready. Use the provided context; if insufficient, say so.' },
        { role:'user', content:`Question: ${query}\n\nUse ONLY this context to answer:\n\n${context}\n\nThen give a short exec-summary bullet list.` }
      ];

      const answer = await chat(prompt, env.OPENAI_API_KEY, env.OPENAI_CHAT_MODEL || 'gpt-4o-mini');
      return json({ answer, sources });
    } catch (e:any) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }
} satisfies ExportedHandler<Env>;

async function embed(text:string, key:string, model:string){
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model, input: text })
  });
  if(!r.ok) throw new Error(`Embed failed: ${r.status} ${await r.text()}`);
  const j = await r.json(); return j.data[0].embedding;
}

async function chat(messages:any[], key:string, model:string){
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
    body: JSON.stringify({ model, messages, temperature:0.2 })
  });
  if(!r.ok) throw new Error(`Chat failed: ${r.status} ${await r.text()}`);
  const j = await r.json(); return j.choices[0].message.content;
}

function json(obj:any, status=200){
  return new Response(JSON.stringify(obj), { status, headers:{'Content-Type':'application/json', ...CORS} });
}
