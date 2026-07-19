// Contact Discovery — scan request queue. The admin panel files a request here;
// the Superagent reads pending requests, performs the Gmail scan + extraction,
// stages proposals via contact-proposals `stage`, then marks the request done.
const { listDocs, getDoc, createDoc, updateDoc, json } = require('./_firebase');
const COLL = 'contact_scan_requests';
const ADMIN_PW = () => process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const AGENT_KEY = () => process.env.CONTACT_DISCOVERY_KEY || process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';
const now = () => new Date().toISOString();
const id = () => `scan_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {}; try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }
  try {
    const isAdmin = b.password === ADMIN_PW();
    const isAgent = b.agent_key === AGENT_KEY();
    if (!isAdmin && !isAgent) return json(401, { success: false, error: 'Unauthorized' });

    if (b.action === 'request') {
      const doc = { status: 'pending', days: Number(b.days) || 90, created_at: now(), updated_at: now() };
      const saved = await createDoc(COLL, doc, id());
      return json(200, { success: true, id: saved.id });
    }
    if (b.action === 'pending') { // agent polls this
      if (!isAgent) return json(403, { success: false, error: 'agent_key required' });
      const docs = await listDocs(COLL, { orderBy: 'created_at desc', pageSize: 20 }).catch(() => []);
      return json(200, { success: true, data: docs.filter(d => (d.status || 'pending') === 'pending') });
    }
    if (b.action === 'complete') { // agent marks done
      if (!isAgent) return json(403, { success: false, error: 'agent_key required' });
      await updateDoc(COLL, b.id, { status: 'done', result: b.result || '', updated_at: now() });
      return json(200, { success: true });
    }
    return json(400, { success: false, error: 'Unknown action' });
  } catch (e) { return json(500, { success: false, error: e.message }); }
};
