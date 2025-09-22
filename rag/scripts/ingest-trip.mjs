// rag/scripts/ingest-trip.mjs
import crypto from "node:crypto";
import fetch from "node-fetch";
import { JSDOM } from "jsdom";

const SOURCE_URL     = process.env.SOURCE_URL || "https://ir.tripadvisor.com/node/20966/html";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const CF_ACCOUNT_ID  = process.env.CF_ACCOUNT_ID;
const CF_API_TOKEN   = process.env.CF_API_TOKEN;      // Vectorize API TOKEN (Account → Vectorize: Read+Edit)
const VECTOR_INDEX   = process.env.VECTOR_INDEX || "oms-ir";

if (!OPENAI_API_KEY || !CF_ACCOUNT_ID || !CF_API_TOKEN) {
  console.error("Missing env: OPENAI_API_KEY, CF_ACCOUNT_ID, CF_API_TOKEN");
  process.exit(1);
}

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function cleanHtml(html) {
  const dom = new JSDOM(html);
  const d = dom.window.document;
  d.querySelectorAll("script,style,noscript,header,footer,nav").forEach(n => n.remove());
  const blocks = [];
  d.querySelectorAll("h1,h2,h3,h4,h5,h6,p,li,th,td").forEach(el => {
    let t = el.textContent.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (/^H[1-6]$/.test(el.tagName)) {
      const lvl = Number(el.tagName[1]);
      t = "#".repeat(lvl) + " " + t;
    }
    blocks.push(t);
  });
  return blocks.join("\n\n");
}

function chunk(text, max=900, overlap=150) {
  const sents = text.split(/(?<=[.!?])\s+/);
  const out=[]; let buf=[], n=0;
  for (const s of sents) {
    const w = s.trim().split(/\s+/).length;
    if (n + w > max && buf.length) {
      const joined = buf.join(" ");
      out.push(joined);
      const tail = joined.split(/\s+/).slice(-overlap).join(" ");
      buf = tail ? [tail] : [];
      n = buf.join(" ").split(/\s+/).length;
    }
    buf.push(s);
    n += w;
  }
  if (buf.length) out.push(buf.join(" "));
  return out.map((text,i)=>({id:i,text:text.trim()}));
}

async function embed(inputs){
  const r = await fetch("https://api.openai.com/v1/embeddings",{
    method:"POST",
    headers:{ Authorization:`Bearer ${OPENAI_API_KEY}`, "Content-Type":"application/json" },
    body:JSON.stringify({ model:"text-embedding-3-small", input:inputs })
  });
  if(!r.ok) throw new Error(`OpenAI embed failed: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data.map(d=>d.embedding);
}

const VECT_BASE = `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/vectorize/v2`;
async function upsertBatch(vectors){
  const r = await fetch(`${VECT_BASE}/indexes/${VECTOR_INDEX}/upsert`,{
    method:"POST",
    headers:{ Authorization:`Bearer ${CF_API_TOKEN}`, "Content-Type":"application/json" },
    body:JSON.stringify({ vectors })
  });
  if(!r.ok){
    const body = await r.text();
    throw new Error(`Vectorize upsert failed: ${r.status} ${body}`);
  }
}

async function withRetry(fn, {retries=3, delayMs=800}={}){
  let lastErr;
  for(let i=0;i<=retries;i++){
    try { return await fn(); }
    catch(e){
      lastErr = e;
      if(i===retries) break;
      await new Promise(r=>setTimeout(r, delayMs*Math.pow(2,i)));
    }
  }
  throw lastErr;
}

(async()=>{
  const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "oms-ingest/1.0" }});
  if(!res.ok) throw new Error(`Fetch failed ${res.status} ${SOURCE_URL}`);
  const html = await res.text();
  const text = cleanHtml(html);
  if(!text || text.length < 40) throw new Error("Parsed text too small—source may be blocked or empty.");

  const dom = new JSDOM(html);
  const title = dom.window.document.querySelector("title")?.textContent?.trim() || SOURCE_URL;
  const docId = "tripadvisor_ir_20966";

  const chunks = chunk(text);
  const inputs = chunks.map(c=>c.text);
  const embs = await embed(inputs);
  if (embs.length !== chunks.length) throw new Error(`Embed count mismatch: ${embs.length} vs ${chunks.length}`);

  const baseMeta = {
    doc_id: docId,
    url: SOURCE_URL,
    title,
    source: "tripadvisor_ir",
    tags: ["IR","Tripadvisor"],
    ingested_at: new Date().toISOString()
  };

  const vectors = chunks.map((c,i)=>({
    id: `${docId}::${c.id}`,
    values: embs[i],
    metadata: { ...baseMeta, chunk_id:c.id, text:c.text, hash: sha(c.text) }
  }));

  const BATCH = 100;
  for (let i=0;i<vectors.length;i+=BATCH) {
    const slice = vectors.slice(i, i+BATCH);
    await withRetry(()=>upsertBatch(slice));
    process.stdout.write(`Upserted: ${Math.min(i+BATCH, vectors.length)} / ${vectors.length}\r`);
  }
  console.log(`\n✅ Upserted ${vectors.length} chunks → ${VECTOR_INDEX}`);
})().catch(e=>{ console.error(e?.stack || e); process.exit(1); });
