// Melankolia Agency — Backline Finder background worker.
// Filename MUST end in "-background" — Netlify invokes this async: the HTTP
// caller gets an immediate 202 and this handler keeps running independently
// for up to 15 minutes, so it is never bound by the ~10-26s synchronous
// function ceiling that was causing Backline Finder to fall back constantly.
const { updateDoc, getDoc } = require('./_firebase');
const { fallbackBackline, researchBacklineStructured, withTimeout } = require('./_backline-core');

const COLL = 'backline_jobs';
const now = () => new Date().toISOString();

exports.handler = async (event) => {
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}
  const { job_id, data } = body;
  if (!job_id || !data) return { statusCode: 400, body: 'job_id and data required' };

  const apiKey = process.env.GEMINI_API_KEY_V2 || process.env.GEMINI_API_KEY;
  try {
    // Generous internal budget — real headroom vs the old 16-24s synchronous
    // guard, since this runs fully async with no caller waiting on it.
    const result = await withTimeout((async () => {
      if (!apiKey) { const e = new Error('GEMINI_API_KEY is not configured on Netlify'); throw e; }
      const parsed = await researchBacklineStructured(data, apiKey);
      return { ...parsed, researched_at: now() };
    })(), 60000, 'Deep grounded backline research took too long; returned fast planning fallback instead.');

    // Guard against a job that was already self-healed by a status poll while we worked.
    const existing = await getDoc(COLL, job_id).catch(() => null);
    if (existing && existing.status === 'done') return { statusCode: 202, body: '' };

    await updateDoc(COLL, job_id, { status: 'done', result, warning: '', updated_at: now() });
  } catch (e) {
    const warning = /timed out|took too long/i.test(e.message || '')
      ? e.message
      : `Deep grounded research was unavailable (${e.message || 'Gemini error'}); returned fast planning fallback instead.`;
    try {
      const existing = await getDoc(COLL, job_id).catch(() => null);
      if (!existing || existing.status !== 'done') {
        await updateDoc(COLL, job_id, { status: 'done', result: fallbackBackline(data, warning), warning, updated_at: now() });
      }
    } catch {}
  }
  return { statusCode: 202, body: '' };
};
