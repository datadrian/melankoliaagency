// Melankolia Agency — Site Data v2
// No-deploy parallel replacement for the legacy site-data function.
// Design goal: one canonical live public snapshot, explicit media roles, versioned restores, no browser-local state.

const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');

const CONTENT = 'site_content_v2';
const VERSIONS = 'site_content_versions_v2';
const LIVE_ID = 'live';
const ADMIN_PASSWORD = process.env.MELANKOLIA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'melankolia2025';

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch(e) {
    return json(400, { success:false, error:'Invalid JSON' });
  }

  try {
    const action = body.action || 'getPublicSiteData';
    if (action === 'getPublicSiteData') return json(200, { success:true, data: await getPublicSiteData() });
    if (action === 'getVersion') return json(200, { success:true, data: await getVersion(body.version_id || body.id) });
    if (action === 'listVersions') return json(200, { success:true, data: await listVersions() });

    requireAdmin(body);

    if (action === 'publishSnapshot') return json(200, { success:true, data: await publishSnapshot(body) });
    if (action === 'restoreVersion') return json(200, { success:true, data: await restoreVersion(body.version_id || body.id) });
    if (action === 'saveArtistMedia') return json(200, { success:true, data: await saveArtistMedia(body) });
    if (action === 'createVersion') return json(200, { success:true, data: await createVersion(body.notes || 'Manual snapshot') });

    return json(400, { success:false, error:'Unknown action' });
  } catch(e) {
    return json(e.status || 500, { success:false, error:e.message || 'site-data-v2 failed' });
  }
};

function now(){ return new Date().toISOString(); }
function requireAdmin(body){ if (String(body.password || '') !== ADMIN_PASSWORD) { const e = new Error('Invalid admin password'); e.status = 403; throw e; } }
function docId(v){ return String(v || '').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,140) || ('doc_' + Date.now()); }
async function upsert(collection, id, doc){
  const cur = await getDoc(collection, id);
  return cur ? updateDoc(collection, id, { ...cur, ...doc, updated_at:now() }) : createDoc(collection, { ...doc, created_at:now(), updated_at:now() }, id);
}

async function getPublicSiteData(){
  const live = await getDoc(CONTENT, LIVE_ID).catch(() => null);
  if (!live) return emptyPayload();
  return stripInternal(live);
}

async function publishSnapshot(body){
  const rawArtists = Array.isArray(body.artists) ? body.artists : [];
  const rawVideos = Array.isArray(body.videos) ? body.videos : [];
  if (!rawArtists.length) throw bad('No artists provided', 400);
  if (rawArtists.length > 200) throw bad('Too many artists for one public site snapshot', 400);
  if (rawVideos.length > 1000) throw bad('Too many videos for one public site snapshot', 400);

  const artists = rawArtists.map((a, index) => normalizeArtistV2(a, index));
  const videos = rawVideos.map((v, index) => normalizeVideoV2(v, index));
  const publishVersion = body.version_id || `publish_${now().replace(/[-:.TZ]/g,'').slice(0,14)}`;
  const payload = {
    kind:'site_content_v2',
    schema_version:2,
    publish_version:publishVersion,
    artists,
    videos,
    counts:{ artists:artists.length, videos:videos.length },
    notes:body.notes || '',
    published_at:now()
  };

  const saved = await upsert(CONTENT, LIVE_ID, payload);
  await upsert(VERSIONS, publishVersion, {
    kind:'site_content_version_v2',
    schema_version:2,
    version_id:publishVersion,
    snapshot:payload,
    counts:payload.counts,
    notes:body.notes || 'Published snapshot',
    created_at:now()
  });
  return { live:stripInternal(saved), version_id:publishVersion };
}

async function createVersion(notes='Manual snapshot'){
  const live = await getDoc(CONTENT, LIVE_ID);
  if (!live) throw bad('No live v2 snapshot exists', 404);
  const versionId = `snapshot_${now().replace(/[-:.TZ]/g,'').slice(0,14)}`;
  const saved = await upsert(VERSIONS, versionId, {
    kind:'site_content_version_v2',
    schema_version:2,
    version_id:versionId,
    snapshot:stripInternal(live),
    counts:live.counts || { artists:(live.artists||[]).length, videos:(live.videos||[]).length },
    notes,
    created_at:now()
  });
  return { version_id:versionId, counts:saved.counts, notes:saved.notes, created_at:saved.created_at };
}

async function restoreVersion(versionId){
  if (!versionId) throw bad('version_id required', 400);
  const version = await getDoc(VERSIONS, versionId);
  if (!version || !version.snapshot) throw bad('Version not found', 404);
  const restored = { ...version.snapshot, publish_version:`restored_${versionId}`, restored_from:versionId, restored_at:now(), published_at:now() };
  const saved = await upsert(CONTENT, LIVE_ID, restored);
  return { live:stripInternal(saved), restored_from:versionId };
}

async function getVersion(versionId){
  if (!versionId) throw bad('version_id required', 400);
  const version = await getDoc(VERSIONS, versionId);
  if (!version) throw bad('Version not found', 404);
  return version;
}

async function listVersions(){
  const versions = await listDocs(VERSIONS, { orderBy:'created_at desc', pageSize:50 }).catch(() => []);
  return versions.map(v => ({ id:v.id, version_id:v.version_id || v.id, counts:v.counts || {}, notes:v.notes || '', created_at:v.created_at || '', updated_at:v.updated_at || '' }));
}

