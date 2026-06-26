/**
 * Shared Firebase Admin singleton for all Netlify functions.
 * Credentials come from env vars — never in source.
 */
const admin = require('firebase-admin');

let _app;

function getFirebase() {
  if (_app) return _app;
  
  const privateKey = process.env.FIREBASE_PRIVATE_KEY
    ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    : undefined;

  _app = admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
    databaseURL: `https://${process.env.FIREBASE_PROJECT_ID}.firebaseio.com`
  });

  return _app;
}

function getDb() {
  getFirebase();
  return admin.firestore();
}

function getAuth() {
  getFirebase();
  return admin.auth();
}

const COLS = {
  BANDS:        'bands',
  TOURS:        'tours',
  SHOWS:        'shows',
  SHEETS:       'advancing_sheets',
  SUBMISSIONS:  'promoter_submissions',
  NOTIFICATIONS:'admin_notifications',
  AUDIT:        'audit_logs',
};

module.exports = { getDb, getAuth, COLS, admin };
