const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');
let getStore = null;
try { ({ getStore } = require('@netlify/blobs')); } catch (_) { getStore = null; }
let STATIC_SEED = { artists:[], videos:[], state:{} };
try { STATIC_SEED = require('./site-data-seed.json'); } catch (_) {}

const ARTISTS = 'site_artists';
const VIDEOS = 'site_videos';
const STATE = 'site_state';
const PAGES = 'site_pages';
const ADMIN_PASSWORD = process.env.MELANKOLIA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'melankolia2025';
const BLOB_KEY = 'site-data.json';
function blobStore(){
  if (!getStore) return null;
  const opts = { name: process.env.MELANKOLIA_SITE_BLOBS_STORE || 'melankolia-site-data' };
  const siteID = process.env.MELANKOLIA_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.MELANKOLIA_BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}
async function readBlobState(){
  try { const store = blobStore(); return store ? await store.get(BLOB_KEY, { type:'json' }) : null; }
  catch(e) { return null; }
}
async function writeBlobState(data){
  const store = blobStore();
  if (!store) throw new Error('Netlify Blobs not configured');
  await store.setJSON(BLOB_KEY, data);
  return data;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {}
  try {
    const action = body.action || 'getArtists';
    if (action === 'getArtists') return json(200, { success:true, data: await getArtists() });
    if (action === 'getPages') return json(200, { success:true, data: await getPages() });
    if (action === 'publishArtists') {
      if (String(body.password || '') !== ADMIN_PASSWORD) return json(403, { success:false, error:'Invalid admin password' });
      return json(200, { success:true, data: await publishArtists(body) });
    }
    if (action === 'publishArtist') {
      if (String(body.password || '') !== ADMIN_PASSWORD) return json(403, { success:false, error:'Invalid admin password' });
      return json(200, { success:true, data: await publishArtist(body) });
    }
    if (action === 'publishPages') {
      if (String(body.password || '') !== ADMIN_PASSWORD) return json(403, { success:false, error:'Invalid admin password' });
      return json(200, { success:true, data: await publishPages(body) });
    }
    return json(400, { success:false, error:'Unknown action' });
  } catch(e) {
    return json(500, { success:false, error:e.message || 'site-data failed' });
  }
};


function normalizeMediaUrl(url){ return String(url || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/\?.*$/, '').replace(/\/+/g, '/'); }
function isBrandLogoMedia(url){ const u = normalizeMediaUrl(url).toLowerCase(); if (/\/images\/(?:automelodi_1|bestial_mouths_1|blood_handsome_1|blood_rave_1|bootblacks_0|cd_ghost_1|corbeau_hangs_1|creux_lies_1|dame_area_1|daniel_myer_1|die_sexual_1|donzii_1|jorge_elbrecht_1|light_asylum_1|male_tears_1|mellow_code_1|sacred_skin_1|secret_attraction_1|some_ember_1|street_fever_1|xtr_human_1|yama_uba_1|zanias_1)\.(?:jpe?g|png|webp)$/i.test(u)) return true; return /melankoliaagencylogo|logo-mark|logo_only|logoonly|blackonwhite|whiteontrans/.test(u) || /\/images\/(logo|melankolia).*\.svg$/.test(u); }
function isInlineDataImage(url){ return /^data:image\//i.test(String(url || '')); }
function stripInlineDataImagesDeep(value){
  if (typeof value === 'string') return isInlineDataImage(value) ? '' : value;
  if (Array.isArray(value)) return value.map(stripInlineDataImagesDeep).filter(v => !(typeof v === 'string' && !v));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k,v]) => { const cleaned = stripInlineDataImagesDeep(v); if (cleaned !== '' && cleaned != null) out[k] = cleaned; });
    return out;
  }
  return value;
}
function mediaKey(url){ return normalizeMediaUrl(url); }
function mediaVault(urls){ const out=[]; const seen=new Set(); (urls||[]).forEach(raw=>{ const url=String(raw||'').trim(); const key=mediaKey(url); if(!url||!key||isBrandLogoMedia(url)||seen.has(key)) return; seen.add(key); out.push(url); }); return out; }
function sanitizeArtistMedia(artist){ const a=stripInlineDataImagesDeep({...artist}); ['gridPhoto','photo','banner'].forEach(k=>{ if(isBrandLogoMedia(a[k])) a[k]=''; }); a.photos = mediaVault([a.gridPhoto, a.photo, a.banner, ...(Array.isArray(a.photos)?a.photos:String(a.photos||'').split('\n'))]); return a; }

function seedSnapshot(){ return { artists:Array.isArray(STATIC_SEED.artists)?STATIC_SEED.artists.slice():[], videos:Array.isArray(STATIC_SEED.videos)?STATIC_SEED.videos.slice():[], state:{ ...(STATIC_SEED.state||{}), storage:'static_seed' }, pages:{} }; }
function usableSnapshot(snap){ return snap && Array.isArray(snap.artists) && snap.artists.length >= 10; }
function now(){ return new Date().toISOString(); }
function docId(v){ return String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,120) || ('doc_'+Date.now()); }
async function upsert(collection, id, doc){
  const cur = await getDoc(collection, id);
  return cur ? updateDoc(collection, id, { ...cur, ...doc, updated_at:now() }) : createDoc(collection, { ...doc, created_at:now(), updated_at:now() }, id);
}

async function firestoreSnapshot(){
  const [artists, videos, state] = await Promise.all([
    listDocs(ARTISTS, { orderBy:'order', pageSize:100 }).catch(()=>[]),
    listDocs(VIDEOS, { orderBy:'order', pageSize:500 }).catch(()=>[]),
    getDoc(STATE, 'artists').catch(()=>null)
  ]);
  return { artists: artists.filter(a => !a.deleted_at).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)), videos: videos.filter(v => !v.deleted_at).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0)), state: state || {} };
}

