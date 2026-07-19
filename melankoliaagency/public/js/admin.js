/* ================================================
   MELANKOLIA AGENCY — ADMIN JS v8
   ================================================ */

const RESEARCH_FUNCTION_URL = '/.netlify/functions/researchArtist';
const SITE_DATA_API = '/.netlify/functions/site-data';
const MEDIA_UPLOAD_API = '/.netlify/functions/media-upload';
const ADMIN_PUBLISH_PASSWORD = 'melankolia2025';

/* ==================== DATA LAYER ==================== */

const DATA_VERSION = '20-media-vault';

function initData() {
  // SMART MERGE: never wipe existing admin edits — only seed artists that don't exist yet
  // This runs on every version bump but preserves all user changes
  let existing = [];
  try { existing = JSON.parse(localStorage.getItem('mk_artists') || '[]'); } catch(e) {}
  const storedVersion = localStorage.getItem('mk_data_version');

  const needsFullSeed = existing.length === 0;
  const staticArtists = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists) ? MELANKOLIA_DATA.artists : [];

  if (needsFullSeed) {
    // First run: seed everything from static data
    const artists = staticArtists.map((a, i) => ({
      id: 'artist_' + i,
      name: a.name, slug: a.slug,
      genres: a.genres || '', location: a.location || '',
      bookingEmail: '', status: 'active', featured: !!a.featured,
      gridPhoto: a.gridImage ? '/images/' + a.gridImage : (a.image ? '/images/' + a.image : ''),
      photo: a.image ? '/images/' + a.image : '',
      banner: '', photos: (a.photos || []).map(p => p.startsWith('/') ? p : '/images/' + p), presskit: '', techRider: '',
      gridFocalX: a.gridFocalX ?? a.focalX ?? 50, gridFocalY: a.gridFocalY ?? a.focalY ?? 50, gridCropScale: a.gridCropScale ?? a.cropScale ?? 1,
      profileFocalX: a.profileFocalX ?? 50, profileFocalY: a.profileFocalY ?? 50, profileCropScale: a.profileCropScale ?? 1,
      profileFocalX: a.profileFocalX ?? 50, profileFocalY: a.profileFocalY ?? 50, profileCropScale: a.profileCropScale ?? 1,
          bannerFocalX: a.bannerFocalX ?? 50, bannerFocalY: a.bannerFocalY ?? 50, bannerCropScale: a.bannerCropScale ?? 1,
      focalX: a.gridFocalX ?? a.focalX ?? 50, focalY: a.gridFocalY ?? a.focalY ?? 50, cropScale: a.gridCropScale ?? a.cropScale ?? 1,
      spotify: a.social_links?.spotify || '',
      soundcloud: a.social_links?.soundcloud || '',
      bandcamp: a.social_links?.bandcamp || '',
      apple: '',
      instagram: a.social_links?.instagram || '',
      facebook: a.social_links?.facebook || '',
      youtube: a.social_links?.youtube || '',
      website: a.social_links?.website || '',
      bandsintown: a.social_links?.bandsintown || '',
      ra: a.social_links?.ra || '',
      shortBio: a.shortBio || '', bio: a.bio || '', quotes: '', notes: '',
      discography: Array.isArray(a.discography) ? a.discography : [], stats: {}, publishTargets: {}, epk: null,
      videos: [],
    }));
    saveArtists(artists);

    const vids = [];
    staticArtists.forEach((a, i) => {
      (a.music_videos || []).forEach((url, j) => {
        if (url) vids.push({ id: `vid_${i}_${j}`, artistId: 'artist_' + i, artistName: a.name, url, title: a.name, category: 'Music Video', featured: false });
      });
    });
    localStorage.setItem('mk_videos', JSON.stringify(vids));
  } else {
    // Subsequent version bumps: MERGE — add any brand-new static artists that are missing,
    // but NEVER overwrite an existing admin-edited artist record
    const existingSlugSet = new Set(existing.map(a => a.slug));
    let changed = false;
    staticArtists.forEach((a, i) => {
      if (!existingSlugSet.has(a.slug)) {
        existing.push({
          id: 'artist_' + i + '_' + Date.now(),
          name: a.name, slug: a.slug,
          genres: a.genres || '', location: a.location || '',
          bookingEmail: '', status: 'active', featured: !!a.featured,
          gridPhoto: a.gridImage ? '/images/' + a.gridImage : (a.image ? '/images/' + a.image : ''),
          photo: a.image ? '/images/' + a.image : '',
          banner: '', photos: (a.photos || []).map(p => p.startsWith('/') ? p : '/images/' + p), presskit: '', techRider: '',
          gridFocalX: a.gridFocalX ?? a.focalX ?? 50, gridFocalY: a.gridFocalY ?? a.focalY ?? 50, gridCropScale: a.gridCropScale ?? a.cropScale ?? 1,
      bannerFocalX: a.bannerFocalX ?? 50, bannerFocalY: a.bannerFocalY ?? 50, bannerCropScale: a.bannerCropScale ?? 1,
      focalX: a.gridFocalX ?? a.focalX ?? 50, focalY: a.gridFocalY ?? a.focalY ?? 50, cropScale: a.gridCropScale ?? a.cropScale ?? 1,
          spotify: a.social_links?.spotify || '',
          soundcloud: a.social_links?.soundcloud || '',
          bandcamp: a.social_links?.bandcamp || '',
          apple: '', instagram: a.social_links?.instagram || '',
          facebook: a.social_links?.facebook || '',
          youtube: a.social_links?.youtube || '',
          website: a.social_links?.website || '',
          bandsintown: a.social_links?.bandsintown || '',
          ra: a.social_links?.ra || '',
          shortBio: a.shortBio || '', bio: a.bio || '', quotes: '', notes: '',
          discography: Array.isArray(a.discography) ? a.discography : [], stats: {}, publishTargets: {}, epk: null,
          videos: [],
        });
        changed = true;
      }
    });
    // Versioned image migration: align main roster photos with original Google Sites scrape,
    // and keep the secondary scrape image as a bio/gallery photo without touching bios/links/EPK edits.
    // Run only once per DATA_VERSION so later manual photo/crop edits persist.
    if (storedVersion !== DATA_VERSION) {
      staticArtists.forEach((a) => {
        const rec = existing.find(x => x.slug === a.slug);
        if (!rec) return;
        // v17: protect manually selected media roles. Only backfill if fields are missing.
        if (a.gridImage && !rec.gridPhoto) rec.gridPhoto = '/images/' + a.gridImage;
        // v19: never auto-restore profile photos from static data. Manual profile choices must be authoritative.
        // Also quarantine any brand/logo file that accidentally entered artist media roles.
        if (stripBrandLogoMediaFromArtist(rec)) changed = true;
        const secondary = (a.photos || []).map(p => p.startsWith('/') ? p : '/images/' + p);
        if (secondary.length) {
          const current = Array.isArray(rec.photos) ? rec.photos : [];
          if (!current.length) rec.photos = secondary;
        }
        rec.photos = normalizeMediaVault([rec.gridPhoto, rec.photo, rec.banner, ...(Array.isArray(rec.photos) ? rec.photos : String(rec.photos || '').split('\n'))]);
        rec.gridFocalX = rec.gridFocalX ?? a.gridFocalX ?? 50;
        rec.gridFocalY = rec.gridFocalY ?? a.gridFocalY ?? 50;
        rec.gridCropScale = rec.gridCropScale ?? a.gridCropScale ?? 1;
        rec.profileFocalX = rec.profileFocalX ?? a.profileFocalX ?? 50;
        rec.profileFocalY = rec.profileFocalY ?? a.profileFocalY ?? 50;
        rec.profileCropScale = rec.profileCropScale ?? a.profileCropScale ?? 1;
        rec.bannerFocalX = rec.bannerFocalX ?? a.bannerFocalX ?? 50;
        rec.bannerFocalY = rec.bannerFocalY ?? a.bannerFocalY ?? 50;
        rec.bannerCropScale = rec.bannerCropScale ?? a.bannerCropScale ?? 1;
        // Legacy aliases kept for old front-end/cache compatibility; the homepage now reads grid* fields first.
        rec.focalX = rec.gridFocalX;
        rec.focalY = rec.gridFocalY;
        rec.cropScale = rec.gridCropScale;
        changed = true;
      });
    }
    // Static v16 enrichment: fill missing rebuilt discography/clean bios into existing localStorage records without overwriting manual media choices.
    let enriched = false;
    existing.forEach(rec => {
      const src = staticArtists.find(a => a.slug === rec.slug);
      if (!src) return;
      const recDisc = Array.isArray(rec.discography) ? rec.discography : [];
      if (!recDisc.length && Array.isArray(src.discography) && src.discography.length) { rec.discography = src.discography; enriched = true; }
      if (src.bio && !rec.bio) { rec.bio = src.bio; enriched = true; }
      if (src.shortBio && !rec.shortBio) { rec.shortBio = src.shortBio; enriched = true; }
    });
    if (changed || enriched) {
      createDataBackup('Before DATA_VERSION ' + DATA_VERSION + ' static enrichment');
      saveArtists(existing);
    }
  }

  localStorage.setItem('mk_data_version', DATA_VERSION);
}

function getArtists() { try { return JSON.parse(localStorage.getItem('mk_artists') || '[]'); } catch { return []; } }
function isQuotaError(e) { return e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || /quota/i.test(e.message || '')); }
function isInlineDataImage(url) { return /^data:image\//i.test(String(url || '')); }
function stripInlineDataImagesDeep(value) {
  if (typeof value === 'string') return isInlineDataImage(value) ? '' : value;
  if (Array.isArray(value)) return value.map(stripInlineDataImagesDeep).filter(v => !(typeof v === 'string' && !v));
  if (value && typeof value === 'object') {
    const out = {};
    Object.entries(value).forEach(([k,v]) => {
      const cleaned = stripInlineDataImagesDeep(v);
      if (cleaned !== undefined) out[k] = cleaned;
    });
    return out;
  }
  return value;
}
function artistAlphaSort(a,b){ return String(a?.name || '').localeCompare(String(b?.name || ''), undefined, {sensitivity:'base'}); }
function stripInlineDataImagesFromArtist(a) {
  const rec = stripInlineDataImagesDeep(a || {});
  if (Array.isArray(rec.photos)) rec.photos = rec.photos.filter(Boolean);
  ['gridPhoto','photo','banner'].forEach(k => { if (isInlineDataImage(rec[k])) rec[k] = ''; });
  return rec;
}
function compactArtistForStorage(a) {
  const rec = stripInlineDataImagesFromArtist(a);
  delete rec._debug; delete rec.researchPreview; delete rec.parserRawPreview; delete rec.rawResearch; delete rec.rawDossier;
  if (Array.isArray(rec.discography) && rec.discography.length > 40) rec.discography = rec.discography.slice(0, 40);
  if (Array.isArray(rec.press) && rec.press.length > 20) rec.press = rec.press.slice(0, 20);
  if (Array.isArray(rec.quotes) && rec.quotes.length > 20) rec.quotes = rec.quotes.slice(0, 20);
  if (Array.isArray(rec.videos) && rec.videos.length > 30) rec.videos = rec.videos.slice(0, 30);
  return rec;
}
function saveArtists(a) {
  const safeArtists = (a || []).map(stripInlineDataImagesFromArtist).map(rec => { stripBrandLogoMediaFromArtist(rec); rec.photos = normalizeMediaVault([rec.gridPhoto, rec.photo, rec.banner, ...(Array.isArray(rec.photos) ? rec.photos : String(rec.photos || '').split('\n'))]); return rec; }).sort(artistAlphaSort);
  const payload = JSON.stringify(safeArtists);
  try { localStorage.setItem('mk_artists', payload); return; }
  catch(e) {
    if (!isQuotaError(e)) throw e;
    console.warn('[Admin Storage] mk_artists quota exceeded. Clearing old backups and retrying.', e);
    try { localStorage.removeItem('mk_backups'); localStorage.removeItem('mk_artists'); } catch(_) {}
    try { localStorage.setItem('mk_artists', payload); showToast('✓ Saved after clearing old admin backups', 'success'); return; }
    catch(e2) {
      if (!isQuotaError(e2)) throw e2;
      const compact = safeArtists.map(compactArtistForStorage);
      localStorage.setItem('mk_artists', JSON.stringify(compact));
      showToast('✓ Saved compact artist data after clearing oversized browser cache', 'success');
    }
  }
}
async function publishArtistsToSite(showSuccess=true) {
  const artists = getArtists().sort(artistAlphaSort);
  const videos = getVideos();
  if (!artists.length) throw new Error('No artists to publish');
  const res = await fetch(SITE_DATA_API, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'publishArtists', password:ADMIN_PUBLISH_PASSWORD, artists, videos, pages:getPages(), data_version:DATA_VERSION }) });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.success === false) throw new Error(data.error || ('Publish failed: ' + res.status));
  localStorage.setItem('mk_last_site_publish', new Date().toISOString());
  if (showSuccess) showToast('✓ Published site data — fresh browsers will see these artist images', 'success');
  return data.data;
}
function injectPublishSiteButton() {
  if (document.getElementById('publishSiteDataBtn')) return;
  const target = document.querySelector('.admin-header-actions') || document.querySelector('.admin-header') || document.querySelector('.sidebar-footer') || document.body;
  const btn = document.createElement('button');
  btn.id = 'publishSiteDataBtn';
  btn.type = 'button';
  btn.className = 'btn-primary';
  btn.textContent = 'Publish Site Data';
  btn.title = 'Push local admin artist/media edits to the live public site for fresh browsers';
  btn.onclick = async () => { btn.disabled = true; const old = btn.textContent; btn.textContent = 'Publishing…'; try { await publishArtistsToSite(true); btn.textContent = '✓ Published'; setTimeout(()=>btn.textContent=old,1400); } catch(e) { showToast('✗ Publish failed — ' + e.message, 'error'); btn.textContent = old; } finally { btn.disabled = false; } };
  const loadBtn = document.createElement('button');
  loadBtn.id = 'loadPublishedSiteDataBtn';
  loadBtn.type = 'button';
  loadBtn.className = 'btn-secondary';
  loadBtn.textContent = 'Load Published Data';
  loadBtn.title = 'Recovery: replace this browser admin cache with the locked published Firestore artist/video data';
  loadBtn.onclick = async () => { loadBtn.disabled = true; const old = loadBtn.textContent; loadBtn.textContent = 'Loading…'; try { await loadPublishedSiteDataIntoAdmin(); loadBtn.textContent = '✓ Loaded'; setTimeout(()=>loadBtn.textContent=old,1400); } catch(e) { showToast('✗ Load failed — ' + e.message, 'error'); loadBtn.textContent = old; } finally { loadBtn.disabled = false; } };
  target.appendChild(btn);
  target.appendChild(loadBtn);
}
async function loadPublishedSiteDataIntoAdmin(){
  const res = await fetch(SITE_DATA_API, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'getArtists' }) });
  const data = await res.json().catch(()=>({}));
  const artists = data?.data?.artists || [];
  const videos = data?.data?.videos || [];
  if (!res.ok || !artists.length) throw new Error(data.error || 'No published artist data found');
  createDataBackup('Before loading published Firestore site data into admin');
  saveArtists(artists);
  localStorage.setItem('mk_videos', JSON.stringify(videos));
  localStorage.setItem('mk_data_version', DATA_VERSION);
  showToast(`✓ Loaded ${artists.length} published artists and ${videos.length} videos into admin`, 'success');
  try { renderDashboard(); renderArtistGrid(); renderVideoGrid(); } catch(e) {}
  return {artists:artists.length,videos:videos.length};
}
function normalizeMediaUrlForCompare(url) {
  return String(url || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/\?.*$/, '').replace(/\/+/g, '/');
}
function sameMediaUrl(a, b) {
  const aa = normalizeMediaUrlForCompare(a), bb = normalizeMediaUrlForCompare(b);
  return !!aa && !!bb && aa === bb;
}
function staticProfileUrl(src) {
  if (!src) return '';
  const raw = src.photo || src.image || '';
  if (!raw || isBrandLogoMedia(raw)) return '';
  return String(raw).startsWith('/') || String(raw).startsWith('http') || String(raw).startsWith('data:') ? raw : '/images/' + raw;
}
function isBrandLogoMedia(url) {
  const u = normalizeMediaUrlForCompare(url).toLowerCase();
  // Letterhead/logo strip scraped from old site (1280x184 MELANKOLIAAGEN banner, md5 90552aea...).
  // These exact files are the brand logo, not artist photos — quarantine them everywhere.
  if (/\/images\/(?:automelodi_1|bestial_mouths_1|blood_handsome_1|blood_rave_1|bootblacks_0|cd_ghost_1|corbeau_hangs_1|creux_lies_1|dame_area_1|daniel_myer_1|die_sexual_1|donzii_1|jorge_elbrecht_1|light_asylum_1|male_tears_1|mellow_code_1|sacred_skin_1|secret_attraction_1|some_ember_1|street_fever_1|xtr_human_1|yama_uba_1|zanias_1)\.(?:jpe?g|png|webp)$/i.test(u)) return true;
  return /melankoliaagencylogo|logo-mark|logo_only|logoonly|blackonwhite|whiteontrans/.test(u) || /\/images\/(logo|melankolia).*\.svg$/.test(u);
}
function stripBrandLogoMediaFromArtist(rec) {
  if (!rec) return false;
  let changed = false;
  ['gridPhoto','photo','banner'].forEach(k => { if (isBrandLogoMedia(rec[k])) { rec[k] = ''; changed = true; } });
  if (Array.isArray(rec.photos)) {
    const cleaned = rec.photos.filter(u => !isBrandLogoMedia(u));
    if (cleaned.length !== rec.photos.length) { rec.photos = cleaned; changed = true; }
  }
  return changed;
}
function getVideos()  { try { return JSON.parse(localStorage.getItem('mk_videos')  || '[]'); } catch { return []; } }
function saveVideos(v)  { localStorage.setItem('mk_videos', JSON.stringify(v)); }
function getBookings(){ try { return JSON.parse(localStorage.getItem('mk_bookings')|| '[]'); } catch { return []; } }