async function saveArtistMedia(body){
  const slug = body.slug || body.artistSlug;
  if (!slug) throw bad('artist slug required', 400);
  const live = await getDoc(CONTENT, LIVE_ID);
  if (!live) throw bad('No live v2 snapshot exists', 404);
  const artists = Array.isArray(live.artists) ? live.artists.slice() : [];
  const idx = artists.findIndex(a => a.slug === slug);
  if (idx < 0) throw bad('Artist not found', 404);

  const current = artists[idx];
  const mediaPatch = normalizeMediaPatch(body.media || body);
  artists[idx] = {
    ...current,
    media:{ ...current.media, ...mediaPatch },
    updated_at:now()
  };

  const saved = await upsert(CONTENT, LIVE_ID, {
    ...live,
    artists,
    counts:{ artists:artists.length, videos:(live.videos||[]).length },
    updated_at:now()
  });
  return { artist:artists[idx], live_counts:saved.counts };
}

function normalizeArtistV2(a={}, index=0){
  const slug = a.slug || docId(a.name || a.id || index);
  const media = normalizeArtistMedia(a);
  return {
    id:a.id || slug,
    slug,
    name:a.name || slug,
    order:Number.isFinite(Number(a.order)) ? Number(a.order) : index,
    status:a.status || 'active',
    featured:!!a.featured,
    content:{
      shortBio:a.shortBio || '',
      bio:a.bio || '',
      genres:a.genres || '',
      location:a.location || '',
      quotes:Array.isArray(a.quotes) ? a.quotes : [],
      discography:Array.isArray(a.discography) ? a.discography : [],
      stats:a.stats || {}
    },
    links:{
      website:a.website || a.social_links?.website || '',
      instagram:a.instagram || a.social_links?.instagram || '',
      facebook:a.facebook || a.social_links?.facebook || '',
      spotify:a.spotify || a.social_links?.spotify || '',
      soundcloud:a.soundcloud || a.social_links?.soundcloud || '',
      youtube:a.youtube || a.social_links?.youtube || '',
      bandcamp:a.bandcamp || a.social_links?.bandcamp || '',
      bandsintown:a.bandsintown || a.social_links?.bandsintown || '',
      ra:a.ra || a.social_links?.ra || ''
    },
    media,
    // Transitional legacy fields for old public templates during migration only.
    gridPhoto:media.homepageTile.url,
    photo:media.profilePhoto.url,
    banner:media.bannerImage.url,
    gridFocalX:media.homepageTile.focalX,
    gridFocalY:media.homepageTile.focalY,
    gridCropScale:media.homepageTile.cropScale,
    profileFocalX:media.profilePhoto.focalX,
    profileFocalY:media.profilePhoto.focalY,
    profileCropScale:media.profilePhoto.cropScale,
    bannerFocalX:media.bannerImage.focalX,
    bannerFocalY:media.bannerImage.focalY,
    bannerCropScale:media.bannerImage.cropScale,
    schema_version:2,
    updated_at:a.updated_at || now(),
    published_at:a.published_at || now()
  };
}

function normalizeArtistMedia(a={}){
  return {
    homepageTile:roleFrom(a.gridPhoto || (a.gridImage ? `/images/${a.gridImage}` : ''), a.gridFocalX ?? a.focalX, a.gridFocalY ?? a.focalY, a.gridCropScale ?? a.cropScale),
    profilePhoto:roleFrom(a.photo || '', a.profileFocalX, a.profileFocalY, a.profileCropScale),
    bannerImage:roleFrom(a.banner || '', a.bannerFocalX, a.bannerFocalY, a.bannerCropScale),
    gallery:Array.isArray(a.photos) ? a.photos.filter(Boolean).map((url, order) => ({ assetId:assetId(url), url, caption:'', order })) : []
  };
}

function roleFrom(url='', focalX=50, focalY=50, cropScale=1){
  return { assetId:url ? assetId(url) : '', url:url || '', focalX:num(focalX,50), focalY:num(focalY,50), cropScale:num(cropScale,1) };
}
function normalizeMediaPatch(media={}){
  const out = {};
  if (media.homepageTile) out.homepageTile = roleFrom(media.homepageTile.url, media.homepageTile.focalX, media.homepageTile.focalY, media.homepageTile.cropScale);
  if (media.profilePhoto) out.profilePhoto = roleFrom(media.profilePhoto.url, media.profilePhoto.focalX, media.profilePhoto.focalY, media.profilePhoto.cropScale);
  if (media.bannerImage) out.bannerImage = roleFrom(media.bannerImage.url, media.bannerImage.focalX, media.bannerImage.focalY, media.bannerImage.cropScale);
  if (Array.isArray(media.gallery)) out.gallery = media.gallery.map((g, order) => ({ assetId:g.assetId || assetId(g.url), url:g.url || '', caption:g.caption || '', order:Number.isFinite(Number(g.order))?Number(g.order):order })).filter(g=>g.url);
  return out;
}
function normalizeVideoV2(v={}, index=0){
  const url = typeof v === 'string' ? v : (v.url || '');
  return {
    id:v.id || assetId(`${v.artistSlug || v.artistName || 'video'}-${url || index}`),
    artistSlug:v.artistSlug || v.artist_slug || '',
    artistName:v.artistName || v.artist_name || '',
    url,
    title:v.title || v.artistName || v.artist_name || 'Music Video',
    description:v.description || '',
    order:Number.isFinite(Number(v.order)) ? Number(v.order) : index,
    published_at:v.published_at || now()
  };
}
function assetId(url=''){ return 'asset_' + docId(String(url).replace(/^https?:\/\/[^/]+/,'').replace(/\?.*$/,'')); }
function num(v, fallback){ const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function emptyPayload(){ return { kind:'site_content_v2', schema_version:2, publish_version:null, artists:[], videos:[], counts:{artists:0,videos:0}, published_at:null }; }
function stripInternal(doc){ const { created_at, updated_at, id, ...rest } = doc || {}; return rest; }
function bad(message, status=400){ const e = new Error(message); e.status = status; return e; }
