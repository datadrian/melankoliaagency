// Shared staff-login authorization helper.
// Two ways to be authorized:
//   1. The master admin password (env MELANKOLIA_ADMIN_PASSWORD) — always full owner access.
//      This preserves Adrian's original single-password behavior and can never lock him out.
//   2. A session_token issued by admin-users.js `login` — resolved against the
//      admin_sessions Firestore collection, carrying a modules[] allowlist.
//
// authorize(body, moduleKey):
//   - moduleKey is the module this action requires (e.g. 'discovery', 'artists', 'advancing').
//   - Pass moduleKey = null/'' to just require ANY valid logged-in session (module-agnostic reads).
//   - Returns { ok:true, owner, username, modules } or { ok:false, error }.
const { getDoc } = require('./_firebase');

const MASTER = () => process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025';

async function authorize(body, moduleKey) {
  const b = body || {};
  if (b.password && String(b.password) === MASTER()) {
    return { ok: true, owner: true, username: b.username || 'owner', display_name: (b.username && b.username.trim()) || 'Adrian', modules: ['*'] };
  }
  const tok = b.session_token;
  if (tok) {
    let sess = null;
    try { sess = await getDoc('admin_sessions', String(tok)); } catch (e) { sess = null; }
    if (!sess) return { ok: false, error: 'Not authorized. Please log in again.' };
    if (sess.expires_at && new Date(sess.expires_at).getTime() < Date.now()) {
      return { ok: false, error: 'Your session expired. Please log in again.' };
    }
    if (sess.active === false) return { ok: false, error: 'Your login has been deactivated.' };
    const modules = Array.isArray(sess.modules) ? sess.modules : [];
    if (sess.is_owner || !moduleKey || modules.includes(moduleKey)) {
      return { ok: true, owner: !!sess.is_owner, username: sess.username || '', display_name: sess.display_name || sess.username || (sess.is_owner ? 'Adrian' : 'staff'), modules };
    }
    return { ok: false, error: 'Your login does not have access to this module.' };
  }
  return { ok: false, error: 'Not authorized. Please log in.' };
}

module.exports = { authorize, MASTER };