function createDataBackup(reason='Manual backup') {
  try {
    const backups = JSON.parse(localStorage.getItem('mk_backups') || '[]');
    const snap = {
      id: 'backup_' + Date.now(),
      date: new Date().toISOString(),
      reason,
      data: {
        mk_artists: localStorage.getItem('mk_artists') || '',
        mk_videos: localStorage.getItem('mk_videos') || '',
        mk_data_version: localStorage.getItem('mk_data_version') || '',
        mk_bookings: localStorage.getItem('mk_bookings') || ''
      }
    };
    backups.unshift(snap);
    localStorage.setItem('mk_backups', JSON.stringify(backups.slice(0, 3)));
    return snap.id;
  } catch(e) {
    if (isQuotaError(e)) {
      try { localStorage.removeItem('mk_backups'); } catch(_) {}
      console.warn('Backup skipped because browser storage quota is full', e);
    } else {
      console.warn('Backup failed', e);
    }
    return null;
  }
}
function getDataBackups() { try { return JSON.parse(localStorage.getItem('mk_backups') || '[]'); } catch { return []; } }
function restoreDataBackup(id) {
  const b = getDataBackups().find(x => x.id === id);
  if (!b) return alert('Backup not found.');
  if (!confirm('Restore this backup? Current admin data will be backed up first, then replaced.')) return;
  createDataBackup('Before restoring ' + new Date(b.date).toLocaleString());
  Object.entries(b.data || {}).forEach(([k,v]) => { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); });
  showToast('✓ Backup restored — refresh if needed', 'success');
  renderBackupManager(); renderDashboard(); renderArtistGrid(); renderVideoGrid();
}
function deleteDataBackup(id) {
  if (!confirm('Delete this backup snapshot?')) return;
  localStorage.setItem('mk_backups', JSON.stringify(getDataBackups().filter(b => b.id !== id)));
  renderBackupManager();
}
function renderBackupManager() {
  const el = document.getElementById('backupManager');
  if (!el) return;
  const backups = getDataBackups();
  if (!backups.length) { el.innerHTML = '<div class="empty-state">No backups yet.</div>'; return; }
  el.innerHTML = backups.map(b => `
    <div style="display:grid;grid-template-columns:1fr auto auto;gap:.75rem;align-items:center;padding:.75rem;border:1px solid var(--border);background:var(--card);margin-bottom:.5rem">
      <div>
        <div style="color:var(--white);font-size:.82rem">${escHtml(b.reason || 'Backup')}</div>
        <div style="color:var(--muted);font-size:.68rem">${escHtml(new Date(b.date).toLocaleString())}</div>
      </div>
      <button type="button" class="btn-secondary btn-sm" onclick="restoreDataBackup('${escAttr(b.id)}')">Restore</button>
      <button type="button" class="btn-danger btn-sm" onclick="deleteDataBackup('${escAttr(b.id)}')">Delete</button>
    </div>`).join('');
}

function resetAndReseed() {
  if (!confirm('Re-sync all artists from source? Manual edits will be lost. A backup will be created first.')) return;
  createDataBackup('Before forced re-sync');
  ['mk_artists','mk_videos','mk_data_version'].forEach(k => localStorage.removeItem(k));
  location.reload();
}

function escHtml(s) {
  return (String(s||'')).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtNum(n) {
  if (!n) return '—';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return Math.round(n/1000)+'K';
  return String(n);
}



/* ==================== PAGE EDITOR ==================== */
function defaultPages(){ return {
  about:{id:'about',label:'About',topText:`As specialists in artist management, we champion the enigmatic sounds of Dark Wave, Post-Punk, EBM, Dark Electro, Shoegaze, Industrial and Dark Techno. Our passion extends beyond borders; we're adept at bringing groundbreaking acts to the international stages, creating a cultural exchange that enriches the dark scene. Alongside artist management, we excel in dynamic promotion and enthralling content creation. From the introspective depths of shoegaze to the pulsating energy of dark techno, we're the architects of aural and visual experiences that captivate audiences globally.`,bottomText:`At Melankolia Agency, we believe in the transformative power of art and emotion. Our journey began with a profound appreciation for the depth and beauty of melancholia, a concept deeply rooted in our Finnish origins and reflected in our name.

Our story starts with Anna-Maria, the founder who grew up in Finland but found her footing in the dynamic music scene of Berlin. Her expertise in marketing and a personal passion for music and booking artists led her to a pivotal realization: her true calling was in connecting extraordinary talent with audiences craving profound experiences.

As our agency grew, we welcomed Adrian, a Los Angeles-based creative with a rich background in TV and film. His addition broadened our perspective, enabling us to evolve into more than a booking agency – we became a global sanctuary for creative expression.

Today, Melankolia Agency stands as a beacon of artistic collaboration, extending our reach across Europe, the U.S. and Latin America with a team of four. We offer a diverse range of services, including video production, marketing, tour management, and styling, all designed to curate experiences that resonate at a soulful level.

Join us on a journey where each note, beat, and frame contributes to a story worth cherishing. Melankolia Agency is more than a connector of talent; it's a celebration of the arts, a curator of emotions, and a guardian of the nuanced beauty found within melancholy.`,instagram:'https://www.instagram.com/melankoliaagency/',facebook:'https://www.facebook.com/melankoliaagency/'},
  submission:{id:'submission',label:'Submit Page',title:'Artist Submission',subtitle:`At Melankolia Agency, we're constantly on the lookout for artists and creators. If you resonate with the haunting melodies of Dark Wave, the raw energy of Post-Punk, the rhythmic pulse of EBM or Industrial, the electric vibes of Dark Electro, the immersive beats of Dark Techno or ethereal soundscapes of Shoegaze, Dream Pop or beyond we're looking for you.`,offerTitle:'What We Offer',offerText:'Expert artist management and booking, with a specialty in introducing U.S. acts to the vibrant European scene.\nInnovative promotion strategies to elevate your presence in the music world.\nCreative content creation, including visually stunning music videos and engaging social media content.',reachTitle:'Who Should Reach Out',reachText:'Bands and solo artists in the genre seeking management and booking.\nMusic creators looking for dynamic promotion and marketing.\nVisionaries desiring to collaborate on unique content creation projects.',contactText:`If you're passionate about making your mark in the dark and eager to expand your reach across continents, Melankolia Agency is your ally. Let's create something extraordinary together.`,formTitle:'Submit Your Material',formIntro:`Share your music, your vision, and your story with us. Send us an email at booking@MelankoliaAgency.com. Attach links to your music, a brief bio, and any relevant press materials. We're excited to hear from you and explore the potential of a thrilling collaboration.`},
  booking:{id:'booking',label:'Booking Page',title:'Booking Requests',subtitle:'For promoters, clubs, festivals and venues booking Melankolia Agency artists.'},
  home:{id:'home',label:'Home / Artists',title:'Artists',subtitle:'Melankolia Agency roster.'},
  videos:{id:'videos',label:'Videos',title:'Videos',subtitle:'Official videos and selected visual work.'}
};}
function getPages(){ try { return {...defaultPages(), ...JSON.parse(localStorage.getItem('mk_pages')||'{}')}; } catch { return defaultPages(); } }
function savePages(pages){ localStorage.setItem('mk_pages', JSON.stringify(pages)); }
async function publishPagesToSite(){ const pages=getPages(); const res=await fetch(SITE_DATA_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'publishPages',password:ADMIN_PUBLISH_PASSWORD,pages,data_version:DATA_VERSION})}); const data=await res.json().catch(()=>({})); if(!res.ok||!data.success) throw new Error(data.error||'Publish failed'); return data.data; }
function renderPageEditor(){ const pages=getPages(); const ids=Object.keys(pages); const host=document.getElementById('pageEditorHost'); if(!host) return; const active=localStorage.getItem('mk_page_editor_active')||'about'; const page=pages[active]||pages.about; host.innerHTML=`<div class="view-header"><h1>Page Editor</h1><button class="btn-primary" onclick="savePageEditorForm(true)">Save + Publish Pages</button></div><div style="display:grid;grid-template-columns:220px 1fr;gap:1rem"><div class="admin-card">${ids.map(id=>`<button type="button" class="qa-btn" style="width:100%;margin-bottom:.4rem;${id===active?'border-color:#fff;color:#fff':''}" onclick="localStorage.setItem('mk_page_editor_active','${id}');renderPageEditor()">${escHtml(pages[id].label||id)}${pages[id].hidden?' <span style=&quot;color:#e07a5f&quot;>(hidden)</span>':''}</button>`).join('')}</div><form class="admin-card" onsubmit="savePageEditorForm(false);return false"><input type="hidden" id="pageEditId" value="${escHtml(active)}"><div class="form-group"><label>Label</label><input id="pageLabel" class="form-input" value="${escHtml(page.label||active)}"></div><div class="form-group" style="display:flex;align-items:center;gap:.55rem;padding:.6rem .75rem;border:1px solid #333;border-radius:6px;background:#1a1a1a"><input type="checkbox" id="pageHidden" ${page.hidden?'checked':''} style="width:16px;height:16px;cursor:pointer"><label for="pageHidden" style="margin:0;cursor:pointer">Hide this page (removes it from the site nav and blocks the page)</label></div>${Object.keys(page).filter(k=>!['id','label','hidden','order','published_at','created_at','updated_at'].includes(k)).map(k=>`<div class="form-group"><label>${escHtml(k)}</label><textarea class="form-input form-textarea page-field-input" data-key="${escHtml(k)}" rows="${String(page[k]||'').length>180?8:3}">${escHtml(page[k]||'')}</textarea></div>`).join('')}<button class="btn-secondary">Save locally</button></form></div><p class="view-sub" style="margin-top:1rem">About and Submit are live-wired to these records. Other page records are staged here for the next templates.</p>`; }
function savePageEditorForm(publish){ const pages=getPages(); const id=document.getElementById('pageEditId')?.value||'about'; pages[id]=pages[id]||{id}; pages[id].id=id; pages[id].label=document.getElementById('pageLabel')?.value||id; document.querySelectorAll('.page-field-input').forEach(el=>pages[id][el.dataset.key]=el.value); pages[id].hidden=!!document.getElementById('pageHidden')?.checked; savePages(pages); showToast('✓ Page saved locally','success'); if(publish) publishPagesToSite().then(()=>showToast('✓ Pages published','success')).catch(e=>showToast('✗ Page publish failed — '+e.message,'error')); }

/* ==================== NAVIGATION ==================== */

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-link[data-view]').forEach(l => l.classList.remove('active'));
  const v = document.getElementById('view-' + name);
  if (v) v.classList.add('active');
  const link = document.querySelector(`.sidebar-link[data-view="${name}"]`);
  if (link) link.classList.add('active');
  if (name === 'dashboard') renderDashboard();
  if (name === 'artists')   renderArtistGrid();
  if (name === 'research')  initResearchPage();
  if (name === 'epk')       renderEPKList();
  if (name === 'videos')    renderVideoGrid();
  if (name === 'bookings')  renderBookings();
  if (name === 'routes' && typeof initRoutePlannerAdmin === 'function') initRoutePlannerAdmin();
  if (name === 'emails' && typeof initEmailGenerator === 'function') initEmailGenerator();
  if (name === 'advancing' && typeof initAdvancing === 'function') initAdvancing();
  if (name === 'bands' && typeof initBandAccess === 'function') initBandAccess();
  if (name === 'settings')  renderBackupManager();
  if (name === 'pages')     renderPageEditor();
  if (name === 'discovery') initContactDiscovery();
}

document.querySelectorAll('.sidebar-link[data-view]').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); showView(link.dataset.view); });
});

/* ==================== DASHBOARD ==================== */

function renderDashboard() {
  const artists  = getArtists();
  const videos   = getVideos();
  document.getElementById('statArtists').textContent  = artists.filter(a => a.status === 'active').length;
  document.getElementById('statVideos').textContent   = videos.length;
  document.getElementById('statEpks').textContent     = artists.filter(a => a.epk).length;
  document.getElementById('statBookings').textContent = getBookings().length;
}

/* ==================== ARTIST GRID ==================== */

function renderArtistGrid(filter) {
  filter = filter || '';
  const grid = document.getElementById('artistAdminGrid');
  if (!grid) return;
  const artists = getArtists().filter(a =>
    !filter || a.name.toLowerCase().includes(filter.toLowerCase())
  );
  if (!artists.length) {
    grid.innerHTML = '<div class="empty-state">No artists found.</div>';
    return;
  }
  grid.innerHTML = artists.map(a => `
    <div class="artist-admin-card">
      <div class="artist-status-dot ${a.status !== 'active' ? 'inactive' : ''}"></div>
      ${(a.gridPhoto || a.photo)
        ? `<img class="artist-admin-card-img" src="${escHtml(a.gridPhoto || a.photo)}" alt="${escHtml(a.name)}" onerror="this.style.display='none'">`
        : `<div class="artist-admin-card-placeholder">${escHtml(a.name[0]||'?')}</div>`}
      <div class="artist-admin-info">
        <div class="artist-admin-name">${escHtml(a.name)}</div>
        <div class="artist-admin-genre">${escHtml(a.genres||'—')}</div>
        <div class="artist-admin-actions">
          <button class="btn-secondary btn-sm" onclick="editArtist('${a.id}')">Edit</button>
          <button class="btn-secondary btn-sm" onclick="openArtistPageEditor('${a.id}')">Page Edit</button>
          <button class="btn-secondary btn-sm" onclick="openResearchForArtist('${a.id}')">✦ AI</button>
          <button class="btn-secondary btn-sm" onclick="openEPK('${a.id}')">EPK</button>
          <button class="btn-danger btn-sm" onclick="deleteArtist('${a.id}')">✕</button>
        </div>
      </div>
    </div>`).join('');
}

(function() {
  const el = document.getElementById('adminArtistSearch');
  if (el) el.addEventListener('input', e => renderArtistGrid(e.target.value));
})();

function openArtistPageEditor(id) {
  const a = getArtists().find(x => x.id === id);
  if (!a) return showToast('Artist not found', 'error');
  const slug = a.slug || slugify(a.name || 'artist');
  window.open('/artists/' + slug + '/?edit=1', '_blank');
}

function editArtist(id) {
  const a = getArtists().find(x => x.id === id);
  if (a) showArtistForm(a);
}

function deleteArtist(id) {
  if (!confirm('Delete this artist?')) return;
  saveArtists(getArtists().filter(a => a.id !== id));
  renderArtistGrid();
  renderDashboard();
}

function openResearchForArtist(id) {
  _researchPreselect = id;
  showView('research');
}

/* ==================== ARTIST FORM (MODAL) ==================== */


