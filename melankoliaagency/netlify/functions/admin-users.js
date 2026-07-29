// Team Access — staff logins with per-module permissions.
// Adrian (owner) logs in with the master password (unchanged habit) and gets a
// real session + full access. Staff get their own username/password and only
// see + can act on the modules Adrian ticks for them.
//
// Collections: admin_users (accounts), admin_sessions (issued logins, 14-day expiry).
// Passwords are never stored in plaintext — scrypt hash + per-user salt.
const crypto = require('crypto');
const { listDocs, getDoc, createDoc, updateDoc, deleteDoc, json } = require('./_firebase');
const { authorize } = require('./_auth');

const USERS = 'admin_users';
const SESSIONS = 'admin_sessions';
const SESSION_DAYS = 14;
const now = () => new Date().toISOString();
const token = () => crypto.randomBytes(24).toString('hex');
const norm = (s) => String(s || '').trim().toLowerCase();

const ALL_MODULES = ['artists', 'videos', 'bookings', 'venues', 'discovery', 'routes', 'emails', 'advancing', 'bands', 'pages', 'settings'];

function hashPassword(password, salt) {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), s, 64).toString('hex');
  return { salt: s, hash };
}
function verifyPassword(password, salt, hash) {
  try {
    const check = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
  } catch (e) { return false; }
}
function sanitizeModules(mods) {
  const arr = Array.isArray(mods) ? mods : [];
  return ALL_MODULES.filter(m => arr.includes(m));
}
function publicUser(u) {
  if (!u) return null;
  const { password_hash, password_salt, ...rest } = u;
  return rest;
}

async function findUserByUsername(username) {
  const uname = norm(username);
  const all = await listDocs(USERS, { pageSize: 500 }).catch(() => []);
  return all.find(u => norm(u.username) === uname) || null;
}

async function createSession({ user_id, username, display_name, modules, is_owner }) {
  const t = token();
  const doc = {
    user_id: user_id || '', username: username || '', display_name: display_name || username || '',
    modules: Array.isArray(modules) ? modules : [], is_owner: !!is_owner, active: true,
    created_at: now(), expires_at: new Date(Date.now() + SESSION_DAYS * 86400000).toISOString(),
  };
  await createDoc(SESSIONS, doc, t);
  return { token: t, ...doc };
}

async function login(b) {
  const master = b.password && String(b.password) === (process.env.MELANKOLIA_ADMIN_PASSWORD || 'melankolia2025');
  if (master) {
    const sess = await createSession({ username: b.username || 'owner', display_name: 'Owner', modules: ['*'], is_owner: true });
    return { success: true, token: sess.token, user: { username: sess.username, display_name: sess.display_name, modules: ALL_MODULES, is_owner: true } };
  }
  if (!b.username || !b.password) return { success: false, error: 'Username and password required' };
  const u = await findUserByUsername(b.username);
  if (!u || u.active === false) return { success: false, error: 'Invalid username or password' };
  if (!verifyPassword(b.password, u.password_salt, u.password_hash)) return { success: false, error: 'Invalid username or password' };
  const modules = sanitizeModules(u.modules);
  const sess = await createSession({ user_id: u.id, username: u.username, display_name: u.display_name, modules, is_owner: false });
  await updateDoc(USERS, u.id, { last_login: now() }).catch(() => {});
  return { success: true, token: sess.token, user: { username: u.username, display_name: u.display_name || u.username, modules, is_owner: false } };
}

async function verify(b) {
  if (!b.session_token) return { success: false, error: 'No session token' };
  const sess = await getDoc(SESSIONS, String(b.session_token));
  if (!sess) return { success: false, error: 'Invalid session' };
  if (sess.expires_at && new Date(sess.expires_at).getTime() < Date.now()) return { success: false, error: 'Session expired' };
  if (sess.active === false) return { success: false, error: 'Login deactivated' };
  return { success: true, user: { username: sess.username, display_name: sess.display_name || sess.username, modules: sess.is_owner ? ALL_MODULES : (sess.modules || []), is_owner: !!sess.is_owner } };
}

