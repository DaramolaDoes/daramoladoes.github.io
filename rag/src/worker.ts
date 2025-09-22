// No local index import anymore—everything comes from Vectorize.

type Env = {
  OPENAI_API_KEY: string;
  OPENAI_EMBED_MODEL: string;
  OPENAI_CHAT_MODEL: string;
  TOP_K: string;
  MAX_CONTEXT_CHARS: string;
  VECTORS: any; // bound via [[vectorize]] as "VECTORS" in wrangler.toml
};

// Allow all three origins during verification. Tighten later if you want.
const ALLOW = new Set([
  'https://www.omobilesolutions.com',
  'https://omobilesolutions.com',
  // 'https://oms-olu-rag.odaramola03.workers.dev', // enable if you need browser calls to workers.dev
]);

function corsHeaders(origin?: string) {
  const allowOrigin = origin && ALLOW.has(origin) ? origin : '*'; // keep * for curl tests
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization',
  };
}

function json(obj: unknown, status = 200, origin?: string) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || undefined;

    // Health check
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/health')) {
      return new Response('OK', { headers: corsHeaders(origin) });
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response('', { headers: corsHeaders(origin) });
    }

    // Accept:
    //  - POST /search
    //  - POST /api/olu/search
    //  - POST /api/olu  (legacy)
    const p = url.pathname;
    const isSearch =
      p === '/search' ||
      p === '/api/olu/search' ||
      p === '/api/olu';

    if (!isSearch || req.method !== 'POST') {
      return new Response('Not Found', { status: 404, headers: corsHeaders(origin) });
    }

    try {
      // Accept { q: "..."} or { query: "..." }
      const body = await req.json().catch(() => ({}));
      const query: string | undefined = body.q ?? body.query;
      if (!query || typeof query !== 'string') {
        return json({ error: 'Provide JSON body with "q" or "query".' }, 400, origin);
      }

      // 1) Embed the question
      const qEmb = await embed(
        query,
        env.OPENAI_API_KEY,
        env.OPENAI_EMBED_MODEL || 'text-embedding-3-small'
      );

      // 2) Vectorize query (requires [[vectorize]] binding "VECTORS")
      const topK = Number(env.TOP_K || 8);
      const result: any = await env.VECTORS.query(qEmb, {
        topK,
        returnValues: false,
        returnMetadata: true
      });

      const hits = (result?.matches ?? []).map((m: any) => ({
        id: m.id,
        score: m.score,
        title: m.metadata?.title,
        url: m.metadata?.url,
        text: String(m.metadata?.text || '')
      }));

      // Build context (trimmed to MAX_CONTEXT_CHARS)
      const maxChars = Number(env.MAX_CONTEXT_CHARS || 8000);
      let used = 0;
      const parts: string[] = [];
      for (const h of hits) {
        if (used >= maxChars) break;
        const chunk = h.text.slice(0, Math.max(0, maxChars - used));
        if (chunk) {
          parts.push(chunk);
          used += chunk.length + 2;
        }
      }
      const context = parts.join('\n\n');

      // 3) If no context, return a helpful message with sources (empty)
      if (!context) {
        return json({
          answer:
            "I couldn’t find enough indexed context to answer that yet. Try re-ingesting or widening the query.",
          sources: []
        }, 200, origin);
      }

      // 4) Compose answer with chat model
      const prompt = [
        {
          role: 'system',
          content:
            'You are Olu, an MIT-grade AI/Software Engineering assistant for OMS. Be precise, concise, and executive-ready. Use ONLY the provided context; if insufficient, say so.'
        },
        {
          role: 'user',
          content: `Question: ${query}\n\nUse ONLY this context to answer:\n\n${context}\n\nThen give a short exec-summary bullet list.`
        }
      ];

      const answer = await chat(
        prompt,
        env.OPENAI_API_KEY,
        env.OPENAI_CHAT_MODEL || 'gpt-4o-mini'
      );

      const sources = hits.map(h => ({
        title: h.title,
        url: h.url,
        score: h.score
      }));

      return json({ answer, sources }, 200, origin);
    } catch (e: any) {
      return json({ error: e?.message || String(e) }, 500, origin);
    }
  }
} satisfies ExportedHandler<Env>;

async function embed(text: string, key: string, model: string) {
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input: text })
  });
  if (!r.ok) throw new Error(`Embed failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data[0].embedding;
}

async function chat(messages: any[], key: string, model: string) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, temperature: 0.2 })
  });
  if (!r.ok) throw new Error(`Chat failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.choices[0].message.content;
}