function resetArtistFormMediaState() {
  ['aGridPhoto','aPhoto','aBanner','aNewPhotoUrl','aPhotos'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['photoPreview','profilePhotoPreview','bannerPreview','aPhotoLibrary'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = id === 'aPhotoLibrary' ? '' : '<span>No image</span>'; });
  hideFocalEditor();
  hideProfileFocalEditor();
  hideBannerFocalEditor();
  ['focalImg','profileFocalImg','bannerFocalImg'].forEach(id => { const img = document.getElementById(id); if (img) img.removeAttribute('src'); });
  ['aFocalX','aFocalY','aProfileFocalX','aProfileFocalY','aBannerFocalX','aBannerFocalY'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 50; });
  ['aCropScale','aProfileCropScale','aBannerCropScale'].forEach(id => { const el = document.getElementById(id); if (el) el.value = 1; });
}

function showArtistForm(data) {
  data = data || {};
  document.getElementById('artistForm')?.reset();
  resetArtistFormMediaState();
  document.getElementById('artistFormTitle').textContent = data.id ? 'Edit Artist' : 'Add Artist';
  document.getElementById('editArtistId').value = data.id || '';
  [['aName','name'],['aSlug','slug'],['aGenres','genres'],['aLocation','location'],
   ['aBookingEmail','bookingEmail'],['aStatus','status'],['aFeatured','featured'],
   ['aGridPhoto','gridPhoto'],['aPhoto','photo'],['aBanner','banner'],['aPresskit','presskit'],['aTechRider','techRider'],
   ['aFocalX','gridFocalX'],['aFocalY','gridFocalY'],['aCropScale','gridCropScale'],
   ['aProfileFocalX','profileFocalX'],['aProfileFocalY','profileFocalY'],['aProfileCropScale','profileCropScale'],
   ['aBannerFocalX','bannerFocalX'],['aBannerFocalY','bannerFocalY'],['aBannerCropScale','bannerCropScale'],
   ['aSpotify','spotify'],['aSoundcloud','soundcloud'],['aBandcamp','bandcamp'],
   ['aApple','apple'],['aInstagram','instagram'],['aFacebook','facebook'],
   ['aYoutube','youtube'],['aWebsite','website'],['aBandsintown','bandsintown'],['aRA','ra'],
   ['aShortBio','shortBio'],['aBio','bio'],['aQuotes','quotes'],['aNotes','notes']
  ].forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (el) el.value = data[key] !== undefined ? data[key] : '';
  });
  if (document.getElementById('aGridPhoto') && !document.getElementById('aGridPhoto').value) document.getElementById('aGridPhoto').value = data.gridPhoto || data.photo || (!data.id && data.image ? '/images/' + data.image : '');
  if (document.getElementById('aPhoto') && !document.getElementById('aPhoto').value) document.getElementById('aPhoto').value = data.photo || (!data.id && data.image ? '/images/' + data.image : '');
  // Backfill new separate crop fields from legacy records when editing older localStorage data.
  if (document.getElementById('aFocalX') && !document.getElementById('aFocalX').value) document.getElementById('aFocalX').value = data.focalX ?? 50;
  if (document.getElementById('aFocalY') && !document.getElementById('aFocalY').value) document.getElementById('aFocalY').value = data.focalY ?? 50;
  if (document.getElementById('aCropScale') && !document.getElementById('aCropScale').value) document.getElementById('aCropScale').value = data.cropScale ?? 1;
  if (document.getElementById('aProfileFocalX') && !document.getElementById('aProfileFocalX').value) document.getElementById('aProfileFocalX').value = data.profileFocalX ?? 50;
  if (document.getElementById('aProfileFocalY') && !document.getElementById('aProfileFocalY').value) document.getElementById('aProfileFocalY').value = data.profileFocalY ?? 50;
  if (document.getElementById('aProfileCropScale') && !document.getElementById('aProfileCropScale').value) document.getElementById('aProfileCropScale').value = data.profileCropScale ?? 1;
  if (document.getElementById('aBannerFocalX') && !document.getElementById('aBannerFocalX').value) document.getElementById('aBannerFocalX').value = data.bannerFocalX ?? 50;
  if (document.getElementById('aBannerFocalY') && !document.getElementById('aBannerFocalY').value) document.getElementById('aBannerFocalY').value = data.bannerFocalY ?? 50;
  if (document.getElementById('aBannerCropScale') && !document.getElementById('aBannerCropScale').value) document.getElementById('aBannerCropScale').value = data.bannerCropScale ?? 1;
  const photosEl = document.getElementById('aPhotos');
  if (photosEl) photosEl.value = normalizeMediaVault([data.gridPhoto, data.photo, data.banner, ...(Array.isArray(data.photos) ? data.photos : String(data.photos || '').split('\n'))]).join('\n');
  const discogEl = document.getElementById('aDiscography');
  if (discogEl) discogEl.value = data.discography ? JSON.stringify(data.discography, null, 2) : '';
  const videosEl = document.getElementById('aVideos');
  if (videosEl) {
    videosEl.value = Array.isArray(data.videos)
      ? data.videos.map(v => typeof v === 'string' ? v : ((v.title ? v.title + ' | ' : '') + (v.url || ''))).filter(Boolean).join('\n')
      : '';
  }
  updateImgPreview('aGridPhoto','photoPreview');
  updateImgPreview('aPhoto','profilePhotoPreview');
  renderPhotoLibrary();
  updateImgPreview('aBanner','bannerPreview');
  switchTab('basic');
  setTimeout(initDropZones, 50);
  // Focal editor — runs AFTER all fields are populated so focalX/Y values are ready
  setTimeout(function() {
    var ph = document.getElementById('aGridPhoto');
    var bn = document.getElementById('aBanner');
    if (ph && ph.value) showFocalEditor(ph.value);
    if (bn && bn.value) showBannerFocalEditor(bn.value);
    var pr = document.getElementById('aPhoto');
    if (pr && pr.value) showProfileFocalEditor(pr.value);
  }, 80);
  document.getElementById('artistModal').classList.add('open');
}


/* ============================================================
   FOCAL POINT EDITOR
   ============================================================ */

function updateCropScaleUI() {
  const fx = parseFloat(document.getElementById('aFocalX')?.value || 50);
  const fy = parseFloat(document.getElementById('aFocalY')?.value || 50);
  const sc = parseFloat(document.getElementById('aCropScale')?.value || 1);
  const img = document.getElementById('focalImg');
  const label = document.getElementById('cropScaleLabel');
  const slider = document.getElementById('cropScaleSlider');
  if (slider) slider.value = sc;
  if (label) label.textContent = sc.toFixed(2) + '×';
  if (img) {
    img.style.objectPosition = fx + '% ' + fy + '%';
    img.style.transformOrigin = fx + '% ' + fy + '%';
    img.style.transform = 'scale(' + sc + ')';
  }
  updateImgPreview('aGridPhoto', 'photoPreview');
}

function setCropScale(v) {
  const sc = Math.max(1, Math.min(2.5, parseFloat(v || 1)));
  const el = document.getElementById('aCropScale');
  if (el) el.value = sc.toFixed(2);
  updateCropScaleUI();
}

function showFocalEditor(src) {
  const editor  = document.getElementById('focalEditor');
  const img     = document.getElementById('focalImg');
  const cross   = document.getElementById('focalCrosshair');
  const coordEl = document.getElementById('focalCoords');
  if (!editor || !src) return;
  img.src = src;
  img.onload = function() {
    editor.style.display = 'block';
    const fxEl = document.getElementById('aFocalX');
    const fyEl = document.getElementById('aFocalY');
    const scEl = document.getElementById('aCropScale');
    const fx = parseFloat(fxEl && fxEl.value ? fxEl.value : 50);
    const fy = parseFloat(fyEl && fyEl.value ? fyEl.value : 50);
    const sc = parseFloat(scEl && scEl.value ? scEl.value : 1);
    cross.style.left = fx + '%';
    cross.style.top  = fy + '%';
    if(coordEl) coordEl.textContent = fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
    updateCropScaleUI();
  };
}

(function initFocalEditorEvents() {
  document.addEventListener('click', function(e) {
    const wrap = e.target.closest('#focalCanvasWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width  * 100);
    const y = ((e.clientY - rect.top)  / rect.height * 100);
    const fx = Math.max(0, Math.min(100, x));
    const fy = Math.max(0, Math.min(100, y));
    const cross   = document.getElementById('focalCrosshair');
    const coordEl = document.getElementById('focalCoords');
    const fxEl    = document.getElementById('aFocalX');
    const fyEl    = document.getElementById('aFocalY');
    if(cross) { cross.style.left = fx + '%'; cross.style.top = fy + '%'; }
    if(fxEl) fxEl.value = fx.toFixed(2);
    if(fyEl) fyEl.value = fy.toFixed(2);
    const sc = parseFloat(document.getElementById('aCropScale')?.value || 1);
    if(coordEl) coordEl.textContent = fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
    updateCropScaleUI();
  });
})();

function resetFocalPoint() {
  document.getElementById('aFocalX').value = 50;
  document.getElementById('aFocalY').value = 50;
  document.getElementById('aCropScale').value = 1;
  const cross   = document.getElementById('focalCrosshair');
  const coordEl = document.getElementById('focalCoords');
  if(cross) { cross.style.left = '50%'; cross.style.top = '50%'; }
  if(coordEl) coordEl.textContent = '50.0%, 50.0% · 1.00×';
  updateCropScaleUI();
}

function applyFocalPoint() {
  const fxEl = document.getElementById('aFocalX');
  const fyEl = document.getElementById('aFocalY');
  const src  = document.getElementById('aGridPhoto').value;
  if (!src) return;

  const fx = parseFloat(fxEl && fxEl.value ? fxEl.value : 50);
  const fy = parseFloat(fyEl && fyEl.value ? fyEl.value : 50);
  const sc = parseFloat(document.getElementById('aCropScale')?.value || 1);

  // Persist immediately to the current artist record so the grid/page updates
  const id = document.getElementById('editArtistId').value;
  if (id) {
    const artists = getArtists();
    const idx = artists.findIndex(a => a.id === id);
    if (idx > -1) {
      artists[idx].gridPhoto = normalizePhotoUrlForForm(src);
      artists[idx].photos = normalizeMediaVault([...artistMediaVault(artists[idx]), artists[idx].gridPhoto]);
      artists[idx].gridFocalX = fx;
      artists[idx].gridFocalY = fy;
      artists[idx].gridCropScale = sc;
      artists[idx].focalX = fx;
      artists[idx].focalY = fy;
      artists[idx].cropScale = sc;
      saveArtists(artists);
      scheduleMediaAutoPublish('tile image');
      showToast('✓ Tile image saved — ' + fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×', 'success');
    }
  } else {
    // New artist not yet saved — just confirm; values persist on form save
    showToast('✓ Focal point set — save the artist to keep it', 'success');
  }

  // Live preview on the focal image itself
  const fImg = document.getElementById('focalImg');
  if (fImg) {
    fImg.style.objectPosition = fx + '% ' + fy + '%';
    fImg.style.transformOrigin = fx + '% ' + fy + '%';
    fImg.style.transform = 'scale(' + sc + ')';
  }

  // Refresh BOTH the photo and banner previews so they reflect the new focal crop
  updateImgPreview('aGridPhoto', 'photoPreview');
  updateImgPreview('aBanner', 'bannerPreview');

  // Flash confirmation on the button
  const btn = document.querySelector('[onclick="applyFocalPoint()"]');
  if(btn) { const orig = btn.textContent; btn.textContent = '✓ Applied'; setTimeout(()=>btn.textContent=orig, 1200); }
}


function updateBannerCropScaleUI() {
  const fx = parseFloat(document.getElementById('aBannerFocalX')?.value || 50);
  const fy = parseFloat(document.getElementById('aBannerFocalY')?.value || 50);
  const sc = parseFloat(document.getElementById('aBannerCropScale')?.value || 1);
  const img = document.getElementById('bannerFocalImg');
  const label = document.getElementById('bannerCropScaleLabel');
  const slider = document.getElementById('bannerCropScaleSlider');
  if (slider) slider.value = sc;
  if (label) label.textContent = sc.toFixed(2) + '×';
  if (img) {
    img.style.objectPosition = fx + '% ' + fy + '%';
    img.style.transformOrigin = fx + '% ' + fy + '%';
    img.style.transform = 'scale(' + sc + ')';
  }
  updateImgPreview('aBanner', 'bannerPreview');
}

function setBannerCropScale(v) {
  const sc = Math.max(1, Math.min(2.5, parseFloat(v || 1)));
  const el = document.getElementById('aBannerCropScale');
  if (el) el.value = sc.toFixed(2);
  updateBannerCropScaleUI();
}

function showBannerFocalEditor(src) {
  const editor  = document.getElementById('bannerFocalEditor');
  const img     = document.getElementById('bannerFocalImg');
  const cross   = document.getElementById('bannerFocalCrosshair');
  const coordEl = document.getElementById('bannerFocalCoords');
  if (!editor || !src) return;
  img.src = src;
  img.onload = function() {
    editor.style.display = 'block';
    const fx = parseFloat(document.getElementById('aBannerFocalX')?.value || 50);
    const fy = parseFloat(document.getElementById('aBannerFocalY')?.value || 50);
    const sc = parseFloat(document.getElementById('aBannerCropScale')?.value || 1);
    if(cross) { cross.style.left = fx + '%'; cross.style.top = fy + '%'; }
    if(coordEl) coordEl.textContent = fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
    updateBannerCropScaleUI();
  };
}

(function initBannerFocalEditorEvents() {
  document.addEventListener('click', function(e) {
    const wrap = e.target.closest('#bannerFocalCanvasWrap');
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width  * 100)));
    const y = Math.max(0, Math.min(100, ((e.clientY - rect.top)  / rect.height * 100)));
    const cross   = document.getElementById('bannerFocalCrosshair');
    const coordEl = document.getElementById('bannerFocalCoords');
    document.getElementById('aBannerFocalX').value = x.toFixed(2);
    document.getElementById('aBannerFocalY').value = y.toFixed(2);
    if(cross) { cross.style.left = x + '%'; cross.style.top = y + '%'; }
    const sc = parseFloat(document.getElementById('aBannerCropScale')?.value || 1);
    if(coordEl) coordEl.textContent = x.toFixed(1) + '%, ' + y.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
    updateBannerCropScaleUI();
  });
})();

function resetBannerFocalPoint() {
  document.getElementById('aBannerFocalX').value = 50;
  document.getElementById('aBannerFocalY').value = 50;
  document.getElementById('aBannerCropScale').value = 1;
  const cross   = document.getElementById('bannerFocalCrosshair');
  const coordEl = document.getElementById('bannerFocalCoords');
  if(cross) { cross.style.left = '50%'; cross.style.top = '50%'; }
  if(coordEl) coordEl.textContent = '50.0%, 50.0% · 1.00×';
  updateBannerCropScaleUI();
}

