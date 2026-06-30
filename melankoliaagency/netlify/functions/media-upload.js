const { getDoc, createDoc, json } = require('./_firebase');
let getStore = null;
try { ({ getStore } = require('@netlify/blobs')); } catch (_) { getStore = null; }

const ADMIN_PASSWORD = process.env.MELANKOLIA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'melankolia2025';
const COLLECTION = 'site_media_assets'; // legacy Firestore fallback for old asset ids
const MAX_BASE64_CHARS = 7000000; // ~5MB image; Blobs has no 1MiB doc limit like Firestore

function blobStore(){
  if (!getStore) return null;
  const opts = { name: process.env.MELANKOLIA_MEDIA_BLOBS_STORE || 'melankolia-media-assets' };
  const siteID = process.env.MELANKOLIA_BLOBS_SITE_ID || process.env.NETLIFY_SITE_ID || process.env.SITE_ID;
  const token = process.env.MELANKOLIA_BLOBS_TOKEN || process.env.NETLIFY_BLOBS_TOKEN || process.env.NETLIFY_AUTH_TOKEN;
  if (siteID && token) { opts.siteID = siteID; opts.token = token; }
  return getStore(opts);
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  try {
    if (event.httpMethod === 'GET') return serve(event);
    if (event.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
    let body = {}; try { body = JSON.parse(event.body || '{}'); } catch(e) {}
    if (String(body.password || '') !== ADMIN_PASSWORD) return json(403, { success:false, error:'Invalid admin password' });
    const dataUrl = String(body.dataUrl || '');
    const m = dataUrl.match(/^data:(image\/(?:png|jpeg|jpg|webp));base64,([A-Za-z0-9+/=]+)$/i);
    if (!m) return json(400, { success:false, error:'Expected compressed image dataUrl' });
    const mime = m[1].toLowerCase().replace('image/jpg','image/jpeg');
    const base64 = m[2];
    if (base64.length > MAX_BASE64_CHARS) return json(413, { success:false, error:'Image too large. Try a smaller source image.' });
    const original = safeName(body.filename || 'artist-photo');
    const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}_${original}`.slice(0,160);
    const bytes = Math.round(base64.length * 0.75);

    const store = blobStore();
    if (store) {
      // Primary path: store image bytes + mime in Netlify Blobs (no Firestore quota).
      await store.set(id, base64, { metadata: { mime, filename: original, bytes, created_at: new Date().toISOString(), source:'admin-media-upload' } });
    } else {
      // Fallback only if Blobs is unavailable: legacy Firestore.
      if (base64.length > 950000) return json(413, { success:false, error:'Image too large for fallback storage. Try a smaller source image.' });
      const doc = { id, filename: original, mime, base64, bytes, created_at: new Date().toISOString(), source:'admin-media-upload' };
      await createDoc(COLLECTION, doc, id);
    }

    const url = `/.netlify/functions/media-upload?id=${encodeURIComponent(id)}`;
    return json(200, { success:true, id, url, bytes, mime });
  } catch(e) {
    return json(e.status || 500, { success:false, error:e.message || 'media upload failed' });
  }
};

async function serve(event){
  const id = (event.queryStringParameters || {}).id;
  if (!id) return json(400, { success:false, error:'id required' });

  // Primary: Netlify Blobs.
  try {
    const store = blobStore();
    if (store) {
      const res = await store.getWithMetadata(id, { type: 'text' });
      if (res && res.data) {
        const mime = (res.metadata && res.metadata.mime) || 'image/jpeg';
        return { statusCode:200, headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public, max-age=31536000, immutable', 'Content-Type':mime }, body:res.data, isBase64Encoded:true };
      }
    }
  } catch (_) { /* fall through to legacy */ }

  // Legacy fallback: old assets still in Firestore.
  try {
    const doc = await getDoc(COLLECTION, id);
    if (doc && doc.base64) {
      return { statusCode:200, headers:{ 'Access-Control-Allow-Origin':'*', 'Cache-Control':'public, max-age=31536000, immutable', 'Content-Type':doc.mime || 'image/jpeg' }, body:doc.base64, isBase64Encoded:true };
    }
  } catch (_) {}

  return json(404, { success:false, error:'media not found' });
}

function safeName(name){ return String(name || 'artist-photo').toLowerCase().replace(/[^a-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,80) || 'artist-photo.jpg'; }
