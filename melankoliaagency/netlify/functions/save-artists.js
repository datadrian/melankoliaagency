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
// build: rev2
const { authorize } = require('./_auth');
const OWNER = 'datadrian';
const REPO = 'melankoliaagency';
const BRANCH = 'main';
const BASE = 'melankoliaagency/public';
const DATA_PATH = BASE + '/artists.json';
const SITEMAP_PATH = BASE + '/sitemap.xml';
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

function buildSitemap(artists) {
  const base = 'https://melankoliaagency.com';
  const lastmod = new Date().toISOString().slice(0, 10);
  const slugs = (artists || []).filter(a => a && a.slug && (a.status || 'active') !== 'inactive').map(a => String(a.slug)).sort();
  const entries = [['/', '1.0'], ['/booking', '0.9'], ['/submission', '0.7'], ['/videos', '0.7']]
    .concat(slugs.map(slug => ['/artists/' + encodeURIComponent(slug), '0.9']));
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(([path, priority]) => `  <url><loc>${base}${path}</loc><lastmod>${lastmod}</lastmod><changefreq>weekly</changefreq><priority>${priority}</priority></url>`).join('\n') +
    '\n</urlset>\n';
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

    // write actions require a valid staff login with 'artists' module access (or the master password)
    {
      const auth = await authorize(body, 'artists');
      if (!auth.ok) return resp(403, { success: false, error: auth.error });
    }

    if (action === 'upload') {
      const m = String(body.dataUrl || '').match(/^data:(image\/(png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/i);
      if (!m) return resp(400, { success: false, error: 'Expected an image dataUrl' });
      const ext = m[2].toLowerCase().replace('jpeg', 'jpg');
      const slug = String(body.slug || 'artist').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'artist';
      // Each upload lands in the artist's gallery folder with a unique name.
      const uniq = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rel = `images/artists/${slug}/${uniq}.${ext}`;
      await putFile(`${BASE}/${rel}`, m[3], `media: gallery photo for ${slug}`);
      purge(`${BASE}/${rel}`);
      return resp(200, { success: true, path: '/' + rel });
    }

    if (action === 'save') {
      if (!Array.isArray(body.artists)) return resp(400, { success: false, error: 'artists array required' });
      const existing = await getFile(DATA_PATH);
      // Always store roster alphabetically by name (matches public site ordering).
      const sortedArtists = body.artists.slice().sort((a, b) => String(a && a.name || '').toLowerCase().localeCompare(String(b && b.name || '').toLowerCase()));
      const content = JSON.stringify({ artists: sortedArtists }, null, 2);
      const b64 = Buffer.from(content, 'utf8').toString('base64');
      const out = await putFile(DATA_PATH, b64, 'content: update artists via admin', existing && existing.sha);
      // Keep Google discovery synchronized with the git-backed roster. This is
      // intentionally a second Contents API commit so both files remain visible
      // and auditable in the repository.
      const sitemapExisting = await getFile(SITEMAP_PATH);
      const sitemapBase64 = Buffer.from(buildSitemap(sortedArtists), 'utf8').toString('base64');
      const sitemapOut = await putFile(SITEMAP_PATH, sitemapBase64, 'seo: sync sitemap with artist roster', sitemapExisting && sitemapExisting.sha);
      await Promise.all([purge(DATA_PATH), purge(SITEMAP_PATH)]);
      return resp(200, { success: true, commit: sitemapOut.commit && sitemapOut.commit.sha || out.commit && out.commit.sha, count: sortedArtists.length, sitemap_count: sortedArtists.filter(a => a && a.slug && (a.status || 'active') !== 'inactive').length });
    }

    return resp(400, { success: false, error: 'Unknown action' });
  } catch (e) {
    return resp(500, { success: false, error: e.message || 'save-artists failed' });
  }
};