function applyBannerFocalPoint() {
  const src = document.getElementById('aBanner').value;
  if (!src) return;
  const fx = parseFloat(document.getElementById('aBannerFocalX')?.value || 50);
  const fy = parseFloat(document.getElementById('aBannerFocalY')?.value || 50);
  const sc = parseFloat(document.getElementById('aBannerCropScale')?.value || 1);
  const id = document.getElementById('editArtistId').value;
  if (id) {
    const artists = getArtists();
    const idx = artists.findIndex(a => a.id === id);
    if (idx > -1) {
      artists[idx].banner = normalizePhotoUrlForForm(src);
      artists[idx].photos = normalizeMediaVault([...artistMediaVault(artists[idx]), artists[idx].banner]);
      artists[idx].bannerFocalX = fx;
      artists[idx].bannerFocalY = fy;
      artists[idx].bannerCropScale = sc;
      saveArtists(artists);
      scheduleMediaAutoPublish('banner image');
      showToast('✓ Banner image saved — ' + fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×', 'success');
    }
  } else {
    showToast('✓ Banner crop set — save the artist to keep it', 'success');
  }
  updateBannerCropScaleUI();
  const btn = document.querySelector('[onclick="applyBannerFocalPoint()"]');
  if(btn) { const orig = btn.textContent; btn.textContent = '✓ Applied'; setTimeout(()=>btn.textContent=orig, 1200); }
}

function hideBannerFocalEditor() {
  const el = document.getElementById('bannerFocalEditor');
  if(el) el.style.display = 'none';
}


function updateProfileCropScaleUI() {
  const fx = parseFloat(document.getElementById('aProfileFocalX')?.value || 50);
  const fy = parseFloat(document.getElementById('aProfileFocalY')?.value || 50);
  const sc = parseFloat(document.getElementById('aProfileCropScale')?.value || 1);
  const img = document.getElementById('profileFocalImg');
  const label = document.getElementById('profileCropScaleLabel');
  const slider = document.getElementById('profileCropScaleSlider');
  if (slider) slider.value = sc;
  if (label) label.textContent = sc.toFixed(2) + '×';
  if (img) {
    img.style.objectPosition = fx + '% ' + fy + '%';
    img.style.transformOrigin = fx + '% ' + fy + '%';
    img.style.transform = 'scale(' + sc + ')';
  }
  updateImgPreview('aPhoto', 'profilePhotoPreview');
}
function setProfileCropScale(v) {
  const sc = Math.max(1, Math.min(2.5, parseFloat(v || 1)));
  const el = document.getElementById('aProfileCropScale');
  if (el) el.value = sc.toFixed(2);
  updateProfileCropScaleUI();
}
function showProfileFocalEditor(src) {
  const editor = document.getElementById('profileFocalEditor');
  const img = document.getElementById('profileFocalImg');
  const cross = document.getElementById('profileFocalCrosshair');
  const coordEl = document.getElementById('profileFocalCoords');
  if (!editor || !src) return;
  img.src = src;
  img.onload = function() {
    editor.style.display = 'block';
    const fx = parseFloat(document.getElementById('aProfileFocalX')?.value || 50);
    const fy = parseFloat(document.getElementById('aProfileFocalY')?.value || 50);
    const sc = parseFloat(document.getElementById('aProfileCropScale')?.value || 1);
    if (cross) { cross.style.left = fx + '%'; cross.style.top = fy + '%'; }
    if (coordEl) coordEl.textContent = fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
    updateProfileCropScaleUI();
  };
}
document.addEventListener('click', function(e) {
  const wrap = e.target.closest('#profileFocalCanvasWrap');
  if (!wrap) return;
  const rect = wrap.getBoundingClientRect();
  const x = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width * 100)));
  const y = Math.max(0, Math.min(100, ((e.clientY - rect.top) / rect.height * 100)));
  document.getElementById('aProfileFocalX').value = x.toFixed(2);
  document.getElementById('aProfileFocalY').value = y.toFixed(2);
  const cross = document.getElementById('profileFocalCrosshair');
  const coordEl = document.getElementById('profileFocalCoords');
  const sc = parseFloat(document.getElementById('aProfileCropScale')?.value || 1);
  if (cross) { cross.style.left = x + '%'; cross.style.top = y + '%'; }
  if (coordEl) coordEl.textContent = x.toFixed(1) + '%, ' + y.toFixed(1) + '% · ' + sc.toFixed(2) + '×';
  updateProfileCropScaleUI();
});
function resetProfileFocalPoint() {
  document.getElementById('aProfileFocalX').value = 50;
  document.getElementById('aProfileFocalY').value = 50;
  document.getElementById('aProfileCropScale').value = 1;
  const cross = document.getElementById('profileFocalCrosshair');
  const coordEl = document.getElementById('profileFocalCoords');
  if (cross) { cross.style.left = '50%'; cross.style.top = '50%'; }
  if (coordEl) coordEl.textContent = '50.0%, 50.0% · 1.00×';
  updateProfileCropScaleUI();
}
function applyProfileFocalPoint() {
  const src = normalizePhotoUrlForForm(document.getElementById('aPhoto')?.value || '');
  if (!src) return;
  const fx = parseFloat(document.getElementById('aProfileFocalX')?.value || 50);
  const fy = parseFloat(document.getElementById('aProfileFocalY')?.value || 50);
  const sc = parseFloat(document.getElementById('aProfileCropScale')?.value || 1);
  const id = document.getElementById('editArtistId').value;
  if (id) {
    const artists = getArtists();
    const idx = artists.findIndex(a => a.id === id);
    if (idx > -1) {
      // Profile Apply must save the role selection AND the crop atomically.
      // This mirrors Tile/Banner behavior and prevents selected profile images from reverting.
      artists[idx].photo = src;
      artists[idx].profileFocalX = fx;
      artists[idx].profileFocalY = fy;
      artists[idx].profileCropScale = sc;
      artists[idx].photos = normalizeMediaVault([...artistMediaVault(artists[idx]), src]);
      saveArtists(artists);
      scheduleMediaAutoPublish('profile photo');
      showToast('✓ Profile photo saved — ' + fx.toFixed(1) + '%, ' + fy.toFixed(1) + '% · ' + sc.toFixed(2) + '×', 'success');
    }
  } else showToast('✓ Profile photo set — save the artist to keep it', 'success');
  updateProfileCropScaleUI();
  renderPhotoLibrary();
  const btn = document.querySelector('[onclick="applyProfileFocalPoint()"]');
  if(btn) { const orig = btn.textContent; btn.textContent = '✓ Applied'; setTimeout(()=>btn.textContent=orig, 1200); }
}
function hideProfileFocalEditor() { const el = document.getElementById('profileFocalEditor'); if (el) el.style.display = 'none'; const img=document.getElementById('profileFocalImg'); if(img) img.removeAttribute('src'); }

let _mediaPublishTimer = null;
function scheduleMediaAutoPublish(reason) {
  clearTimeout(_mediaPublishTimer);
  _mediaPublishTimer = setTimeout(() => {
    publishArtistsToSite(false)
      .then(() => showToast('✓ Media published — ' + (reason || 'artist media'), 'success'))
      .catch(e => showToast('✓ Media saved locally, publish failed — ' + e.message, 'error'));
  }, 900);
}
function normalizePhotoUrlForForm(url) { const v = String(url || '').trim(); return isInlineDataImage(v) ? '' : v; }

function mediaUrlKey(url) { return normalizeMediaUrlForCompare(url); }
function normalizeMediaVault(urls) {
  const out = [];
  const seen = new Set();
  (urls || []).forEach(raw => {
    const url = normalizePhotoUrlForForm(raw);
    if (!url || isBrandLogoMedia(url)) return;
    const key = mediaUrlKey(url);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(url);
  });
  return out;
}
function artistMediaVault(rec) { return normalizeMediaVault([rec?.gridPhoto, rec?.photo, rec?.banner, ...(Array.isArray(rec?.photos) ? rec.photos : String(rec?.photos || '').split('\n'))]); }
function currentFormRoleUrls() { return ['aGridPhoto','aPhoto','aBanner'].map(id => normalizePhotoUrlForForm(document.getElementById(id)?.value || '')).filter(Boolean); }
function currentFormTextLibraryUrls() { return (document.getElementById('aPhotos')?.value || '').split('\n').map(normalizePhotoUrlForForm).filter(Boolean); }
function currentOpenArtistRecord() { const id = document.getElementById('editArtistId')?.value; return id ? getArtists().find(a => a.id === id) : null; }
function writeMediaVaultUrls(urls) { const el = document.getElementById('aPhotos'); if (el) el.value = normalizeMediaVault(urls).join('\n'); }
function syncMediaVaultTextarea(extra = []) { writeMediaVaultUrls([...artistMediaVault(currentOpenArtistRecord()), ...currentFormRoleUrls(), ...currentFormTextLibraryUrls(), ...extra]); }


function persistOpenArtistMediaState(reason) {
  const id = document.getElementById('editArtistId')?.value;
  if (!id) return;
  const artists = getArtists();
  const idx = artists.findIndex(a => a.id === id);
  if (idx < 0) return;
  const gridPhoto = normalizePhotoUrlForForm(document.getElementById('aGridPhoto')?.value || '');
  const photo = normalizePhotoUrlForForm(document.getElementById('aPhoto')?.value || '');
  const banner = normalizePhotoUrlForForm(document.getElementById('aBanner')?.value || '');
  const vault = normalizeMediaVault([...artistMediaVault(artists[idx]), gridPhoto, photo, banner, ...currentFormTextLibraryUrls()]);
  artists[idx].gridPhoto = gridPhoto;
  artists[idx].photo = photo;
  artists[idx].banner = banner;
  artists[idx].photos = vault;
  writeMediaVaultUrls(vault);
  saveArtists(artists);
  scheduleMediaAutoPublish(reason || 'media role');
  console.log('[Admin Media Persist]', reason || 'media state', {artist: artists[idx].name, gridPhoto, photo, banner, photos: artists[idx].photos});
}

function getPhotoLibraryUrls() {
  const fields = ['aGridPhoto','aPhoto','aBanner'];
  const urls = fields.map(id => normalizePhotoUrlForForm(document.getElementById(id)?.value)).filter(Boolean);
  const bulk = (document.getElementById('aPhotos')?.value || '').split('\n').map(normalizePhotoUrlForForm).filter(Boolean);
  return normalizeMediaVault([...urls, ...bulk]);
}
function getGalleryOnlyUrls() { return getPhotoLibraryUrls(); }
function writeGalleryOnlyUrls(urls) { writeMediaVaultUrls(urls); }
function renderPhotoLibrary() {
  const grid = document.getElementById('aPhotoLibrary');
  if (!grid) return;
  const home = normalizePhotoUrlForForm(document.getElementById('aGridPhoto')?.value);
  const profile = normalizePhotoUrlForForm(document.getElementById('aPhoto')?.value);
  const banner = normalizePhotoUrlForForm(document.getElementById('aBanner')?.value);
  const urls = getPhotoLibraryUrls();
  if (!urls.length) { grid.innerHTML = '<div style="color:var(--muted);font-size:.75rem">No photos yet. Add at least a homepage, profile, banner, or EPK gallery image.</div>'; return; }
  grid.innerHTML = urls.map((url, i) => {
    const badges = [url===home?'Tile':'', url===profile?'Profile':'', url===banner?'Banner':'', (! [home,profile,banner].includes(url))?'Library':''].filter(Boolean);
    return `<div class="photo-library-card">
      <img class="photo-library-card-img" src="${escHtml(url)}" alt="Artist photo ${i+1}" loading="lazy" onerror="this.style.opacity=.25">
      <div class="photo-library-card-body">
        <div class="photo-library-badges">${badges.map(b=>`<span class="photo-library-badge">${escHtml(b)}</span>`).join('')}</div>
        <div class="photo-library-buttons">
          <button type="button" class="btn-secondary" onclick="setMediaImage('home', '${escAttr(url)}')">Tile</button>
          <button type="button" class="btn-secondary" onclick="setMediaImage('profile', '${escAttr(url)}')">Profile</button>
          <button type="button" class="btn-secondary" onclick="setMediaImage('banner', '${escAttr(url)}')">Banner</button>
        </div>
        <button type="button" class="btn-danger photo-library-remove" onclick="removeLibraryPhoto('${escAttr(url)}')">Remove from library</button>
        <div class="photo-library-url">${escHtml(url)}</div>
      </div>
    </div>`;
  }).join('');
}
function escAttr(s) { return String(s || '').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\n/g,''); }
function addLibraryPhotoUrl(url) {
  url = normalizePhotoUrlForForm(url);
  if (!url) return;
  syncMediaVaultTextarea([url]);
  renderPhotoLibrary();
}
function addLibraryPhotoFromInput() {
  const el = document.getElementById('aNewPhotoUrl');
  addLibraryPhotoUrl(el?.value || '');
  if (el) el.value = '';
}
function setMediaImage(kind, url) {
  url = normalizePhotoUrlForForm(url);
  if (!url) return;
  const map = { home:'aGridPhoto', profile:'aPhoto', banner:'aBanner' };
  const el = document.getElementById(map[kind]);
  if (!el) return;
  el.value = url;
  if (kind === 'home') { updateImgPreview('aGridPhoto','photoPreview'); showFocalEditor(url); showToast('✓ Tile image selected — publishing', 'success'); }
  if (kind === 'profile') { updateImgPreview('aPhoto','profilePhotoPreview'); showProfileFocalEditor(url); showToast('✓ Profile image selected — publishing', 'success'); }
  if (kind === 'banner') { updateImgPreview('aBanner','bannerPreview'); showBannerFocalEditor(url); showToast('✓ Banner image selected — publishing', 'success'); }
  renderPhotoLibrary();
  persistOpenArtistMediaState('set ' + kind + ' image');
}
function removeLibraryPhoto(url) {
  url = normalizePhotoUrlForForm(url);
  const assigned = new Set(currentFormRoleUrls().map(mediaUrlKey));
  if (assigned.has(mediaUrlKey(url))) {
    showToast('Assigned image kept. Clear or replace its Tile/Profile/Banner role before removing it from the library.', 'error');
    return;
  }
  writeMediaVaultUrls(getPhotoLibraryUrls().filter(u => !sameMediaUrl(u, url)));
  showToast('✓ Removed from retained media library', 'success');
  renderPhotoLibrary();
  persistOpenArtistMediaState('remove library image');
}

function hideFocalEditor() {
  const el = document.getElementById('focalEditor');
  if(el) el.style.display = 'none';
}

/* Watch aPhoto input for URL changes */
document.addEventListener('DOMContentLoaded', function() {
  injectPublishSiteButton();
  const photoInput = document.getElementById('aGridPhoto');
  const bannerInput = document.getElementById('aBanner');
  if (photoInput) {
    photoInput.addEventListener('change', function() {
      if (this.value.trim()) showFocalEditor(this.value.trim());
      else hideFocalEditor();
    });
    photoInput.addEventListener('blur', function() {
      if (this.value.trim()) showFocalEditor(this.value.trim());
    });
  }
  const profileInput = document.getElementById('aPhoto');
  if (profileInput) {
    profileInput.addEventListener('change', function() {
      if (this.value.trim()) showProfileFocalEditor(this.value.trim());
      else hideProfileFocalEditor();
      renderPhotoLibrary();
    });
    profileInput.addEventListener('blur', function() {
      if (this.value.trim()) showProfileFocalEditor(this.value.trim());
      renderPhotoLibrary();
    });
  }
  if (bannerInput) {
    bannerInput.addEventListener('change', function() {
      if (this.value.trim()) showBannerFocalEditor(this.value.trim());
      else hideBannerFocalEditor();
      renderPhotoLibrary();
    });
    bannerInput.addEventListener('blur', function() {
      if (this.value.trim()) showBannerFocalEditor(this.value.trim());
      renderPhotoLibrary();
    });
  }
});

function closeArtistModal() {
  document.getElementById('artistModal').classList.remove('open');
}

function goResearchThisArtist() {
  const id = document.getElementById('editArtistId').value;
  closeArtistModal();
  if (id) { _researchPreselect = id; }
  showView('research');
}

/* Helper: read a field value even if its tab is hidden (display:none) */
function getFieldVal(id) {
  const el = document.getElementById(id);
  if (!el) return '';
  // Temporarily make visible to ensure value is readable (some browsers block display:none)
  const wasHidden = el.closest('.tab-content') && !el.closest('.tab-content').classList.contains('active');
  return el.value;
}

function showToast(msg, type) {
  let t = document.getElementById('adminToast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'adminToast';
    t.style.cssText = 'position:fixed;bottom:2rem;right:2rem;z-index:100000;padding:.75rem 1.5rem;font-size:.75rem;letter-spacing:.1em;font-weight:600;text-transform:uppercase;border-radius:2px;transition:opacity .4s;pointer-events:none;box-shadow:0 4px 24px rgba(0,0,0,.6)';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.background = type === 'error' ? '#c0392b' : '#c8a96e';
  t.style.color = '#000';
  t.style.opacity = '1';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.style.opacity = '0'; }, 2500);
}

