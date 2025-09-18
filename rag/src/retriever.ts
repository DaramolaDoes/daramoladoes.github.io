export type Chunk = { id:string; docId:string; title:string; url?:string; text:string; embedding:number[]; };
export type IndexFile = { meta:{createdAt:string; embedModel:string}; chunks:Chunk[]; };

export function cosine(a:number[], b:number[]){
  let dot=0, na=0, nb=0;
  for(let i=0;i<a.length;i++){ const x=a[i], y=b[i]; dot+=x*y; na+=x*x; nb+=y*y; }
  return dot / (Math.sqrt(na)*Math.sqrt(nb));
}

export function rank(qEmb:number[], chunks:Chunk[], k=8){
  return chunks.map(c=>({chunk:c, score:cosine(qEmb,c.embedding)}))
               .sort((a,b)=>b.score-a.score).slice(0,k);
}

export function packContext(scored:{chunk:Chunk,score:number}[], maxChars=8000){
  const lines:string[]=[]; const sources:{title:string;url?:string}[]=[]; let used=0;
  for(const {chunk} of scored){
    const block = `# ${chunk.title}\n${chunk.text.trim()}\n`;
    if(used + block.length > maxChars) break;
    lines.push(block); used += block.length;
    sources.push({ title: chunk.title, url: chunk.url });
  }
  return { context: lines.join("\n---\n"), sources };
}
