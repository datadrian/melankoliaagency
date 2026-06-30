const { listDocs, queryDocs, createDoc, updateDoc, json } = require('./_firebase');

const VENUES = 'route_planner_crm_venues';
const EMBED_MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
const GEMINI_KEY = () => process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
const now = () => new Date().toISOString();
const id = p => `${p}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
  let b={}; try { b=JSON.parse(event.body||'{}'); } catch { return json(400,{success:false,error:'Invalid JSON'}); }
  try {
    if (b.action === 'list') return json(200,{success:true,data:(await listVenues()).map(publicVenue)});
    if (b.action === 'upsert') return json(200,{success:true,data:publicVenue(await upsertVenue(b.venue||{},{skipEmbedding:!!b.skip_embeddings}))});
    if (b.action === 'bulk_upsert') {
      const rows = Array.isArray(b.venues) ? b.venues : [];
      const out=[]; for (const v of rows) out.push(publicVenue(await upsertVenue(v,{skipEmbedding:!!b.skip_embeddings})));
      return json(200,{success:true,data:out,count:out.length});
    }
    if (b.action === 'search') return json(200,{success:true,data:await searchVenues(typeof b.query === 'string' ? {...b, query:b.query} : (b.query||b))});
    return json(400,{success:false,error:'Unknown RAG venue action'});
  } catch(e) { return json(500,{success:false,error:e.message}); }
};

async function listVenues(){ return (await listDocs(VENUES,{orderBy:'updated_at desc',pageSize:2000})).filter(v=>!v.deleted_at); }
function venueText(v){ return [v.name,v.contact_type,v.type,v.city,v.country,v.region,v.capacity?`capacity ${v.capacity}`:'',v.actual_capacity?`actual capacity ${v.actual_capacity}`:'',v.rating?`rating ${v.rating}`:'',arr(v.genres||v.genre_affinity).join(' '),v.relationship_status,v.buyer_status,v.notes,v.booking_email,v.phone,v.website,v.instagram,v.booking_method].filter(Boolean).join(' | '); }
function arr(x){ return Array.isArray(x)?x:String(x||'').split(/[,;/]+/).map(s=>s.trim()).filter(Boolean); }
function publicVenue(v={}){ const {embedding,rag_text,...rest}=v||{}; return rest; }
function normKey(v={}){ return [v.name,v.city,v.country].map(x=>String(x||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()).join('|'); }
async function upsertVenue(v, opts={}){
  const clean={...v, contact_type:String(v.contact_type||v.type||'venue').trim()||'venue', name:String(v.name||'').trim(), city:String(v.city||'').trim(), country:String(v.country||'').trim(), updated_at:now()};
  if(!clean.name || !clean.city) throw Error('Venue name and city are required');
  clean.genre_affinity = arr(v.genre_affinity || v.genres);
  clean.capacity = Number(v.capacity || v.actual_capacity || 0) || null;
  clean.actual_capacity = Number(v.actual_capacity || v.capacity || 0) || clean.capacity || null;
  clean.rating = Math.max(0, Math.min(5, Number(v.rating || 0))) || null;
  clean.relationship_status = clean.relationship_status || clean.status || 'unknown';
  clean.rag_text = venueText(clean);
  let existing=null;
  if(!clean.id){
    const venues=await listVenues().catch(()=>[]);
    existing=venues.find(x=>normKey(x)===normKey(clean));
  }
  const docId = clean.id || existing?.id || id('venue');
  const merged = existing ? {...existing, ...clean, created_at:existing.created_at||clean.created_at||now()} : clean;
  if (opts.skipEmbedding || v.skip_embedding) merged.embedding = Array.isArray(merged.embedding) ? merged.embedding : [];
  else if (!Array.isArray(merged.embedding) || !merged.embedding.length) merged.embedding = await embed(merged.rag_text).catch(()=>[]);
  if (clean.id || existing) return updateDoc(VENUES, docId, merged).catch(()=>createDoc(VENUES,{...merged,created_at:now()},docId));
  return createDoc(VENUES,{...merged,created_at:now()},docId);
}
async function searchVenues(q){
  let venues = [];
  if (q.city) venues = await queryDocs(VENUES, 'city', q.city, {limit:300}).catch(()=>[]);
  if (!venues.length && q.country && !q.city) venues = await queryDocs(VENUES, 'country', q.country, {limit:300}).catch(()=>[]);
  if (!venues.length) venues = await listVenues();
  if(!venues.length) return { venues:[], injected_context:'', count:0, note:'No CRM venues found yet.' };
  const queryText = [q.query,q.search,q.artist,q.city,q.country,q.region,q.genre,q.genres,q.capacity?`capacity ${q.capacity}`:'',q.notes,q.preferences].filter(Boolean).join(' | ');
  const wantSemantic = q.use_embedding === true || q.use_embedding === 'true' || q.semantic === true || q.semantic === 'true';
  const qEmbedding = wantSemantic ? await embed(queryText).catch(()=>[]) : [];
  const terms = tokenize(queryText);
  const scored = venues.map(v=>scoreVenue(v,q,terms,qEmbedding)).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0, Number(q.limit||12));
  const injected = scored.map((x,i)=>`${i+1}. ${x.venue.name} — ${[x.venue.city,x.venue.country].filter(Boolean).join(', ')}; cap ${x.venue.capacity||'unknown'}; genres ${(x.venue.genre_affinity||[]).join(', ')||'unknown'}; relationship ${x.venue.relationship_status||'unknown'}; booking ${x.venue.booking_email||x.venue.booking_method||'unknown'}; score ${x.score.toFixed(2)}; notes ${String(x.venue.notes||'').slice(0,220)}`).join('\n');
  return { venues:scored.map(x=>publicVenue({...x.venue,_rag_score:Number(x.score.toFixed(4)),_semantic:Number(x.semantic.toFixed(4)),_keyword:Number(x.keyword.toFixed(4))})), injected_context:injected, count:scored.length, semantic_used:wantSemantic };
}
function tokenize(s){ return new Set(String(s||'').toLowerCase().replace(/[^a-z0-9\s-]/g,' ').split(/\s+/).filter(w=>w.length>2)); }
function scoreVenue(v,q,terms,qe){
  const text = (v.rag_text || venueText(v)).toLowerCase();
  let keyword=0; terms.forEach(t=>{ if(text.includes(t)) keyword+=1; }); keyword = terms.size ? keyword / terms.size : 0;
  let geo=0; if(q.city && String(v.city||'').toLowerCase().includes(String(q.city).toLowerCase())) geo+=0.35; if(q.country && String(v.country||'').toLowerCase().includes(String(q.country).toLowerCase())) geo+=0.2; if(q.region && text.includes(String(q.region).toLowerCase())) geo+=0.1;
  let cap=0; const target=Number(q.capacity||q.target_capacity||0), vc=Number(v.capacity||0); if(target&&vc){ const ratio=Math.min(target,vc)/Math.max(target,vc); cap=ratio*0.2; }
  const rel = /confirmed|friendly|warm|known|strong|preferred|trusted/i.test(v.relationship_status||'') ? 0.2 : (/bad|avoid|cold|inactive|closed/i.test(v.relationship_status||'') ? -0.15 : 0);
  const semantic = (qe.length && Array.isArray(v.embedding) && v.embedding.length) ? cosine(qe,v.embedding) : 0;
  return { venue:v, semantic, keyword, score:(semantic*0.45)+(keyword*0.25)+geo+cap+rel };
}
function cosine(a,b){ let dot=0,aa=0,bb=0,n=Math.min(a.length,b.length); for(let i=0;i<n;i++){ const x=Number(a[i]||0), y=Number(b[i]||0); dot+=x*y; aa+=x*x; bb+=y*y; } return aa&&bb ? dot/(Math.sqrt(aa)*Math.sqrt(bb)) : 0; }
async function embed(text){
  const key=GEMINI_KEY(); if(!key) return [];
  const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${EMBED_MODEL}:embedContent?key=${key}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:`models/${EMBED_MODEL}`,content:{parts:[{text:String(text||'').slice(0,3000)}]}})});
  const j=await r.json().catch(()=>({})); if(!r.ok) throw Error(j.error?.message || `Embedding failed ${r.status}`);
  return j.embedding?.values || [];
}