function saveArtistForm() {
  const artists = getArtists();
  const id = document.getElementById('editArtistId').value;
  const existing = id ? artists.find(a => a.id === id) : null;

  // Read ALL fields directly by ID — works regardless of tab visibility
  const g = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : '';
  };

  // Keep media roles independent. Do not let banner/header values bleed into profile.
  const mediaGridPhoto = normalizePhotoUrlForForm(g('aGridPhoto'));
  const mediaProfilePhoto = normalizePhotoUrlForForm(g('aPhoto'));
  const mediaBannerPhoto = normalizePhotoUrlForForm(g('aBanner'));
  const mediaGalleryPhotos = normalizeMediaVault([
    ...artistMediaVault(existing || {}),
    mediaGridPhoto,
    mediaProfilePhoto,
    mediaBannerPhoto,
    ...g('aPhotos').split('\n').map(normalizePhotoUrlForForm).filter(Boolean)
  ]);

  const data = {
    ...(existing || { stats:{}, publishTargets:{}, epk:null }),
    name: g('aName'),
    slug: g('aSlug') || g('aName').toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    genres: g('aGenres'),
    location: g('aLocation'),
    bookingEmail: g('aBookingEmail'),
    status: g('aStatus'),
    featured: g('aFeatured') === 'true',
    gridPhoto: mediaGridPhoto,
    photo: mediaProfilePhoto,
    banner: mediaBannerPhoto,
    photos: mediaGalleryPhotos,
    presskit: g('aPresskit'),
    techRider: g('aTechRider'),
    spotify: g('aSpotify'),
    soundcloud: g('aSoundcloud'),
    bandcamp: g('aBandcamp'),
    apple: g('aApple'),
    instagram: g('aInstagram'),
    facebook: g('aFacebook'),
    youtube: g('aYoutube'),
    website: g('aWebsite'),
    bandsintown: g('aBandsintown'),
    ra: g('aRA'),
    shortBio: g('aShortBio'),
    bio: g('aBio'),
    gridFocalX: (function(){ const v = g('aFocalX'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    gridFocalY: (function(){ const v = g('aFocalY'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    gridCropScale: (function(){ const v = g('aCropScale'); return (v !== '' && v !== null) ? parseFloat(v) : 1; })(),
    profileFocalX: (function(){ const v = g('aProfileFocalX'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    profileFocalY: (function(){ const v = g('aProfileFocalY'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    profileCropScale: (function(){ const v = g('aProfileCropScale'); return (v !== '' && v !== null) ? parseFloat(v) : 1; })(),
    bannerFocalX: (function(){ const v = g('aBannerFocalX'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    bannerFocalY: (function(){ const v = g('aBannerFocalY'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    bannerCropScale: (function(){ const v = g('aBannerCropScale'); return (v !== '' && v !== null) ? parseFloat(v) : 1; })(),
    // Legacy aliases: homepage reads grid* first, but keep these populated for older code paths.
    focalX: (function(){ const v = g('aFocalX'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    focalY: (function(){ const v = g('aFocalY'); return (v !== '' && v !== null) ? parseFloat(v) : 50; })(),
    cropScale: (function(){ const v = g('aCropScale'); return (v !== '' && v !== null) ? parseFloat(v) : 1; })(),
    quotes: g('aQuotes'),
    notes: g('aNotes'),
    discography: (() => {
      const v = g('aDiscography').trim();
      if (!v) return existing?.discography || [];
      try { return JSON.parse(v); } catch { return existing?.discography || []; }
    })(),
    videos: (() => {
      const v = g('aVideos').trim();
      if (!v) return existing?.videos || [];
      return v.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
        // Accept either raw URL or "Title | URL"
        const parts = line.split('|').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return { title: parts[0], url: parts.slice(1).join(' | ') };
        return { title: '', url: line };
      }).filter(v => v.url);
    })(),
  };

  // v19: profile and banner are independent manual roles. Do not auto-repair or replace either role.


  if (id) {
    const idx = artists.findIndex(a => a.id === id);
    if (idx > -1) {
      artists[idx] = data;
    } else {
      // id set but not found — shouldn't happen, just push
      artists.push(data);
    }
  } else {
    data.id = 'artist_' + Date.now();
    artists.push(data);
  }

  artists.sort(artistAlphaSort);

  try {
    createDataBackup('Before saving artist: ' + (data.name || 'Untitled'));
    saveArtists(artists);
    localStorage.setItem('mk_data_version', DATA_VERSION);
    syncArtistVideosToGlobal(data);
    publishArtistsToSite(false).then(() => showToast('✓ Saved + published — ' + (data.name || 'Artist'), 'success')).catch(e => showToast('✓ Saved locally, publish failed — ' + e.message, 'error'));
  } catch(err) {
    showToast('✗ Save failed — ' + err.message, 'error');
    console.error('Save failed:', err);
    return;
  }

  // Verify the save actually persisted by reading back immediately, including media roles.
  const verify = getArtists().find(a => a.id === data.id);
  const bioSaved = verify ? verify.bio : '';
  const mediaSaved = verify && verify.gridPhoto === data.gridPhoto && verify.photo === data.photo && verify.banner === data.banner;
  console.log('[Admin Save] Artist:', data.name, '| Bio chars:', data.bio.length, '| Verified bio chars:', bioSaved.length, '| Media saved:', mediaSaved, {gridPhoto:data.gridPhoto, photo:data.photo, banner:data.banner, verify});
  if (!verify || !mediaSaved) {
    showToast('✗ Save verification failed — media did not persist', 'error');
    console.error('[Admin Save] Media verification failed', {data, verify});
    return;
  }

  closeArtistModal();
  renderArtistGrid();
  renderDashboard();
  const bioLen = data.bio ? data.bio.length : 0;
  const bioNote = bioLen > 0 ? ` · bio ${bioLen}ch` : ' · no bio';
  const mediaNote = (data.photo ? ' · profile set' : ' · no profile') + (data.banner ? ' · banner set' : ' · no banner');
  setTimeout(() => showToast('✓ Saved — ' + data.name + bioNote + mediaNote, 'success'), 80);
}

/* ==================== MODAL TABS ==================== */

function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab === name));
}
document.querySelectorAll('.tab-btn').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ==================== IMAGE PREVIEWS & DROP ZONES ==================== */

function updateImgPreview(inputId, previewId) {
  const val = document.getElementById(inputId)?.value;
  const prev = document.getElementById(previewId);
  if (!prev) return;
  // Apply the correct crop controls: homepage/splash crop for photo, banner crop for banner.
  const isBanner = inputId === 'aBanner';
  const isGrid = inputId === 'aGridPhoto';
  const isProfile = inputId === 'aPhoto';
  const fxEl = isBanner ? document.getElementById('aBannerFocalX') : (isGrid ? document.getElementById('aFocalX') : (isProfile ? document.getElementById('aProfileFocalX') : null));
  const fyEl = isBanner ? document.getElementById('aBannerFocalY') : (isGrid ? document.getElementById('aFocalY') : (isProfile ? document.getElementById('aProfileFocalY') : null));
  const fx = (fxEl && fxEl.value !== '') ? fxEl.value : 50;
  const fy = (fyEl && fyEl.value !== '') ? fyEl.value : 50;
  const scEl = isBanner ? document.getElementById('aBannerCropScale') : (isGrid ? document.getElementById('aCropScale') : (isProfile ? document.getElementById('aProfileCropScale') : null));
  const sc = (scEl && scEl.value !== '') ? scEl.value : 1;
  prev.innerHTML = val
    ? `<img src="${escHtml(val)}" alt="" style="object-position:${fx}% ${fy}%;transform-origin:${fx}% ${fy}%;transform:scale(${sc})" onerror="this.parentElement.innerHTML='<span style=color:var(--muted)>Image failed</span>'">`
    : '<span>No image</span>';
}
['aGridPhoto','aPhoto','aBanner'].forEach(id => {
  const el = document.getElementById(id);
  if (el) el.addEventListener('input', () => updateImgPreview(id, id === 'aGridPhoto' ? 'photoPreview' : (id === 'aPhoto' ? 'profilePhotoPreview' : 'bannerPreview')));
});

function initDropZones() {
  document.querySelectorAll('.drop-zone:not([data-dz-init])').forEach(zone => {
    zone.dataset.dzInit = '1';
    const targetId  = zone.dataset.target;
    const previewId = zone.dataset.preview;
    const fileInput = zone.querySelector('.drop-zone-file');
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      const f = e.dataTransfer.files[0];
      if (f?.type.startsWith('image/')) handleImageFile(f, zone, targetId, previewId);
    });
    if (fileInput) fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) handleImageFile(fileInput.files[0], zone, targetId, previewId);
    });
  });
}

async function compressImageFile(file) {
  const bitmapUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = bitmapUrl;
    });
    const maxSide = 1800;
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
    const w = Math.max(1, Math.round((img.naturalWidth || img.width) * scale));
    const h = Math.max(1, Math.round((img.naturalHeight || img.height) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    let quality = 0.84;
    let dataUrl = canvas.toDataURL('image/jpeg', quality);
    while (dataUrl.length > 950000 && quality > 0.55) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL('image/jpeg', quality);
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(bitmapUrl);
  }
}
async function uploadAdminMediaFile(file) {
  const dataUrl = await compressImageFile(file);
  const res = await fetch(MEDIA_UPLOAD_API, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ password: ADMIN_PUBLISH_PASSWORD, filename:file.name, dataUrl }) });
  const data = await res.json().catch(()=>({}));
  if (!res.ok || data.success === false || !data.url) throw new Error(data.error || ('Image upload failed: ' + res.status));
  return data.url;
}
async function handleImageFile(file, zone, targetId, previewId) {
  if (file.size > 10*1024*1024) { alert('Max 10MB'); return; }
  zone.classList.add('uploading');
  try {
    showToast('Uploading image…', 'success');
    const hostedUrl = await uploadAdminMediaFile(file);
    const el = document.getElementById(targetId);
    if (el) el.value = hostedUrl;
    if (targetId === 'aNewPhotoUrl') {
      addLibraryPhotoUrl(hostedUrl);
      if (el) el.value = '';
      if (previewId) {
        const prev = document.getElementById(previewId);
        if (prev) prev.style.display = 'none';
      }
    } else {
      updateImgPreview(targetId, previewId);
      if (targetId === 'aGridPhoto') showFocalEditor(hostedUrl);
      if (targetId === 'aPhoto') showProfileFocalEditor(hostedUrl);
      if (targetId === 'aBanner') showBannerFocalEditor(hostedUrl);
      renderPhotoLibrary();
    }
    showToast('✓ Image uploaded — assign roles, then save artist', 'success');
  } catch(e) {
    console.error('Image upload failed', e);
    showToast('✗ Image upload failed — ' + e.message, 'error');
  } finally {
    zone.classList.remove('uploading');
  }
}
/* ==================== DISCOGRAPHY SEARCH (modal) ==================== */

async function searchDiscography() {
  const artistName = document.getElementById('aName')?.value?.trim();
  const statusEl   = document.getElementById('discogStatus');
  const resultsEl  = document.getElementById('discogResults');
  if (!artistName) { if(statusEl) statusEl.textContent='Enter artist name first.'; return; }
  if(statusEl) statusEl.textContent = 'Searching…';
  if(resultsEl) resultsEl.innerHTML = '<div class="loading">Fetching…</div>';
  try {
    const s  = await fetch(`https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(artistName)}&limit=3&fmt=json`,{headers:{'User-Agent':'MelankoliaAdmin/1.0'}});
    const sd = await s.json();
    const mbId = sd.artists?.[0]?.id;
    if (!mbId) { if(statusEl) statusEl.textContent='Not found.'; if(resultsEl) resultsEl.innerHTML=''; return; }
    const r  = await fetch(`https://musicbrainz.org/ws/2/release-group?artist=${mbId}&limit=50&fmt=json`,{headers:{'User-Agent':'MelankoliaAdmin/1.0'}});
    const rd = await r.json();
    const groups = (rd['release-groups']||[]).sort((a,b)=>(a['first-release-date']||'').localeCompare(b['first-release-date']||''));
    if (!groups.length) { if(statusEl) statusEl.textContent='No releases.'; if(resultsEl) resultsEl.innerHTML=''; return; }
    if(resultsEl) resultsEl.innerHTML = groups.map(g => `
      <div class="discog-item" data-rgid="${g.id}" data-title="${escHtml(g.title)}"
           data-year="${(g['first-release-date']||'').slice(0,4)}" data-type="${escHtml(g['primary-type']||'Release')}">
        <img data-rgid="${g.id}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80'%3E%3Crect width='80' height='80' fill='%23111'/%3E%3C/svg%3E">
        <div class="discog-item-info">
          <div class="discog-item-title">${escHtml(g.title)}</div>
          <div class="discog-item-year">${(g['first-release-date']||'').slice(0,4)}</div>
          <div class="discog-item-type">${g['primary-type']||'Release'}</div>
        </div>
      </div>`).join('');
    resultsEl.querySelectorAll('.discog-item').forEach(item => item.addEventListener('click',()=>item.classList.toggle('selected')));
    let delay=0;
    resultsEl.querySelectorAll('img[data-rgid]').forEach(img => {
      delay+=300;
      setTimeout(async()=>{
        try{const cr=await fetch(`https://coverartarchive.org/release-group/${img.dataset.rgid}`);if(cr.ok){const cd=await cr.json();const f=cd.images?.find(i=>i.front)||cd.images?.[0];if(f?.thumbnails?.small)img.src=f.thumbnails.small;else if(f?.image)img.src=f.image;}}catch{}
      },delay);
    });
    if(statusEl) statusEl.innerHTML=`${groups.length} releases ·
      <button type="button" class="btn-secondary" style="padding:.2rem .6rem;font-size:.65rem;margin-left:.5rem" onclick="saveAllDiscog()">Save All</button>
      <button type="button" class="btn-secondary" style="padding:.2rem .6rem;font-size:.65rem;margin-left:.4rem" onclick="saveSelectedDiscog()">Save Selected</button>`;
  } catch(err){ if(statusEl) statusEl.textContent='Error: '+err.message; }
}

function saveSelectedDiscog() {
  const items=[...document.querySelectorAll('.discog-item.selected')].map(item=>({title:item.dataset.title,year:item.dataset.year,type:item.dataset.type,cover:item.querySelector('img')?.src||'',mbid:item.dataset.rgid}));
  if(!items.length){alert('Click releases to select them first.');return;}
  const el=document.getElementById('aDiscography');if(el)el.value=JSON.stringify(items,null,2);
  const s=document.getElementById('discogStatus');if(s)s.textContent=`${items.length} releases saved.`;
}
function saveAllDiscog() {
  const items=[...document.querySelectorAll('.discog-item')].map(item=>({title:item.dataset.title,year:item.dataset.year,type:item.dataset.type,cover:item.querySelector('img')?.src||'',mbid:item.dataset.rgid}));
  const el=document.getElementById('aDiscography');if(el)el.value=JSON.stringify(items,null,2);
  const s=document.getElementById('discogStatus');if(s)s.textContent=`All ${items.length} saved.`;
}

/* ==================== AI RESEARCH PAGE ==================== */

let _researchData      = null;
let _researchArtistId  = null;
let _researchPreselect = null; // set before showView('research')
const _publishTargets  = {};
const _selectedImages  = [];
const _selectedDiscog  = new Set();
const _selectedVideos  = new Set();

/* ----- PUBLISH TARGET TOGGLE (global click delegation) ----- */
document.addEventListener('click', e => {
  // Destination toggle (bio / epk / both / none)
  const btn = e.target.closest('.rpt-btn');
  if (btn) {
    const toggle = btn.closest('.rfield-publish-toggle');
    if (toggle) {
      const field = toggle.dataset.field;
      const val   = btn.dataset.val;
      _publishTargets[field] = val;
      toggle.querySelectorAll('.rpt-btn').forEach(b => b.classList.toggle('active', b.dataset.val === val));
    }
  }
  // Update/Keep toggle
  const rutBtn = e.target.closest('.rut-btn');
  if (rutBtn) {
    const toggle = rutBtn.closest('.rfield-update-toggle');
    if (toggle) {
      toggle.querySelectorAll('.rut-btn').forEach(b => b.classList.toggle('active', b === rutBtn));
    }
  }
});

function initResearchPage() {
  // Populate artist dropdown
  const sel = document.getElementById('researchArtistSelect');
  if (!sel) return;
  const artists = getArtists();
  sel.innerHTML = '<option value="">— Select existing artist —</option>' +
    artists.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('');

  // Read default publish targets from active buttons in HTML
  document.querySelectorAll('.rfield-publish-toggle').forEach(toggle => {
    const field  = toggle.dataset.field;
    const active = toggle.querySelector('.rpt-btn.active');
    if (active && !_publishTargets[field]) _publishTargets[field] = active.dataset.val;
  });

  // If we were directed here for a specific artist
  if (_researchPreselect) {
    sel.value = _researchPreselect;
    _researchArtistId = _researchPreselect;
    _researchPreselect = null;
    // Don't auto-run — let user choose whether to trigger
  }
}


async function recoverSpotifyForResearch(data, artistName) {
  data.socials = data.socials || {};
  if (data.socials.spotify && data.spotifyArtistId) return data;
  const cleanName = String(data.name || artistName || '').trim();
  if (!cleanName) return data;
  try {
    const sparql = `SELECT ?id WHERE { ?item rdfs:label "${cleanName.replace(/"/g, '\\"')}"@en. ?item wdt:P1902 ?id. } LIMIT 1`;
    const url = 'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent(sparql);
    const r = await fetch(url, { headers: { 'Accept': 'application/sparql-results+json' } });
    if (!r.ok) return data;
    const j = await r.json();
    const id = j?.results?.bindings?.[0]?.id?.value || '';
    if (/^[A-Za-z0-9]{22}$/.test(id)) {
      data.spotifyArtistId = id;
      data.socials.spotify = `https://open.spotify.com/artist/${id}`;
      data._source = (data._source || '') + '+wikidata-spotify';
    }
  } catch (e) { /* optional fallback only */ }
  return data;
}

async function runResearch() {
  const sel       = document.getElementById('researchArtistSelect');
  const nameInput = document.getElementById('researchArtistName');
  const statusEl  = document.getElementById('researchStatus');
  const btn       = document.getElementById('researchRunBtn');

  let artistName = '';
  let artistId   = null;

  if (sel && sel.value) {
    const a = getArtists().find(x => x.id === sel.value);
    if (a) { artistName = a.name; artistId = a.id; }
  }
  if (!artistName && nameInput && nameInput.value.trim()) {
    artistName = nameInput.value.trim();
  }
  if (!artistName) { if(statusEl) statusEl.textContent = 'Select an artist or type a name.'; return; }

  _researchArtistId = artistId;

  btn.disabled = true;
  btn.textContent = '✦ Researching…';
  if(statusEl) statusEl.textContent = `Researching "${artistName}"…`;
  document.getElementById('researchResults').style.display = 'none';

  try {
    const resp = await fetch(RESEARCH_FUNCTION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artistName }),
    });
    const text = await resp.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; }
    catch(e) {
      const snippet = text.slice(0, 220).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      throw new Error(`Artist research returned non-JSON (${resp.status}). ${snippet || 'The function likely timed out before returning JSON.'}`);
    }
    if (!resp.ok || data.error) throw new Error(data.error || `Artist research failed (${resp.status})`);
    await recoverSpotifyForResearch(data, artistName);
    _researchData = data;
    renderResearchResults(data, artistName, artistId);
    if(statusEl) statusEl.textContent = '';
  } catch(err) {
    if(statusEl) statusEl.textContent = '⚠ ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = '✦ Research Now';
  }
}

/* ----- RENDER ALL RESULTS ----- */
function renderResearchResults(d, artistName, artistId) {
  const ts = d._timestamp ? new Date(d._timestamp).toLocaleString() : '';
  const metaEl = document.getElementById('researchResultsMeta');
  if(metaEl) metaEl.textContent = `${d.name || artistName} · ${d._source||''} · ${ts}`;

  // Load current artist values for side-by-side
  const artist = artistId ? (getArtists().find(a => a.id === artistId) || {}) : {};

  // Render each field row
  renderFieldRow('name',     d.name,     artist.name,     false);
  renderFieldRow('genres',   d.genres,   artist.genres,   true);
  renderFieldRow('location', d.location, artist.location, true);
  const shortBioRow = document.getElementById('rfrow_shortBio');
  if (shortBioRow) shortBioRow.style.display = 'none';
  renderFieldRow('bio',      d.bio,      artist.bio,      true);
  renderFieldRow('notes',    d.notes,    artist.notes,    true);

  // Stats
  const lf = d.lastfm || {};
  renderFieldRow('statListeners', lf.listeners ? fmtNum(lf.listeners)+' monthly listeners' : null, null, true);
  renderFieldRow('statPlaycount', lf.playcount ? fmtNum(lf.playcount)+' total plays'       : null, null, true);
  renderFieldRow('statTags',      Array.isArray(lf.tags)&&lf.tags.length ? lf.tags.join(', ') : null, null, true);

  // Quotes
  renderQuoteRows(d.quotes || [], artist.quotes);

  // Socials
  renderSocialRows(d.socials || {}, artist);

  // Images
  renderResearchImages(d.images || []);

  // Discography
  renderResearchDiscog(d.discography || []);

  // Videos
  renderResearchVideos(d.videos || []);

  document.getElementById('researchResults').style.display = 'block';
}

/* ----- FIELD ROW WITH OLD/NEW SIDE BY SIDE ----- */
function renderFieldRow(field, newVal, oldVal, showNone) {
  const container = document.getElementById('rfrow_' + field);
  if (!container) return;

  const hasOld = oldVal && String(oldVal).trim() !== '';
  const hasNew = newVal && String(newVal).trim() !== '';
  const value = hasNew ? String(newVal) : '';
  const editable = !field.startsWith('stat');
  const multiline = ['shortBio','bio','notes'].includes(field);
  const rows = field === 'bio' ? 8 : multiline ? 4 : 1;

  // New/AI value side — editable before Apply
  const newEl = container.querySelector('.rf-new-val');
  if (newEl) {
    if (editable) {
      newEl.innerHTML = multiline
        ? `<textarea class="rf-edit rf-edit-textarea" data-field="${field}" rows="${rows}" placeholder="Type value to save…">${escHtml(value)}</textarea>`
        : `<input class="rf-edit rf-edit-input" data-field="${field}" value="${escHtml(value)}" placeholder="Type value to save…">`;
    } else {
      newEl.textContent = hasNew ? newVal : '—';
    }
  }

  // Old/current value side — editable. If user selects Keep, edits here are saved.
  const oldEl = container.querySelector('.rf-old-val');
  if (oldEl) {
    const oldValue = hasOld ? String(oldVal) : '';
    if (editable) {
      oldEl.innerHTML = multiline
        ? `<textarea class="rf-existing-edit rf-edit-textarea" data-field="${field}" rows="${rows}" placeholder="Type existing value to keep/save…">${escHtml(oldValue)}</textarea>`
        : `<input class="rf-existing-edit rf-edit-input" data-field="${field}" value="${escHtml(oldValue)}" placeholder="Type existing value to keep/save…">`;
    } else {
      oldEl.textContent = hasOld ? oldVal : 'No existing value';
    }
    oldEl.closest('.rf-old-col')?.classList.toggle('rf-old-empty', !hasOld);
  }

  // Dim row if AI returned nothing, but still allow manual entry
  container.classList.toggle('rf-row-empty', !hasNew);
}

function getEditedResearchField(field, fallback) {
  const el = document.querySelector(`.rf-edit[data-field="${field}"]`);
  if (!el) return fallback;
  const v = el.value.trim();
  return v || fallback;
}


function getEditedExistingResearchField(field, fallback) {
  const el = document.querySelector(`.rf-existing-edit[data-field="${field}"]`);
  if (!el) return fallback;
  const v = el.value.trim();
  return v || fallback;
}

function renderQuoteRows(quotes, existingQuotes) {
  const el = document.getElementById('rf_quotes');
  if (!el) return;
  const existingText = existingQuotes ? String(existingQuotes).trim() : '';
  if (!quotes.length) { el.innerHTML = '<div class="rf-empty">No quotes found</div>'; return; }
  el.innerHTML = `
    ${existingText ? `<div class="rf-existing-block"><div class="rf-existing-label">Current quotes on record</div><div class="rf-existing-text">${escHtml(existingText)}</div></div>` : ''}
    <div class="rf-new-label">Verified media quotes — check to include as artist-page pull quotes:</div>
    ${quotes.map((q,i) => `
      <div class="rfield-quote-item">
        <label>
          <input type="checkbox" class="rq-check" data-index="${i}" checked style="accent-color:#c084fc;margin-right:0.5rem">
          <span class="rfield-quote-text">"${escHtml(q.text||'')}"</span>
          <span class="rfield-quote-src">— ${escHtml(q.source||'')}${q.year?', '+q.year:''}</span>
        </label>
      </div>`).join('')}`;
}

function renderSocialRows(socials, artist) {
  const el = document.getElementById('rf_socials');
  if (!el) return;
  const keys = ['spotify','instagram','soundcloud','youtube','facebook','bandcamp','ra','bandsintown','website'];
  el.innerHTML = keys.map(k => {
    const newUrl = socials[k] || '';
    const oldUrl = artist[k] || '';
    return `
      <div class="rfield-social-row ${newUrl?'':'rfield-social-empty'}">
        <input type="checkbox" class="rs-check" data-social="${k}" ${newUrl?'checked':''} style="accent-color:#c084fc">
        <span class="rfield-social-key">${k}</span>
        <div class="rfield-social-cols">
          <input class="rs-input" data-social="${k}" value="${escHtml(newUrl)}" placeholder="Paste ${k} URL…" oninput="this.closest('.rfield-social-row').querySelector('.rs-check').checked = !!this.value.trim()">
          ${oldUrl ? `<span class="rfield-social-url rfield-social-old">Currently: ${escHtml(oldUrl)}</span>` : ''}
        </div>
      </div>`;
  }).join('');
}

/* ----- IMAGES ----- */
function renderResearchImages(images) {
  const el = document.getElementById('rf_images');
  if (!el) return;
  _selectedImages.length = 0;

  if (!images.length) {
    el.innerHTML = '<div style="color:var(--muted);font-size:0.7rem;padding:0.5rem 0">No images found · Upload your own above or paste a URL below</div>';
    return;
  }

  el.innerHTML = images.map((img, i) => `
    <div class="rimg-item" data-index="${i}" onclick="toggleResearchImage(this,${i})"
         title="${escHtml(img.source||'')} · ${escHtml(img.caption||'')}">
      <img src="${escHtml(img.url)}" alt="" loading="lazy"
           onerror="this.parentElement.style.display='none'">
      <div class="rimg-badge" style="display:none">✓</div>
      <div class="rimg-main-badge" style="display:none">MAIN</div>
      <div class="rimg-source">${escHtml(img.source||'')}</div>
    </div>`).join('');
}

function toggleResearchImage(el, index) {
  const images = (_researchData?.images||[]).filter(i=>i.url);
  const img = images[index];
  if (!img) return;
  const existing = _selectedImages.findIndex(s => s.index === index);
  if (existing > -1) { _selectedImages.splice(existing,1); }
  else { _selectedImages.push({ index, url: img.url, source: img.source||'' }); }
  refreshImageBadges();
}

function refreshImageBadges() {
  document.querySelectorAll('#rf_images .rimg-item').forEach(item => {
    const idx   = parseInt(item.dataset.index);
    const isNaN_ = isNaN(idx);
    const url   = item.querySelector('img')?.src || item.dataset.url || '';
    const match = isNaN_ ? _selectedImages.findIndex(s=>s.url===url) : _selectedImages.findIndex(s=>s.index===idx);
    const sel   = match > -1;
    const first = sel && match === 0;
    item.classList.toggle('selected', sel);
    item.classList.toggle('rimg-is-main', first);
    const mb = item.querySelector('.rimg-main-badge');
    const cb = item.querySelector('.rimg-badge');
    if(mb) mb.style.display = first ? 'block' : 'none';
    if(cb) cb.style.display = (sel && !first) ? 'block' : 'none';
  });
}

async function handlePhotoUpload(event) {
  const files = Array.from(event.target.files);
  const el = document.getElementById('rf_images');
  if (!el) return;
  for (const file of files) {
    if (!file.type.startsWith('image/')) continue;
    try {
      const url = await uploadAdminMediaFile(file);
      const uid = 'upload_' + Date.now() + '_' + Math.random();
      const div = document.createElement('div');
      div.className = 'rimg-item';
      div.dataset.url = url;
      div.dataset.index = uid;
      div.innerHTML = `<img src="${url}" alt=""><div class="rimg-badge" style="display:none">✓</div><div class="rimg-main-badge" style="display:none">MAIN</div><div class="rimg-source">Upload</div>`;
      div.addEventListener('click', () => {
        const i = _selectedImages.findIndex(s=>s.url===url);
        if (i>-1) _selectedImages.splice(i,1); else _selectedImages.push({index:uid,url,source:'upload'});
        refreshImageBadges();
      });
      el.appendChild(div);
    } catch(e) {
      showToast('✗ Image upload failed — ' + e.message, 'error');
    }
  }
}

function addManualPhoto() {
  const urlInput = document.getElementById('rf_manualPhotoUrl');
  if (!urlInput) return;
  const url = urlInput.value.trim();
  if (!url) return;
  const el = document.getElementById('rf_images');
  const uid = 'manual_' + Date.now();
  const div = document.createElement('div');
  div.className = 'rimg-item';
  div.dataset.url = url;
  div.dataset.index = uid;
  div.innerHTML = `<img src="${escHtml(url)}" alt="" onerror="this.parentElement.style.display='none'"><div class="rimg-badge" style="display:none">✓</div><div class="rimg-main-badge" style="display:none">MAIN</div><div class="rimg-source">Manual</div>`;
  div.addEventListener('click', () => {
    const i = _selectedImages.findIndex(s=>s.url===url);
    if (i>-1) _selectedImages.splice(i,1); else _selectedImages.push({index:uid,url,source:'manual'});
    refreshImageBadges();
  });
  el.appendChild(div);
  _selectedImages.push({index:uid, url, source:'manual'});
  refreshImageBadges();
  urlInput.value = '';
}

/* ----- DISCOGRAPHY ----- */
function renderResearchDiscog(discog) {
  const el = document.getElementById('rf_discog');
  const countEl = document.getElementById('rf_discogCount');
  _selectedDiscog.clear();
  if (!discog.length) {
    if(el) el.innerHTML = '<div style="color:var(--muted);font-size:0.7rem">No releases found</div>';
    if(countEl) countEl.textContent = '';
    return;
  }
  if(countEl) countEl.textContent = `(${discog.length})`;
  discog.forEach((_,i) => _selectedDiscog.add(i));
  if(!el) return;
  el.innerHTML = discog.map((rel,i) => `
    <div class="rdiscog-item selected ${rel.cover ? '' : 'no-cover'}" data-index="${i}" onclick="toggleResearchDiscog(this,${i})">
      <img src="${escHtml(rel.cover||'')}" alt="" loading="lazy"
           onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%2260%22 height=%2260%22%3E%3Crect width=%2260%22 height=%2260%22 fill=%22%23111%22/%3E%3C/svg%3E'">
      <div class="rdiscog-info">
        <div class="rdiscog-title">${escHtml(rel.title||'')}</div>
        <div class="rdiscog-meta">${rel.year||''}${rel.type?' · '+rel.type:''}</div>
      </div>
    </div>`).join('');
}

function toggleResearchDiscog(el, i) {
  if (_selectedDiscog.has(i)) { _selectedDiscog.delete(i); el.classList.remove('selected'); }
  else { _selectedDiscog.add(i); el.classList.add('selected'); }
}
function selectAllDiscog()  { (_researchData?.discography||[]).forEach((_,i)=>_selectedDiscog.add(i)); document.querySelectorAll('.rdiscog-item').forEach(e=>e.classList.add('selected')); }
function selectNoneDiscog() { _selectedDiscog.clear(); document.querySelectorAll('.rdiscog-item').forEach(e=>e.classList.remove('selected')); }

/* ----- APPLY RESEARCH TO ARTIST ----- */

function videoUrlFromResearch(v) {
  if (!v) return '';
  if (v.url) return v.url;
  if (v.id) return `https://www.youtube.com/watch?v=${v.id}`;
  return '';
}

function extractVideoIdFromUrl(url) {
  const yt = String(url || '').match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([^&\s?]+)/);
  if (yt) return yt[1];
  const vm = String(url || '').match(/vimeo\.com\/(\d+)/);
  if (vm) return vm[1];
  return '';
}


const BAD_RESEARCH_VIDEO_IDS = new Set(['jNQXAC9IVRw', 'dQw4w9WgXcQ']);
const BAD_RESEARCH_VIDEO_TITLE_RE = /\b(me at the zoo|rick astley|never gonna give you up)\b/i;
function isBadResearchVideo(v) {
  const url = videoUrlFromResearch(v);
  const id = v?.id || extractVideoIdFromUrl(url);
  const title = String(v?.title || '');
  return BAD_RESEARCH_VIDEO_IDS.has(id) || BAD_RESEARCH_VIDEO_TITLE_RE.test(title);
}
function cleanResearchVideos(videos) {
  return (videos || []).filter(v => !isBadResearchVideo(v));
}

function renderResearchVideos(videos) {
  videos = cleanResearchVideos(videos);
  if (_researchData) _researchData.videos = videos;
  const el = document.getElementById('rf_videos');
  const countEl = document.getElementById('rf_videoCount');
  _selectedVideos.clear();
  if (!videos.length) {
    if (el) el.innerHTML = '<div style="color:var(--muted);font-size:0.7rem">No videos found — paste manual URLs below</div>';
    if (countEl) countEl.textContent = '';
    return;
  }
  if (countEl) countEl.textContent = `(${videos.length})`;
  videos.forEach((_, i) => _selectedVideos.add(i));
  if (!el) return;
  el.innerHTML = videos.map((v, i) => {
    const url = videoUrlFromResearch(v);
    const id = v.id || extractVideoIdFromUrl(url);
    const thumb = v.thumb || (id ? `https://img.youtube.com/vi/${id}/mqdefault.jpg` : '');
    return `
      <div class="rvideo-item selected" data-index="${i}" onclick="toggleResearchVideo(this,${i})">
        <img src="${escHtml(thumb)}" alt="" loading="lazy" onerror="this.style.display='none'">
        <div class="rvideo-info">
          <div class="rvideo-title">${escHtml(v.title || 'Video')}</div>
          <div class="rvideo-meta">${escHtml(url)}</div>
        </div>
      </div>`;
  }).join('');
}

function toggleResearchVideo(el, i) {
  if (_selectedVideos.has(i)) { _selectedVideos.delete(i); el.classList.remove('selected'); }
  else { _selectedVideos.add(i); el.classList.add('selected'); }
}
function selectAllVideos()  { (_researchData?.videos||[]).forEach((_,i)=>_selectedVideos.add(i)); document.querySelectorAll('.rvideo-item').forEach(e=>e.classList.add('selected')); }
function selectNoneVideos() { _selectedVideos.clear(); document.querySelectorAll('.rvideo-item').forEach(e=>e.classList.remove('selected')); }

function applyResearch() {
  if (!_researchData) return;
  const d = _researchData;
  const sel = document.getElementById('researchArtistSelect');
  const nameInput = document.getElementById('researchArtistName');
  const overwrite = document.getElementById('researchOverwrite')?.checked;

  const artists = getArtists();
  let artistId = (sel && sel.value) || _researchArtistId;
  let artist = artistId ? artists.find(a => a.id === artistId) : null;

  if (!artist) {
    artist = {
      id: 'artist_' + Date.now(),
      name: d.name || (nameInput && nameInput.value.trim()) || 'Unknown',
      slug: (d.name || 'unknown').toLowerCase().replace(/[^a-z0-9]+/g,'-'),
      status: 'active', featured: false,
      stats: {}, publishTargets: {}, epk: null, discography: [], photos: [],
    };
    artists.push(artist);
    _researchArtistId = artist.id;
  }

  // Per-field update/keep: read the rut-btn.active value for each field
  function getUpdateMode(field) {
    const toggle = document.querySelector(`.rfield-update-toggle[data-field="${field}"]`);
    if (!toggle) return 'update';
    const active = toggle.querySelector('.rut-btn.active');
    return active ? active.dataset.val : 'update';
  }

  function maybeSet(key, val, fieldName) {
    const field = fieldName || key;
    const mode = getUpdateMode(field);
    if (mode === 'update' || !artist[key]) {
      if (val || val === 0) artist[key] = val;
      return;
    }
    // Keep mode: save edits typed into the existing/current information box.
    const existingEdited = getEditedExistingResearchField(field, artist[key]);
    if (existingEdited || existingEdited === 0) artist[key] = existingEdited;
  }

  // Field-by-field, respect publish target AND update/keep toggle.
  // Read from editable research review inputs so users can correct AI output before saving.
  const pt = _publishTargets;
  if (pt.name     !== 'none') maybeSet('name',     getEditedResearchField('name', d.name),         'name');
  if (pt.genres   !== 'none') maybeSet('genres',   getEditedResearchField('genres', d.genres),     'genres');
  if (pt.location !== 'none') maybeSet('location', getEditedResearchField('location', d.location), 'location');
  // Deprecated: public artist pages no longer use AI-generated shortBio; use verified quotes instead.
  if (pt.bio      !== 'none') maybeSet('bio',      getEditedResearchField('bio', d.bio),           'bio');
  if (pt.notes    !== 'none') maybeSet('notes',    getEditedResearchField('notes', d.notes),       'notes');

  // Stats — always store regardless of publish target (target controls display only)
  const lf = d.lastfm || {};
  if (lf.listeners || lf.playcount) {
    artist.stats = {
      ...(artist.stats||{}),
      lastfmListeners: lf.listeners||0,
      lastfmPlaycount: lf.playcount||0,
      lastfmTags:      lf.tags||[],
      lastfmUrl:       lf.url||'',
      updatedAt:       new Date().toISOString(),
    };
  }

  // Store publish targets
  artist.publishTargets = { ...pt };

  // Quotes
  if (pt.quotes !== 'none') {
    const selected = [...document.querySelectorAll('.rq-check:checked')]
      .map(cb => { const q=(d.quotes||[])[parseInt(cb.dataset.index)]; return q?`"${q.text}" — ${q.source}${q.year?', '+q.year:''}`:null; })
      .filter(Boolean);
    if (selected.length) {
      const existing = (artist.quotes||'').trim();
      artist.quotes = (existing && !overwrite) ? existing+'\n\n'+selected.join('\n\n') : selected.join('\n\n');
    }
  }

  // Socials — editable in the review table before Apply
  document.querySelectorAll('.rs-check:checked').forEach(cb => {
    const key = cb.dataset.social;
    const input = document.querySelector(`.rs-input[data-social="${key}"]`);
    const url = (input?.value || '').trim();
    if (url && (overwrite || !artist[key])) artist[key] = url;
  });

  // Images
  if (_selectedImages.length) {
    const first = _selectedImages[0];
    if (first && (overwrite || !artist.photo)) artist.photo = first.url;
    const extras = _selectedImages.slice(1).map(s=>s.url).filter(Boolean);
    if (extras.length) {
      artist.photos = overwrite ? extras : [...new Set([...(artist.photos||[]),...extras])];
    }
  }

  // Discography — merge improved research data into existing releases.
  // Important: previously this only replaced when Overwrite was checked, so newly
  // found album covers stayed in the preview and never reached the artist page.
  if (pt.discography !== 'none' && getUpdateMode('discography') === 'update') {
    const allDiscog = d.discography || [];
    const sel2 = [..._selectedDiscog].sort((a,b)=>a-b).map(i=>allDiscog[i]).filter(Boolean);
    if (sel2.length) {
      if (overwrite || !artist.discography?.length) {
        artist.discography = sel2;
      } else {
        const keyForRelease = (r) => {
          if (!r) return '';
          if (r.mbid) return 'mbid:' + String(r.mbid).toLowerCase();
          return 'title:' + String(r.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + String(r.year || '').trim();
        };
        const existing = Array.isArray(artist.discography) ? [...artist.discography] : [];
        const index = new Map(existing.map((r, i) => [keyForRelease(r), i]).filter(([k]) => k && k !== 'title:|'));

        const titleYearKey = (r) => String(r?.title || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() + '|' + String(r?.year || '').trim();
        sel2.forEach(incoming => {
          const key = keyForRelease(incoming);
          let i = index.get(key);
          if (i === undefined) {
            const ty = titleYearKey(incoming);
            i = existing.findIndex(r => titleYearKey(r) === ty && ty !== '|');
          }
          if (i !== undefined && i > -1) {
            const current = existing[i] || {};
            existing[i] = {
              ...current,
              ...incoming,
              // Preserve an existing cover unless the incoming research found one and
              // current is blank; or overwrite is explicitly checked.
              cover: incoming.cover && (!current.cover || overwrite) ? incoming.cover : (current.cover || incoming.cover || ''),
              mbid: current.mbid || incoming.mbid || '',
            };
          } else {
            existing.push(incoming);
          }
        });
        artist.discography = existing;
      }
    }
  }

  // Videos — save selected research videos + manual URLs into mk_videos and artist.videos
  if (pt.videos !== 'none' && getUpdateMode('videos') === 'update') {
    const selectedResearchVideos = [..._selectedVideos]
      .sort((a,b)=>a-b)
      .map(i => (d.videos || [])[i])
      .filter(Boolean)
      .map(v => ({
        url: videoUrlFromResearch(v),
        title: v.title || artist.name,
        thumb: v.thumb || (v.id ? `https://img.youtube.com/vi/${v.id}/mqdefault.jpg` : ''),
      }))
      .filter(v => v.url);

    const manualVideos = (document.getElementById('rf_manualVideos')?.value || '')
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => {
        const parts = line.split('|').map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) return { title: parts[0], url: parts.slice(1).join(' | '), thumb: '' };
        return { title: artist.name, url: line, thumb: '' };
      })
      .filter(v => v.url);

    const incomingVideos = [...selectedResearchVideos, ...manualVideos];
    if (incomingVideos.length) {
      const videos = getVideos();
      artist.videos = overwrite ? [] : (artist.videos || []);

      incomingVideos.forEach(v => {
        const vid = extractVideoIdFromUrl(v.url);
        const thumb = v.thumb || (vid && v.url.includes('youtu') ? `https://img.youtube.com/vi/${vid}/mqdefault.jpg` : '');
        const existsGlobal = videos.some(ex => ex.url === v.url || (vid && ex.url && ex.url.includes(vid)));
        if (!existsGlobal) {
          videos.push({
            id: 'vid_' + Date.now() + '_' + Math.random().toString(36).slice(2,6),
            artistId: artist.id,
            artistName: artist.name,
            url: v.url,
            title: v.title || artist.name,
            thumb,
            category: 'Music Video',
            featured: false,
          });
        }
        const existsArtist = artist.videos.some(ex => (ex.url || ex) === v.url || (vid && (ex.url || ex || '').includes(vid)));
        if (!existsArtist) artist.videos.push({ url: v.url, title: v.title || artist.name });
      });
      saveVideos(videos);
    }
  }

  const idx = artists.findIndex(a => a.id === artist.id);
  if (idx>-1) artists[idx]=artist; else artists.push(artist);
  saveArtists(artists);

  // Flash
  const btn = document.getElementById('researchRunBtn');
  const orig = btn.textContent;
  btn.textContent = '✓ Saved!';
  btn.style.borderColor='#4ade80'; btn.style.color='#4ade80';
  const metaEl = document.getElementById('researchResultsMeta');
  if(metaEl) metaEl.textContent += '  ✓ Saved';
  setTimeout(()=>{ btn.textContent=orig; btn.style.borderColor=''; btn.style.color=''; },2500);

  // Refresh dropdown selection
  const selEl = document.getElementById('researchArtistSelect');
  if(selEl) { initResearchPage(); selEl.value = artist.id; }
}

/* ==================== EPK BUILDER ==================== */

function renderEPKList() {
  const list = document.getElementById('epkArtistList');
  if (!list) return;
  const artists = getArtists().filter(a=>a.status==='active');
  list.innerHTML = artists.map(a=>`
    <div class="epk-artist-item ${a.epk?'has-epk':''}" onclick="openEPKEditor('${a.id}')">
      ${a.photo?`<img class="epk-artist-avatar" src="${escHtml(a.photo)}" alt="${escHtml(a.name)}" onerror="this.style.display='none'">`:
        `<div class="epk-artist-avatar" style="background:#1a1a1a;display:flex;align-items:center;justify-content:center;font-size:1rem">${escHtml(a.name[0]||'?')}</div>`}
      <span>${escHtml(a.name)}</span>
      ${a.epk?'<span class="epk-badge">EPK</span>':''}
    </div>`).join('');
}

function openEPK(artistId) { showView('epk'); openEPKEditor(artistId); }

function openEPKEditor(artistId) {
  const a = getArtists().find(x=>x.id===artistId);
  if (!a) return;
  document.querySelectorAll('.epk-artist-item').forEach(el=>{
    el.classList.toggle('active', el.getAttribute('onclick')?.includes(artistId));
  });
  const epk = a.epk || { heroStyle:'fullBleed', accentColor:'#c8a96e', showSocials:true, showSpotify:true, showVideos:true, showPhotos:true, showTechRider:true, showQuotes:true, showGigCalendar:true, showStats:true, showDiscog:true, customIntro:'', embedGigwell:'', gigwellBooking:'', published:false };
  const editor = document.getElementById('epkEditor');
  if (!editor) return;
  const epkUrl = `/epk/${a.slug||a.id}`;
  editor.innerHTML = `
    <div class="epk-editor-inner">
      <div class="epk-preview-btn">
        <div class="epk-url-display">${window.location.origin}${epkUrl}</div>
        <button class="btn-secondary" onclick="window.open('${epkUrl}','_blank')">Preview →</button>
        <button class="btn-primary" onclick="saveAndPublishEPK('${a.id}')">Save &amp; Publish</button>
      </div>
      <div class="epk-section">
        <div class="epk-section-header"><span class="epk-section-title">Header</span></div>
        <div class="epk-section-body">
          <div class="form-row">
            <div class="form-group">
              <label>Hero Style</label>
              <select id="epkHeroStyle" class="form-input">
                <option value="fullBleed" ${epk.heroStyle==='fullBleed'?'selected':''}>Full Bleed Photo</option>
                <option value="split" ${epk.heroStyle==='split'?'selected':''}>Split</option>
                <option value="cinematic" ${epk.heroStyle==='cinematic'?'selected':''}>Cinematic Dark</option>
              </select>
            </div>
            <div class="form-group">
              <label>Accent Colour</label>
              <input type="color" id="epkAccentColor" class="form-input" value="${escHtml(epk.accentColor)}" style="height:38px;padding:2px">
            </div>
          </div>
          <div class="form-group">
            <label>Custom Intro</label>
            <textarea id="epkCustomIntro" class="form-input form-textarea" rows="3">${escHtml(epk.customIntro||a.shortBio||'')}</textarea>
          </div>
        </div>
      </div>
      <div class="epk-section">
        <div class="epk-section-header"><span class="epk-section-title">Content Sections</span></div>
        <div class="epk-section-body">
          ${epkToggle('epkShowSocials','Social Media Links',epk.showSocials)}
          ${epkToggle('epkShowStats','Audience Stats (Last.fm)',epk.showStats)}
          ${epkToggle('epkShowSpotify','Spotify Player',epk.showSpotify)}
          ${epkToggle('epkShowDiscog','Discography',epk.showDiscog)}
          ${epkToggle('epkShowVideos','Video Gallery',epk.showVideos)}
          ${epkToggle('epkShowPhotos','Photo Gallery / EPK Images',epk.showPhotos ?? true)}
          ${epkToggle('epkShowQuotes','Press Quotes',epk.showQuotes)}
          ${epkToggle('epkShowTechRider','Tech Rider Link',epk.showTechRider)}
          ${epkToggle('epkShowGigCalendar','Gig Calendar (Bandsintown)',epk.showGigCalendar)}
        </div>
      </div>
      <div class="epk-section">
        <div class="epk-section-header"><span class="epk-section-title">Gigwell Integration</span></div>
        <div class="epk-section-body">
          <div class="form-group">
            <label>Gigwell EPK Embed Code</label>
            <textarea id="epkGigwellEmbed" class="form-input form-textarea" rows="3" placeholder="&lt;iframe…">${escHtml(epk.embedGigwell||'')}</textarea>
          </div>
          <div class="form-group">
            <label>Gigwell Booking Form URL</label>
            <input type="url" id="epkGigwellBooking" class="form-input" value="${escHtml(epk.gigwellBooking||'')}">
          </div>
        </div>
      </div>
      <div class="epk-section">
        <div class="epk-section-header"><span class="epk-section-title">Downloads</span></div>
        <div class="epk-section-body">
          <div class="form-row">
            <div class="form-group"><label>Tech Rider URL</label><input type="url" id="epkTechRider" class="form-input" value="${escHtml(a.techRider||'')}"></div>
            <div class="form-group"><label>Press Kit URL</label><input type="url" id="epkPresskit" class="form-input" value="${escHtml(a.presskit||'')}"></div>
          </div>
        </div>
      </div>
      <div style="text-align:right;padding:1rem 0">
        <button class="btn-primary" onclick="saveAndPublishEPK('${a.id}')">Save &amp; Publish EPK</button>
      </div>
    </div>`;
}

function epkToggle(id, label, checked) {
  return `<label class="epk-toggle-row"><input type="checkbox" id="${id}" ${checked?'checked':''} style="accent-color:#c084fc"><span>${label}</span></label>`;
}

function saveAndPublishEPK(artistId) {
  const artists = getArtists();
  const idx = artists.findIndex(a=>a.id===artistId);
  if (idx<0) return;
  const epk = {
    heroStyle:       document.getElementById('epkHeroStyle')?.value||'fullBleed',
    accentColor:     document.getElementById('epkAccentColor')?.value||'#c8a96e',
    showSocials:     document.getElementById('epkShowSocials')?.checked??true,
    showStats:       document.getElementById('epkShowStats')?.checked??true,
    showSpotify:     document.getElementById('epkShowSpotify')?.checked??true,
    showDiscog:      document.getElementById('epkShowDiscog')?.checked??true,
    showVideos:      document.getElementById('epkShowVideos')?.checked??true,
    showPhotos:      document.getElementById('epkShowPhotos')?.checked??true,
    showQuotes:      document.getElementById('epkShowQuotes')?.checked??true,
    showTechRider:   document.getElementById('epkShowTechRider')?.checked??true,
    showGigCalendar: document.getElementById('epkShowGigCalendar')?.checked??true,
    customIntro:     document.getElementById('epkCustomIntro')?.value||'',
    embedGigwell:    document.getElementById('epkGigwellEmbed')?.value||'',
    gigwellBooking:  document.getElementById('epkGigwellBooking')?.value||'',
    published:       true,
    publishedAt:     new Date().toISOString(),
  };
  const t=document.getElementById('epkTechRider');  if(t) artists[idx].techRider=t.value;
  const p=document.getElementById('epkPresskit');   if(p) artists[idx].presskit=p.value;
  artists[idx].epk = epk;
  saveArtists(artists);
  renderEPKList();
}

/* ==================== VIDEOS ==================== */

function normalizeVideoOrder(videos) {
  return (videos || []).map((v, i) => ({ ...v, order: Number.isFinite(Number(v.order)) ? Number(v.order) : i }));
}

function renderVideoGrid() {
  const grid = document.getElementById('videoGrid');
  if (!grid) return;
  const videos = normalizeVideoOrder(getVideos()).sort((a,b)=>(a.order??0)-(b.order??0));
  if (!videos.length) { grid.innerHTML='<div class="empty-state">No videos yet. Add one above.</div>'; return; }
  grid.innerHTML = videos.map((v,i)=>`
    <div class="video-admin-card">
      <div class="video-thumb"><iframe src="${escHtml(getEmbedUrl(v.url))}" frameborder="0" loading="lazy"></iframe></div>
      <div class="video-info">
        <div class="video-title">${escHtml(v.title||v.artistName||'Untitled Video')}</div>
        <div class="video-meta">${escHtml(v.artistName||'Unassigned')} · ${escHtml(v.category||'Music Video')}</div>
        ${v.description ? `<div class="video-description">${escHtml(v.description)}</div>` : ''}
        <div class="video-actions">
          <button class="btn-secondary btn-sm" onclick="moveVideo('${escAttr(v.id)}',-1)" ${i===0?'disabled':''}>↑</button>
          <button class="btn-secondary btn-sm" onclick="moveVideo('${escAttr(v.id)}',1)" ${i===videos.length-1?'disabled':''}>↓</button>
          <button class="btn-secondary btn-sm" onclick="editVideo('${escAttr(v.id)}')">Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteVideo('${escAttr(v.id)}')">Remove</button>
        </div>
      </div>
    </div>`).join('');
}

function getEmbedUrl(url) {
  if (!url) return '';
  const yt = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/))([^&\s?]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?modestbranding=1`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return url;
}

function showVideoForm() {
  clearVideoForm(false);
  const form = document.getElementById('videoManagerForm');
  if (form) form.scrollIntoView({behavior:'smooth', block:'start'});
  const artistInput = document.getElementById('videoArtist');
  if (artistInput) artistInput.focus();
}

function clearVideoForm(doFocus=true) {
  ['videoEditId','videoArtist','videoTitle','videoUrl','videoDescription'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  if (doFocus) document.getElementById('videoArtist')?.focus();
}

function saveVideoFromForm() {
  const id = document.getElementById('videoEditId')?.value || '';
  const artistName = (document.getElementById('videoArtist')?.value || '').trim();
  const title = (document.getElementById('videoTitle')?.value || '').trim();
  const url = (document.getElementById('videoUrl')?.value || '').trim();
  const description = (document.getElementById('videoDescription')?.value || '').trim();
  if (!url) { alert('Please add a video URL.'); return; }
  const videos = normalizeVideoOrder(getVideos()).sort((a,b)=>(a.order??0)-(b.order??0));
  const idx = id ? videos.findIndex(v => v.id === id) : -1;
  const payload = {
    id: id || ('vid_' + Date.now()),
    artistName: artistName || 'Melankolia Artist',
    title: title || artistName || 'Music Video',
    url,
    description,
    category: 'Music Video',
    featured: idx >= 0 ? !!videos[idx].featured : false,
    order: idx >= 0 ? videos[idx].order : videos.length
  };
  if (idx >= 0) videos[idx] = { ...videos[idx], ...payload };
  else videos.push(payload);
  createDataBackup(idx >= 0 ? 'Before editing video' : 'Before adding video');
  saveVideos(videos.map((v,i)=>({ ...v, order:i })));
  clearVideoForm(false);
  renderVideoGrid();
  updateStats();
}

function editVideo(id) {
  const v = getVideos().find(x => x.id === id);
  if (!v) return;
  document.getElementById('videoEditId').value = v.id || '';
  document.getElementById('videoArtist').value = v.artistName || v.artist_name || '';
  document.getElementById('videoTitle').value = v.title || '';
  document.getElementById('videoUrl').value = v.url || '';
  document.getElementById('videoDescription').value = v.description || '';
  document.getElementById('videoManagerForm')?.scrollIntoView({behavior:'smooth', block:'start'});
}

function moveVideo(id, dir) {
  const videos = normalizeVideoOrder(getVideos()).sort((a,b)=>(a.order??0)-(b.order??0));
  const idx = videos.findIndex(v => v.id === id);
  const next = idx + dir;
  if (idx < 0 || next < 0 || next >= videos.length) return;
  [videos[idx], videos[next]] = [videos[next], videos[idx]];
  createDataBackup('Before reordering videos');
  saveVideos(videos.map((v,i)=>({ ...v, order:i })));
  renderVideoGrid();
}

function deleteVideo(id) {
  if(!confirm('Remove this video?')) return;
  createDataBackup('Before removing video');
  saveVideos(normalizeVideoOrder(getVideos()).filter(v=>v.id!==id).map((v,i)=>({ ...v, order:i })));
  renderVideoGrid();
  updateStats();
}

function syncArtistVideosToGlobal(artist) {
  if (!artist || !Array.isArray(artist.videos) || !artist.videos.length) return;
  const videos = normalizeVideoOrder(getVideos()).sort((a,b)=>(a.order??0)-(b.order??0));
  const seen = new Set(videos.map(v => String(v.url || '').trim().toLowerCase()).filter(Boolean));
  artist.videos.forEach(v => {
    const url = String((typeof v === 'string' ? v : v.url) || '').trim();
    if (!url || seen.has(url.toLowerCase())) return;
    seen.add(url.toLowerCase());
    videos.push({
      id: 'vid_' + Date.now() + '_' + Math.random().toString(36).slice(2,7),
      artistId: artist.id || '',
      artistName: artist.name || '',
      title: (typeof v === 'object' && v.title) ? v.title : (artist.name || 'Music Video'),
      url,
      description: (typeof v === 'object' && v.description) ? v.description : '',
      category: 'Music Video',
      featured: false,
      order: videos.length
    });
  });
  saveVideos(videos.map((v,i)=>({ ...v, order:i })));
}

/* ==================== BOOKINGS ==================== */

function renderBookings() {
  const list=document.getElementById('bookingList'); if(!list) return;
  const b=getBookings();
  if(!b.length){list.innerHTML='<div class="empty-state">No booking requests yet.</div>';return;}
  list.innerHTML=b.map(x=>`
    <div class="booking-card">
      <div class="booking-meta">${escHtml(x.name||'')} · ${escHtml(x.email||'')} · ${x.date||''}</div>
      <div class="booking-detail">${escHtml(x.artist||'')} — ${escHtml(x.venue||'')} — ${escHtml(x.message||'')}</div>
    </div>`).join('');
}

/* ==================== INIT ==================== */

initData();
renderDashboard();
renderArtistGrid();

/* ===================== Contact Discovery ===================== */
const CONTACT_PROPOSALS_API = '/.netlify/functions/contact-proposals';
const SCAN_REQUEST_API = '/.netlify/functions/contact-scan-request';
let _discFilter = 'pending';
let _discProposals = [];

function initContactDiscovery() {
  loadProposals();
  refreshDiscStats();
}

async function proposalsCall(payload) {
  const res = await fetch(CONTACT_PROPOSALS_API, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: ADMIN_PUBLISH_PASSWORD, ...payload }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j.success === false) throw new Error(j.error || 'request failed');
  return j;
}

async function refreshDiscStats() {
  try {
    const j = await proposalsCall({ action: 'stats' });
    const s = j.data || {};
    const el = document.getElementById('discStats');
    if (el) el.innerHTML = `<b>${s.pending || 0}</b> pending &middot; ${s.new || 0} new &middot; ${s.update || 0} updates &middot; ${s.approved || 0} approved &middot; ${s.rejected || 0} rejected`;
  } catch (e) { /* silent */ }
}

function setDiscFilter(f, btn) {
  _discFilter = f;
  document.querySelectorAll('.disc-filters .chip').forEach(c => c.classList.remove('active'));
  if (btn) btn.classList.add('active');
  loadProposals();
}

async function loadProposals() {
  const host = document.getElementById('discList');
  if (host) host.innerHTML = '<p class="muted">Loading proposals\u2026</p>';
  try {
    let payload = { action: 'list' };
    if (_discFilter === 'new' || _discFilter === 'update') { payload.status = 'pending'; payload.type = _discFilter; }
    else payload.status = _discFilter;
    const j = await proposalsCall(payload);
    _discProposals = j.data || [];
    renderProposals();
    refreshDiscStats();
  } catch (e) {
    if (host) host.innerHTML = `<p class="disc-status err">Couldn't load proposals: ${escapeHtml(e.message)}</p>`;
  }
}

