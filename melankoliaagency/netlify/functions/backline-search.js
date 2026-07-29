// Melankolia Agency — Backline Finder API.
// This endpoint is intentionally FAST and never does the slow grounded
// research itself — it only creates a job doc and fires the async
// backline-worker-background function, then serves status polls. This
// removes the old synchronous-timeout ceiling (10-26s) that caused the
// tool to hit "FALLBACK MODE" whenever a grounded search ran a bit long.
//
// Actions:
//   start  { data:{...} }              -> { job_id, status:'pending' }
//   status { job_id }                  -> { status:'pending'|'done', data?, warning? }
//
// Self-healing: if a status poll finds a job stuck 'pending' past STALE_MS
// (the background worker should have finished or self-healed well before
// this), it synthesizes the fast planning fallback right there so the UI
// can never hang indefinitely even if the background invocation failed to
// fire at all.
const { createDoc, getDoc, updateDoc, json } = require('./_firebase');
const { fallbackBackline, clean } = require('./_backline-core');

const COLL = 'backline_jobs';
const STALE_MS = 55000; // background worker's own guard is 60s; self-heal a little before that as a safety net
const now = () => new Date().toISOString();
const jobId = () => `bl_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return json({ success: false, error: 'POST only' }, 405, headers);

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json({ success: false, error: 'Invalid JSON' }, 400, headers); }

  // Back-compat: old frontend bundles call with no `action`, just {data:{...}}.
  const action = body.action || (body.data ? 'start' : (body.job_id ? 'status' : ''));

  try {
    if (action === 'start') {
      const data = body.data || body;
      const city = clean(data.city || data.location);
      if (!city) return json({ success: false, error: 'city required' }, 400, headers);

      const id = jobId();
      await createDoc(COLL, { status: 'pending', input: data, created_at: now(), updated_at: now() }, id);

      // Fire-and-forget trigger of the background worker. Netlify responds to
      // this POST immediately (202) regardless of how long the worker itself
      // runs, so awaiting it should be fast; guard it anyway so a network
      // hiccup here can never slow down this endpoint.
      const site = process.env.SITE_BASE || 'https://melankoliaagency.com';
      const trigger = fetch(`${site}/.netlify/functions/backline-worker-background`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: id, data })
      }).catch(() => {});
      await Promise.race([trigger, new Promise(r => setTimeout(r, 4000))]);

      return json({ success: true, job_id: id, status: 'pending' }, 200, headers);
    }

    if (action === 'status') {
      const id = body.job_id;
      if (!id) return json({ success: false, error: 'job_id required' }, 400, headers);
      let doc = await getDoc(COLL, id);
      if (!doc) return json({ success: false, error: 'Unknown job_id' }, 404, headers);

      if (doc.status !== 'done') {
        const ageMs = Date.now() - new Date(doc.created_at || 0).getTime();
        if (ageMs > STALE_MS) {
          // Self-heal: the background worker should have finished by now (its
          // own guard is 60s) or already written its own fallback — if we're
          // still pending this late, the trigger likely never fired. Don't
          // make the user wait indefinitely.
          const warning = 'Background research did not report back in time; returned fast planning fallback instead.';
          const result = fallbackBackline(doc.input || {}, warning);
          await updateDoc(COLL, id, { status: 'done', result, warning, updated_at: now() }).catch(() => {});
          return json({ success: true, status: 'done', warning, data: result }, 200, headers);
        }
        return json({ success: true, status: 'pending' }, 200, headers);
      }

      return json({ success: true, status: 'done', warning: doc.warning || '', data: doc.result }, 200, headers);
    }

    return json({ success: false, error: 'Unknown action' }, 400, headers);
  } catch (e) {
    return json({ success: false, error: e.message || 'Backline search failed' }, 500, headers);
  }
};
