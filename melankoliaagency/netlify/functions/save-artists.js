/**
 * save-artists — the ONLY backend for the artist site.
 *
 * Source of truth is git: this commits artists.json and uploaded images
 * straight to the GitHub repo via the Contents API. The public site reads
 * the committed data from the GitHub CDN, so a save goes live without a
 * Netlify redeploy.
 *
 * Actions (POST JSON):
 *   { action:'get' }                                  -> { artists:[...] }   (public read, latest from main)
 *   { action:'save',   password, artists:[...] }      -> commit artists.json
 *   { action:'upload', password, slug, kind, filename, dataUrl } -> commit image, returns { path }
 *
 * Required env vars on Netlify:
 *   GITHUB_TOKEN            fine-grained PAT with Contents: read/write on the repo
 *   MELANKOLIA_ADMIN_PASSWORD (optional; defaults to melankolia2025)
 */
const OWNER = 'datadrian';
const REPO = 'melankoliaagency';
const BRANCH = 'main';
const BASE = 'melankoliaagency/public';
const DATA_PATH = BASE + '/artists.json';
const ADMIN_PASSWORD = process.env.MELANKOLIA_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || 'melankolia2025';
const GH = 'https://api.github.com';

function resp(status, body) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    },
    body: JSON.stringify(body)
  };
}

function ghHeaders() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured on the site');
  return {
    'Authorization': 'Bearer ' + token,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'melankolia-admin',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function getFile(path) {
  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}?ref=${BRANCH}`, { headers: ghHeaders() });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GitHub read failed: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

async function putFile(path, contentBase64, message, sha) {
  const body = { message, content: contentBase64, branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/${encodeURI(path)}`, {
    method: 'PUT', headers: ghHeaders(), body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error('GitHub write failed: ' + r.status + ' ' + (await r.text()).slice(0, 300));
  return r.json();
}

function purge(path) {
  // Best-effort CDN purge so the live site shows the change quickly.
  return fetch(`https://purge.jsdelivr.net/gh/${OWNER}/${REPO}@${BRANCH}/${path}`).catch(() => {});
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return resp(204, {});
  if (event.httpMethod !== 'POST') return resp(405, { success: false, error: 'POST only' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch (e) {}
  const action = body.action || 'get';

  try {
    if (action === 'get') {
      const f = await getFile(DATA_PATH);
      const json = f ? JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')) : { artists: [] };
      return resp(200, { success: true, artists: json.artists || [] });
    }

    // write actions require the admin password
    if (String(body.password || '') !== ADMIN_PASSWORD) {
      return resp(403, { success: false, error: 'Invalid admin password' });
    }

    if (action === 'upload') {
      const m = String(body.dataUrl || '').match(/^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
      if (!m) return resp(400, { success: false, error: 'Expected an image dataUrl' });
      const ext = m[2].toLowerCase().replace('jpeg', 'jpg');
      const slug = String(body.slug || 'artist').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'artist';
      const kind = body.kind === 'banner' ? '-banner' : '';
      const path = `${BASE}/images/artists/${slug}${kind}.${ext}`;
      const existing = await getFile(path);
      await putFile(path, m[3], `media: ${slug}${kind} via admin`, existing && existing.sha);
      const webPath = `/images/artists/${slug}${kind}.${ext}`;
      purge(`${BASE}/images/artists/${slug}${kind}.${ext}`);
      return resp(200, { success: true, path: webPath });
    }

    if (action === 'save') {
      if (!Array.isArray(body.artists)) return resp(400, { success: false, error: 'artists array required' });
      const existing = await getFile(DATA_PATH);
      const content = JSON.stringify({ artists: body.artists }, null, 2);
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      const out = await putFile(DATA_PATH, b64, 'content: update artists via admin', existing && existing.sha);
      await purge(DATA_PATH);
      return resp(200, { success: true, commit: out.commit && out.commit.sha, count: body.artists.length });
    }

    return resp(400, { success: false, error: 'Unknown action' });
  } catch (e) {
    return resp(500, { success: false, error: e.message || 'save-artists failed' });
  }
};