function renderProposals() {
  const host = document.getElementById('discList');
  if (!host) return;
  if (!_discProposals.length) {
    host.innerHTML = '<p class="muted">No proposals here. Run a scan or switch filters.</p>';
    return;
  }
  host.innerHTML = _discProposals.map(p => {
    const c = p.candidate || {};
    const low = (p.confidence === 'low');
    const isUpdate = p.type === 'update';
    const badge = isUpdate
      ? '<span class="disc-badge update">Enrich existing</span>'
      : '<span class="disc-badge new">New contact</span>';
    const lowb = low ? '<span class="disc-badge lowconf">Verify match</span>' : '';
    const marketb = c.market ? `<span class="disc-badge market-chip">${escapeHtml(c.market)}</span>` : '';
    const fields = [];
    if (c.email) fields.push(`<span><b>Email</b> ${escapeHtml(c.email)}</span>`);
    if (c.phone) fields.push(`<span><b>Phone</b> ${escapeHtml(c.phone)}</span>`);
    const locStr = [c.city, c.region, c.country].filter(Boolean).join(', ');
    if (locStr) fields.push(`<span><b>Location</b> ${escapeHtml(locStr)}</span>`);
    if (c.website) fields.push(`<span><b>Web</b> ${escapeHtml(c.website)}</span>`);
    if (c.instagram) fields.push(`<span><b>IG</b> ${escapeHtml(c.instagram)}</span>`);
    if (c.contact_type) fields.push(`<span><b>Type</b> ${escapeHtml(c.contact_type)}</span>`);
    let venuesHtml = '';
    if (Array.isArray(c.venues) && c.venues.length) {
      const chips = c.venues.map(v => {
        const nm = escapeHtml(v.name || '');
        const ci = v.city ? ` <span class="disc-venue-city">${escapeHtml(v.city)}</span>` : '';
        return `<span class="disc-venue-chip">${nm}${ci}</span>`;
      }).join('');
      venuesHtml = `<div class="disc-venues"><b>Venues</b> ${chips}</div>`;
    }
    let diff = '';
    if (isUpdate && p.proposed_fields) {
      const rows = Object.entries(p.proposed_fields).filter(([k, v]) => v);
      if (rows.length) diff = `<div class="disc-diff">Will fill on <b>${escapeHtml((p.existing_snapshot && p.existing_snapshot.name) || 'existing venue')}</b>: ` +
        rows.map(([k, v]) => `<span class="add">+ ${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`).join(' &middot; ') + '</div>';
    }
    const note = p.note ? `<div class="disc-note">\u26a0 ${escapeHtml(p.note)}</div>` : '';
    const pending = (p.status || 'pending') === 'pending';
    const actions = pending ? `
      <button class="btn-primary" onclick="approveProposal('${p.id}')">\u2713 Approve</button>
      <button class="btn-secondary" onclick="rejectProposal('${p.id}')">\u2715 Reject</button>` :
      `<span class="disc-sub">${escapeHtml(p.status)}</span>`;
    return `<div class="disc-card">
      <input type="checkbox" class="disc-check" data-pid="${p.id}" ${pending ? '' : 'disabled'}>
      <div class="disc-main">
        <div>${badge}${lowb}${marketb}<span class="disc-name">${escapeHtml(c.venue_name || c.org || c.name || c.email || 'Unknown')}</span></div>
        <div class="disc-sub">${escapeHtml(c.name || '')}${c.name && c.org ? ' \u2014 ' : ''}${escapeHtml(c.org && c.org !== c.venue_name ? c.org : '')}</div>
        <div class="disc-fields">${fields.join('')}</div>
        ${venuesHtml}
        ${diff}${note}
      </div>
      <div class="disc-actions">${actions}</div>
    </div>`;
  }).join('');
}