async function publishArtist(body){
  const artist = body.artist && typeof body.artist === 'object' ? body.artist : null;
  if (!artist) throw new Error('No artist provided');
  const clean = sanitizeArtistMedia(artist);
  const slug = clean.slug || clean.name || clean.id;
  if (!slug) throw new Error('Artist slug/name required');
  const id = docId(slug);
  let snap = await readBlobState();
  if (!usableSnapshot(snap)) snap = await firestoreSnapshot();
  if (!usableSnapshot(snap)) snap = seedSnapshot();
  const artists = Array.isArray(snap.artists) ? snap.artists.slice() : [];
  const idx = artists.findIndex(a => docId(a.slug || a.name || a.id) === id);
  const order = body.order != null ? Number(body.order) : (idx >= 0 ? (artists[idx].order ?? idx) : artists.length);
  const next = { ...(idx >= 0 ? artists[idx] : {}), ...clean, slug: clean.slug || id, order, published_at:now(), updated_at:now() };
  if (idx >= 0) artists[idx] = next; else artists.push(next);
  artists.sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
  const state = { ...(snap.state || {}), kind:'artists', count:artists.length, video_count:(snap.videos||[]).length, data_version:body.data_version || snap.state?.data_version || '', published_at:now(), storage:'netlify_blobs' };
  await writeBlobState({ artists, videos: Array.isArray(snap.videos) ? snap.videos : [], state, pages: snap.pages || {} });
  // Firestore is now best-effort only; a quota failure must not block the save.
  try { await upsert(ARTISTS, id, next); await upsert(STATE, 'artists', state); } catch(e) {}
  return { id, slug: next.slug, order, saved:true, storage:'netlify_blobs', count:artists.length };
}

async function publishArtists(body){
  const artists = Array.isArray(body.artists) ? body.artists : [];
  const videos = Array.isArray(body.videos) ? body.videos : [];
  if (!artists.length) throw new Error('No artists provided');
  if (artists.length > 100) throw new Error('Too many artists');
  const cleanArtists = artists.map(sanitizeArtistMedia).map((artist, index) => ({ ...artist, slug: artist.slug || docId(artist.name || artist.id || String(index)), order: index, published_at:now(), updated_at:now() }));
  const cleanVideos = videos.slice(0,500).map((video,index)=>({ ...video, order:index, published_at:now(), updated_at:now() }));
  const prior = await readBlobState().catch(()=>null) || {};
  const state = { ...(prior.state || {}), kind:'artists', count:cleanArtists.length, video_count:cleanVideos.length, data_version:body.data_version || '', published_at:now(), storage:'netlify_blobs' };
  await writeBlobState({ artists:cleanArtists, videos:cleanVideos, state, pages:prior.pages || {} });
  // Firestore is legacy/best-effort now.
  try {
    await Promise.all(cleanArtists.map((artist) => upsert(ARTISTS, docId(artist.slug || artist.name || artist.id), artist)));
    await Promise.all(cleanVideos.map((video, index) => upsert(VIDEOS, docId(video.id || `${video.artistName || video.artistId || 'video'}-${index}`), video)));
    await upsert(STATE, 'artists', state);
  } catch(e) {}
  return { count:cleanArtists.length, video_count:cleanVideos.length, state, storage:'netlify_blobs' };
}

async function getArtists(){
  const blob = await readBlobState();
  if (usableSnapshot(blob)) {
    const artists = blob.artists.filter(a => !a.deleted_at).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    const videos = (Array.isArray(blob.videos) ? blob.videos : []).filter(v => !v.deleted_at).sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
    return { artists, videos, state: blob.state || { storage:'netlify_blobs' } };
  }
  const fsSnap = await firestoreSnapshot();
  return usableSnapshot(fsSnap) ? fsSnap : seedSnapshot();
}

async function publishPages(body){
  const pages = body.pages && typeof body.pages === 'object' ? body.pages : {};
  const clean = {};
  Object.entries(pages).forEach(([id, page]) => { clean[docId(id)] = { ...(page || {}), id: docId(id) }; });
  const prior = await readBlobState().catch(()=>null) || await firestoreSnapshot().catch(()=>({ artists:[], videos:[], state:{} }));
  const state = { ...(prior.state || {}), pages_count:Object.keys(clean).length, pages_data_version:body.data_version || '', pages_published_at:now(), updated_at:now(), storage:'netlify_blobs' };
  await writeBlobState({ artists: prior.artists || [], videos: prior.videos || [], state, pages:clean });
  try { const cur = await getDoc(STATE, 'artists').catch(()=>null); if (cur) await updateDoc(STATE, 'artists', { ...cur, pages:clean, pages_count:Object.keys(clean).length, pages_data_version:body.data_version || '', pages_published_at:now(), updated_at:now() }); } catch(e) {}
  return { count:Object.keys(clean).length, state, storage:'netlify_blobs' };
}

async function getPages(){
  const blob = await readBlobState();
  if (blob && blob.pages) return { pages: blob.pages || {}, state: blob.state ? { pages_count:blob.state.pages_count||0, pages_published_at:blob.state.pages_published_at||null, pages_data_version:blob.state.pages_data_version||'', storage:'netlify_blobs' } : null };
  const state = await getDoc(STATE, 'artists').catch(()=>null);
  return { pages: state?.pages || {}, state: state ? { pages_count:state.pages_count||0, pages_published_at:state.pages_published_at||null, pages_data_version:state.pages_data_version||'' } : null };
}