async function logoutFn(b) {
  if (b.session_token) await deleteDoc(SESSIONS, String(b.session_token)).catch(() => {});
  return { success: true };
}

async function listUsers() {
  const all = await listDocs(USERS, { orderBy: 'created_at desc', pageSize: 500 }).catch(() => []);
  return { success: true, data: all.map(publicUser) };
}

async function createUser(b) {
  const username = norm(b.username);
  if (!username) return { success: false, error: 'Username required' };
  if (!/^[a-z0-9._-]{3,32}$/.test(username)) return { success: false, error: 'Username must be 3-32 chars: letters, numbers, dot, dash, underscore' };
  if (!b.password || String(b.password).length < 6) return { success: false, error: 'Password must be at least 6 characters' };
  const existing = await findUserByUsername(username);
  if (existing) return { success: false, error: 'That username already exists' };
  const { salt, hash } = hashPassword(b.password);
  const doc = {
    username, display_name: b.display_name || username, modules: sanitizeModules(b.modules),
    password_salt: salt, password_hash: hash, active: true,
    created_at: now(), created_by: b.created_by_username || 'owner', last_login: '',
  };
  const saved = await createDoc(USERS, doc, `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  return { success: true, data: publicUser(saved) };
}

async function updateUser(b) {
  if (!b.id) return { success: false, error: 'id required' };
  const u = await getDoc(USERS, b.id);
  if (!u) return { success: false, error: 'User not found' };
  const patch = {};
  if (b.display_name !== undefined) patch.display_name = String(b.display_name || '').trim() || u.username;
  if (b.modules !== undefined) patch.modules = sanitizeModules(b.modules);
  if (b.active !== undefined) patch.active = !!b.active;
  if (b.new_password) {
    if (String(b.new_password).length < 6) return { success: false, error: 'Password must be at least 6 characters' };
    const { salt, hash } = hashPassword(b.new_password);
    patch.password_salt = salt; patch.password_hash = hash;
  }
  patch.updated_at = now();
  const saved = await updateDoc(USERS, b.id, { ...u, ...patch });
  // if deactivated, kill any live sessions for this user so access stops immediately
  if (b.active === false) {
    const sessions = await listDocs(SESSIONS, { pageSize: 500 }).catch(() => []);
    await Promise.all(sessions.filter(s => s.user_id === b.id).map(s => deleteDoc(SESSIONS, s.id).catch(() => {})));
  }
  return { success: true, data: publicUser(saved) };
}

async function deleteUser(b) {
  if (!b.id) return { success: false, error: 'id required' };
  await deleteDoc(USERS, b.id).catch(() => {});
  const sessions = await listDocs(SESSIONS, { pageSize: 500 }).catch(() => []);
  await Promise.all(sessions.filter(s => s.user_id === b.id).map(s => deleteDoc(SESSIONS, s.id).catch(() => {})));
  return { success: true };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(204, {});
  if (event.httpMethod !== 'POST') return json(405, { success: false, error: 'POST only' });
  let b = {};
  try { b = JSON.parse(event.body || '{}'); } catch { return json(400, { success: false, error: 'Invalid JSON' }); }
  try {
    if (b.action === 'login') return json(200, await login(b));
    if (b.action === 'verify') return json(200, await verify(b));
    if (b.action === 'logout') return json(200, await logoutFn(b));

    // everything below is owner-only team management
    const auth = await authorize(b, null);
    if (!auth.ok) return json(401, { success: false, error: auth.error });
    if (!auth.owner) return json(403, { success: false, error: 'Only the owner can manage team access' });

    if (b.action === 'list_users') return json(200, await listUsers());
    if (b.action === 'create_user') return json(200, await createUser({ ...b, created_by_username: auth.username }));
    if (b.action === 'update_user') return json(200, await updateUser(b));
    if (b.action === 'delete_user') return json(200, await deleteUser(b));
    if (b.action === 'modules') return json(200, { success: true, data: ALL_MODULES });

    return json(400, { success: false, error: 'Unknown action' });
  } catch (e) { return json(500, { success: false, error: e.message }); }
};