function discSelectAll(on) {
  document.querySelectorAll('#discList .disc-check:not(:disabled)').forEach(cb => { cb.checked = on; });
}

async function approveProposal(id) {
  try {
    await proposalsCall({ action: 'approve', id });
    showDiscStatus('Approved \u2014 saved to Contact Manager.', 'ok');
    loadProposals();
  } catch (e) { showDiscStatus('Approve failed: ' + e.message, 'err'); }
}

async function rejectProposal(id) {
  const reason = prompt('Reason for rejecting (optional):', '') || '';
  try {
    await proposalsCall({ action: 'reject', id, reason });
    loadProposals();
  } catch (e) { showDiscStatus('Reject failed: ' + e.message, 'err'); }
}

async function bulkApproveProposals() {
  const ids = Array.from(document.querySelectorAll('#discList .disc-check:checked')).map(cb => cb.dataset.pid);
  if (!ids.length) { showDiscStatus('Select at least one proposal first.', 'err'); return; }
  showDiscStatus(`Approving ${ids.length}\u2026`, 'working');
  try {
    const j = await proposalsCall({ action: 'bulk_approve', ids });
    showDiscStatus(`Approved ${j.approved}, ${j.failed} failed.`, j.failed ? 'err' : 'ok');
    loadProposals();
  } catch (e) { showDiscStatus('Bulk approve failed: ' + e.message, 'err'); }
}

// The Gmail scan is performed by the Superagent (it holds the Gmail connection).
// This button files a scan request the agent picks up, then the panel refreshes.
async function requestContactScan() {
  const days = document.getElementById('discWindow').value || '90';
  const btn = document.getElementById('discScanBtn');
  if (btn) { btn.disabled = true; btn.textContent = '\u2709 Requesting scan\u2026'; }
  try {
    await fetch(SCAN_REQUEST_API, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: ADMIN_PUBLISH_PASSWORD, action: 'request', days: Number(days) }),
    }).catch(() => {});
    showDiscStatus(`Scan requested for the last ${days} days. Your agent scans the inbox and files proposals here \u2014 this list auto-refreshes. You can also just tell the agent: \u201cscan the booking inbox for new contacts\u201d.`, 'working');
    // poll for new proposals for ~2 min
    let tries = 0;
    const t = setInterval(async () => {
      tries++;
      await loadProposals();
      if (tries >= 24) clearInterval(t);
    }, 5000);
  } catch (e) {
    showDiscStatus('Could not file scan request: ' + e.message, 'err');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '\u2709 Scan inbox for contacts'; }
  }
}

function showDiscStatus(msg, kind) {
  const el = document.getElementById('discScanStatus');
  if (!el) return;
  el.style.display = 'block';
  el.className = 'disc-status ' + (kind || '');
  el.innerHTML = msg;
}

function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }
