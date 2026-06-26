/* ================================================
   MELANKOLIA TOUR LIBRARY
   - Tour save/load/archive (localStorage)
   - Venue Intelligence Memory (per-city knowledge bank)
   - Market Performance Tracker
   - Pitch Email Generator
   ================================================ */

/* ---- STORAGE KEYS ---- */
const TL_TOURS_KEY   = 'mk_saved_tours';
const TL_VENUES_KEY  = 'mk_venue_bank';
const TL_MARKETS_KEY = 'mk_market_data';

/* ====================================================
   TOUR STORAGE LAYER
   ==================================================== */

function tlGetTours() {
  try { return JSON.parse(localStorage.getItem(TL_TOURS_KEY) || '[]'); } catch { return []; }
}

function tlSaveTours(tours) {
  localStorage.setItem(TL_TOURS_KEY, JSON.stringify(tours));
}

function tlSaveTour(tourData, meta = {}) {
  const tours = tlGetTours();
  const id = 'tour_' + Date.now();
  const entry = {
    id,
    artist:    meta.artist    || tourData.tour_name?.split(' ')[0] || 'Unknown',
    name:      meta.name      || tourData.tour_name || 'Untitled Tour',
    region:    meta.region    || 'USA',
    startDate: meta.startDate || '',
    endDate:   meta.endDate   || '',
    status:    meta.status    || 'draft',   // draft | active | completed | archived
    savedAt:   new Date().toISOString(),
    data:      tourData,
    notes:     meta.notes     || '',
    // Performance log added after tour
    performance: null
  };
  tours.unshift(entry);
  tlSaveTours(tours);
  return id;
}

function tlUpdateTour(id, updates) {
  const tours = tlGetTours();
  const i = tours.findIndex(t => t.id === id);
  if (i === -1) return false;
  tours[i] = { ...tours[i], ...updates, updatedAt: new Date().toISOString() };
  tlSaveTours(tours);
  return true;
}

function tlDeleteTour(id) {
  tlSaveTours(tlGetTours().filter(t => t.id !== id));
}

function tlDuplicateTour(id) {
  const t = tlGetTours().find(t => t.id === id);
  if (!t) return null;
  return tlSaveTour(t.data, {
    artist: t.artist, name: t.name + ' (copy)', region: t.region,
    startDate: t.startDate, endDate: t.endDate, status: 'draft', notes: t.notes
  });
}

/* ====================================================
   VENUE INTELLIGENCE MEMORY
   Accumulates venue knowledge per city across sessions
   ==================================================== */

function tlGetVenueBank() {
  try { return JSON.parse(localStorage.getItem(TL_VENUES_KEY) || '{}'); } catch { return {}; }
}

function tlSaveVenueBank(bank) {
  localStorage.setItem(TL_VENUES_KEY, JSON.stringify(bank));
}

function tlSaveVenues(city, country, venues) {
  const bank = tlGetVenueBank();
  const key = `${city.toLowerCase().trim()}|${(country||'').toLowerCase().trim()}`;
  bank[key] = { city, country, venues, updatedAt: new Date().toISOString() };
  tlSaveVenueBank(bank);
}

function tlGetVenueBankForCity(city, country) {
  const bank = tlGetVenueBank();
  const key = `${city.toLowerCase().trim()}|${(country||'').toLowerCase().trim()}`;
  return bank[key] || null;
}

function tlGetVenueBankCities() {
  const bank = tlGetVenueBank();
  return Object.values(bank).map(v => ({ city: v.city, country: v.country, count: v.venues?.length || 0, updatedAt: v.updatedAt }));
}

/* ====================================================
   MARKET PERFORMANCE TRACKER
   Records actual vs projected per artist per city
   ==================================================== */

function tlGetMarkets() {
  try { return JSON.parse(localStorage.getItem(TL_MARKETS_KEY) || '[]'); } catch { return []; }
}

function tlSaveMarkets(m) {
  localStorage.setItem(TL_MARKETS_KEY, JSON.stringify(m));
}

function tlLogPerformance(entry) {
  // entry: { artist, city, country, date, venue, actualAttendance, projectedAttendance, guarantee, actualPayout, notes }
  const markets = tlGetMarkets();
  markets.unshift({ id: 'perf_' + Date.now(), loggedAt: new Date().toISOString(), ...entry });
  tlSaveMarkets(markets);
}

function tlGetArtistMarketHistory(artist) {
  return tlGetMarkets().filter(m => m.artist === artist);
}

function tlGetMarketSummary(artist) {
  const history = tlGetArtistMarketHistory(artist);
  const byCityMap = {};
  history.forEach(m => {
    const key = m.city + '|' + (m.country || '');
    if (!byCityMap[key]) byCityMap[key] = [];
    byCityMap[key].push(m);
  });
  return Object.entries(byCityMap).map(([key, visits]) => {
    const [city, country] = key.split('|');
    const avgAtt = Math.round(visits.reduce((s, v) => s + (v.actualAttendance || 0), 0) / visits.length);
    const avgPay = Math.round(visits.reduce((s, v) => s + (v.actualPayout || 0), 0) / visits.length);
    return { city, country, visits: visits.length, avgAttendance: avgAtt, avgPayout: avgPay, lastVisit: visits[0].date };
  }).sort((a, b) => b.avgAttendance - a.avgAttendance);
}

/* ====================================================
   REFERENCE MODE — load past tour as ghost layer
   ==================================================== */

let tlReferenceTour = null;

function tlSetReferenceTour(tourId) {
  if (!tourId) { tlReferenceTour = null; updateReferenceUI(); return; }
  const t = tlGetTours().find(t => t.id === tourId);
  tlReferenceTour = t || null;
  updateReferenceUI();
}

function tlGetReferenceTour() { return tlReferenceTour; }

function updateReferenceUI() {
  const badge = document.getElementById('tp-ref-badge');
  const sel = document.getElementById('tp-reference-tour');
  if (badge) {
    if (tlReferenceTour) {
      badge.style.display = 'inline-flex';
      badge.querySelector('.ref-name').textContent = tlReferenceTour.name.slice(0, 28);
    } else {
      badge.style.display = 'none';
    }
  }
}

/* ====================================================
   EMAIL GENERATOR
   ==================================================== */

async function generatePitchEmail(emailType, data) {
  const res = await fetch('/.netlify/functions/email-generator', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ emailType, data })
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error || 'Email generation failed');
  return json.data;
}

/* ====================================================
   UI — TOUR LIBRARY VIEW
   ==================================================== */

function renderTourLibrary() {
  const tours = tlGetTours();
  const artist = document.getElementById('tl-artist-filter')?.value || '';
  const status = document.getElementById('tl-status-filter')?.value || '';
  const filtered = tours.filter(t => {
    if (artist && t.artist !== artist) return false;
    if (status && t.status !== status) return false;
    return true;
  });

  const grid = document.getElementById('tl-tour-grid');
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="tl-empty">No saved tours yet. Generate a tour in the Build tab, then save it.<br><span style="color:#333;font-size:0.65rem;">Your tour history will appear here for reference, comparison, and email outreach.</span></div>`;
    return;
  }

  const statusColors = { draft: '#555', active: '#c8a96e', completed: '#70d090', archived: '#333' };

  grid.innerHTML = filtered.map(t => `
    <div class="tl-tour-card" data-id="${t.id}">
      <div class="tl-card-header">
        <div class="tl-card-artist">${t.artist}</div>
        <div class="tl-card-status" style="color:${statusColors[t.status] || '#555'}">${t.status}</div>
      </div>
      <div class="tl-card-name">${t.name}</div>
      <div class="tl-card-meta">
        ${t.region ? `<span class="tl-meta-tag">${t.region}</span>` : ''}
        ${t.startDate ? `<span class="tl-meta-tag">${t.startDate}${t.endDate ? ' → ' + t.endDate : ''}</span>` : ''}
        ${t.data?.total_shows ? `<span class="tl-meta-tag">${t.data.total_shows} shows</span>` : ''}
      </div>
      ${t.notes ? `<div class="tl-card-notes">${t.notes}</div>` : ''}
      <div class="tl-card-actions">
        <button class="tl-btn tl-btn-sm" onclick="tlOpenTour('${t.id}')">Open</button>
        <button class="tl-btn tl-btn-sm" onclick="tlSetReferenceTour('${t.id}');showView('tour')">Use as Reference</button>
        <button class="tl-btn tl-btn-sm" onclick="tlShowStatusMenu('${t.id}', this)">Status ▾</button>
        <button class="tl-btn tl-btn-sm tl-btn-ghost" onclick="tlDuplicateTour('${t.id}');renderTourLibrary()">Duplicate</button>
        <button class="tl-btn tl-btn-sm tl-btn-danger" onclick="tlConfirmDelete('${t.id}')">Delete</button>
      </div>
      <div class="tl-saved-at">Saved ${tlRelativeTime(t.savedAt)}</div>
    </div>
  `).join('');

  // Update reference selector
  populateReferenceTourSelect();
}

function populateReferenceTourSelect() {
  const sel = document.getElementById('tp-reference-tour');
  if (!sel) return;
  const tours = tlGetTours().filter(t => t.status !== 'archived');
  sel.innerHTML = '<option value="">No reference</option>' + tours.map(t => `<option value="${t.id}">${t.artist} — ${t.name} (${t.startDate || 'no date'})</option>`).join('');
}

function tlOpenTour(id) {
  const t = tlGetTours().find(t => t.id === id);
  if (!t) return;
  // Restore tour into the planner
  if (tourState) {
    tourState.currentTour = t.data;
    tourState.chatContext = `Loaded tour: "${t.name}" for ${t.artist}.`;
  }
  if (typeof renderTourResults === 'function' && t.data) renderTourResults(t.data);
  showView('tour');
  setTimeout(() => {
    if (typeof TourMap !== 'undefined') TourMap.renderLegs(t.data?.legs || []);
    if (typeof addChatMsg === 'function') addChatMsg('ai', `Loaded "${t.name}" for ${t.artist}. ${t.data?.total_shows || 0} shows, ${t.data?.total_days || 0} days.`);
  }, 300);
}

function tlShowStatusMenu(id, btn) {
  const existing = document.querySelector('.tl-status-popup');
  if (existing) existing.remove();
  const popup = document.createElement('div');
  popup.className = 'tl-status-popup';
  popup.innerHTML = ['draft','active','completed','archived'].map(s =>
    `<div class="tl-status-opt" onclick="tlUpdateTour('${id}',{status:'${s}'});renderTourLibrary();this.closest('.tl-status-popup').remove()">${s}</div>`
  ).join('');
  btn.parentNode.insertBefore(popup, btn.nextSibling);
  setTimeout(() => document.addEventListener('click', () => popup.remove(), { once: true }), 50);
}

function tlConfirmDelete(id) {
  const t = tlGetTours().find(t => t.id === id);
  if (!t) return;
  if (confirm(`Delete "${t.name}"? This cannot be undone.`)) {
    tlDeleteTour(id);
    renderTourLibrary();
  }
}

function tlRelativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 2) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  const d = Math.floor(h / 24);
  return d + 'd ago';
}

/* ====================================================
   UI — VENUE BANK VIEW
   ==================================================== */

function renderVenueBank() {
  const cities = tlGetVenueBankCities();
  const list = document.getElementById('tl-venue-bank-list');
  if (!list) return;

  if (!cities.length) {
    list.innerHTML = `<div class="tl-empty">No venues saved yet. Every time you use "Find Venues," the results are automatically saved here for future reference.</div>`;
    return;
  }

  list.innerHTML = cities.map(c => `
    <div class="tl-venue-city-row" onclick="tlExpandVenueCity('${c.city}', '${c.country || ''}', this)">
      <div style="flex:1;">
        <span class="tl-city-name">${c.city}${c.country ? `, ${c.country}` : ''}</span>
        <span class="tl-city-count">${c.count} venue${c.count !== 1 ? 's' : ''}</span>
      </div>
      <div class="tl-city-updated">Updated ${tlRelativeTime(c.updatedAt)}</div>
      <div class="tl-expand-icon">▸</div>
    </div>
    <div class="tl-venue-city-detail" id="vb-${c.city.replace(/\s/g,'_')}" style="display:none;"></div>
  `).join('');
}

function tlExpandVenueCity(city, country, rowEl) {
  const detailEl = rowEl.nextElementSibling;
  const icon = rowEl.querySelector('.tl-expand-icon');
  if (detailEl.style.display !== 'none') {
    detailEl.style.display = 'none';
    if (icon) icon.textContent = '▸';
    return;
  }
  const data = tlGetVenueBankForCity(city, country);
  if (!data?.venues?.length) { detailEl.innerHTML = '<div style="padding:0.5rem;color:#444;font-size:0.7rem;">No venue data.</div>'; }
  else {
    detailEl.innerHTML = data.venues.map(v => `
      <div style="padding:0.6rem 0.8rem;border-bottom:1px solid #111;background:#080808;">
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:0.2rem;">
          <span style="font-size:0.78rem;color:#ccc;font-weight:600;">${v.name}</span>
          ${v.tier === 'primary' ? '<span style="font-size:0.48rem;background:#c8a96e;color:#000;padding:1px 5px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;">primary</span>' : ''}
        </div>
        ${v.capacity ? `<span style="font-size:0.6rem;color:#444;">${v.capacity} cap · </span>` : ''}
        ${v.deal_type_typical ? `<span style="font-size:0.6rem;color:#444;">${v.deal_type_typical} · </span>` : ''}
        ${v.type ? `<span style="font-size:0.6rem;color:#444;">${v.type}</span>` : ''}
        ${v.notes ? `<div style="font-size:0.65rem;color:#555;margin-top:3px;line-height:1.4;">${v.notes}</div>` : ''}
        ${v.booking_contact_tip ? `<div style="font-size:0.62rem;color:#c8a96e;margin-top:2px;">→ ${v.booking_contact_tip}</div>` : ''}
      </div>
    `).join('');
  }
  detailEl.style.display = 'block';
  if (icon) icon.textContent = '▾';
}

/* ====================================================
   UI — MARKET PERFORMANCE
   ==================================================== */

function renderMarketTracker() {
  const artist = document.getElementById('tl-perf-artist')?.value;
  const list = document.getElementById('tl-perf-list');
  if (!list) return;

  if (!artist) { list.innerHTML = `<div class="tl-empty">Select an artist to view market history.</div>`; return; }

  const summary = tlGetMarketSummary(artist);
  if (!summary.length) {
    list.innerHTML = `<div class="tl-empty">No performance data for ${artist} yet.<br><span style="color:#333;font-size:0.65rem;">Log show results after each tour to build market intelligence.</span></div>`;
    return;
  }

  list.innerHTML = summary.map(m => `
    <div class="tl-perf-row">
      <div class="tl-perf-city">${m.city}${m.country ? `, ${m.country}` : ''}</div>
      <div class="tl-perf-stats">
        <div class="tl-perf-stat"><span class="n">${m.avgAttendance || '—'}</span><span class="l">avg heads</span></div>
        <div class="tl-perf-stat"><span class="n">$${(m.avgPayout || 0).toLocaleString()}</span><span class="l">avg payout</span></div>
        <div class="tl-perf-stat"><span class="n">${m.visits}</span><span class="l">visit${m.visits !== 1 ? 's' : ''}</span></div>
      </div>
    </div>
  `).join('');
}

function tlShowLogPerformanceModal() {
  const modal = document.getElementById('tl-log-modal');
  if (!modal) return;
  // Populate artist select
  const sel = document.getElementById('tl-log-artist');
  if (sel && getArtists) {
    sel.innerHTML = '<option value="">Select artist...</option>' + getArtists().map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  }
  modal.style.display = 'flex';
}

function tlSavePerformanceLog() {
  const artist = document.getElementById('tl-log-artist')?.value;
  const city = document.getElementById('tl-log-city')?.value.trim();
  const country = document.getElementById('tl-log-country')?.value.trim();
  const date = document.getElementById('tl-log-date')?.value;
  const venue = document.getElementById('tl-log-venue')?.value.trim();
  const attendance = parseInt(document.getElementById('tl-log-att')?.value) || 0;
  const projAttendance = parseInt(document.getElementById('tl-log-proj-att')?.value) || 0;
  const guarantee = parseInt(document.getElementById('tl-log-guar')?.value) || 0;
  const actualPayout = parseInt(document.getElementById('tl-log-payout')?.value) || 0;
  const notes = document.getElementById('tl-log-notes')?.value.trim();

  if (!artist || !city) { alert('Artist and city are required.'); return; }

  tlLogPerformance({ artist, city, country, date, venue, actualAttendance: attendance, projectedAttendance: projAttendance, guarantee, actualPayout, notes });

  document.getElementById('tl-log-modal').style.display = 'none';
  renderMarketTracker();
}

/* ====================================================
   UI — EMAIL GENERATOR
   ==================================================== */

function initEmailGenerator() {
  // Populate artist dropdowns
  const artists = getArtists ? getArtists() : [];
  ['tl-email-artist', 'tl-ctr-artist', 'tl-adv-artist', 'tl-fu-artist'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">Select artist...</option>' + artists.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  });
}

async function onGenerateEmail(emailType) {
  const btn = document.getElementById(`tl-email-gen-${emailType}`);
  if (btn) { btn.disabled = true; btn.textContent = 'Generating...'; }

  let data = {};
  try {
    if (emailType === 'cold_pitch') {
      const artist = document.getElementById('tl-email-artist')?.value;
      const venueName = document.getElementById('tl-email-venue')?.value.trim();
      const venueCity = document.getElementById('tl-email-city')?.value.trim();
      const targetDates = document.getElementById('tl-email-dates')?.value.trim();
      const dealType = document.getElementById('tl-email-deal')?.value;
      const tourContext = document.getElementById('tl-email-context')?.value.trim();
      const pastPerformance = document.getElementById('tl-email-past')?.value.trim();

      // Pull artist data for bio/links
      const artists = getArtists ? getArtists() : [];
      const artistData = artists.find(a => a.name === artist) || {};
      const artistGenre = artistData.genres?.join(', ') || 'darkwave/EBM';
      const artistBio = artistData.bio?.slice(0, 200) || '';
      const artistLinks = artistData.spotify || artistData.bandcamp || 'melankoliaagency.com';

      if (!artist || !venueName || !venueCity) { alert('Artist, venue name, and city are required.'); return; }
      data = { artist, artistGenre, artistBio, artistLinks, venueName, venueCity, targetDates, dealType, tourContext, pastPerformance };

    } else if (emailType === 'follow_up') {
      data = {
        artist: document.getElementById('tl-fu-artist')?.value,
        venueName: document.getElementById('tl-fu-venue')?.value.trim(),
        venueCity: document.getElementById('tl-fu-city')?.value.trim(),
        originalDate: document.getElementById('tl-fu-original-date')?.value,
        daysSince: parseInt(document.getElementById('tl-fu-days')?.value) || 10,
        dealType: document.getElementById('tl-fu-deal')?.value
      };
    } else if (emailType === 'counter_offer') {
      data = {
        artist: document.getElementById('tl-ctr-artist')?.value,
        venueName: document.getElementById('tl-ctr-venue')?.value.trim(),
        venueCity: document.getElementById('tl-ctr-city')?.value.trim(),
        theirOffer: document.getElementById('tl-ctr-their-offer')?.value.trim(),
        ourCounter: document.getElementById('tl-ctr-counter')?.value.trim(),
        dealType: document.getElementById('tl-ctr-deal')?.value,
        reasoning: document.getElementById('tl-ctr-reasoning')?.value.trim()
      };
    } else if (emailType === 'advance') {
      data = {
        artist: document.getElementById('tl-adv-artist')?.value,
        venueName: document.getElementById('tl-adv-venue')?.value.trim(),
        venueCity: document.getElementById('tl-adv-city')?.value.trim(),
        showDate: document.getElementById('tl-adv-date')?.value,
        loadIn: document.getElementById('tl-adv-loadin')?.value.trim(),
        soundcheck: document.getElementById('tl-adv-soundcheck')?.value.trim()
      };
    }

    const result = await generatePitchEmail(emailType, data);
    showEmailResult(result);

  } catch (err) {
    alert('Email generation failed: ' + err.message);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '◈ Generate Email'; }
  }
}

function showEmailResult(result) {
  const panel = document.getElementById('tl-email-result-panel');
  const subjectEl = document.getElementById('tl-email-result-subject');
  const previewEl = document.getElementById('tl-email-result-preview');
  const copyHtmlBtn = document.getElementById('tl-copy-html');
  const copyTextBtn = document.getElementById('tl-copy-text');

  if (!panel) return;
  panel.style.display = 'block';
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (subjectEl) subjectEl.textContent = result.subject;
  if (previewEl) {
    // Show live HTML preview
    previewEl.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'width:100%;height:420px;border:none;border-radius:2px;background:#fff;';
    iframe.onload = () => {
      const doc = iframe.contentDocument || iframe.contentWindow.document;
      doc.open(); doc.write(result.html); doc.close();
    };
    previewEl.appendChild(iframe);
    // Trigger load
    const blobUrl = URL.createObjectURL(new Blob([result.html], { type: 'text/html' }));
    iframe.src = blobUrl;
  }

  if (copyHtmlBtn) {
    copyHtmlBtn.onclick = () => {
      navigator.clipboard.writeText(result.html).then(() => {
        copyHtmlBtn.textContent = '✓ Copied HTML';
        setTimeout(() => { copyHtmlBtn.textContent = 'Copy HTML'; }, 2000);
      });
    };
  }
  if (copyTextBtn) {
    copyTextBtn.onclick = () => {
      navigator.clipboard.writeText(`Subject: ${result.subject}\n\n${result.body}`).then(() => {
        copyTextBtn.textContent = '✓ Copied';
        setTimeout(() => { copyTextBtn.textContent = 'Copy Plain Text'; }, 2000);
      });
    };
  }
}

/* ====================================================
   AUTO-SAVE HOOK — call this after generating a tour
   ==================================================== */

function tlAutoSavePrompt(tourData, meta) {
  const panel = document.getElementById('tp-save-panel');
  if (!panel) return;
  panel.style.display = 'flex';
  // Store pending save data
  panel.dataset.pending = JSON.stringify({ tourData, meta });
}

function tlConfirmSave() {
  const panel = document.getElementById('tp-save-panel');
  if (!panel) return;
  const { tourData, meta } = JSON.parse(panel.dataset.pending || '{}');
  const name = document.getElementById('tp-save-name')?.value.trim() || meta?.name || 'Saved Tour';
  const notes = document.getElementById('tp-save-notes')?.value.trim() || '';
  const id = tlSaveTour(tourData, { ...meta, name, notes });
  panel.style.display = 'none';
  showToast(`Tour saved: "${name}"`);
  populateReferenceTourSelect();
  return id;
}

function tlCancelSave() {
  const panel = document.getElementById('tp-save-panel');
  if (panel) panel.style.display = 'none';
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'tl-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2500);
}

/* ====================================================
   AUTO-SAVE venues when they're fetched
   ==================================================== */
// Hooked into tour-planner.js — call this after onFindVenues resolves
function tlAutoSaveVenues(city, country, venues) {
  if (venues?.length) tlSaveVenues(city, country, venues);
}

/* ====================================================
   INIT
   ==================================================== */

let _tourLibraryInited = false;

function initTourLibrary() {
  // Always refresh dynamic content

  const artists = getArtists ? getArtists() : [];

  ['tl-artist-filter', 'tl-perf-artist'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">All artists</option>' + artists.map(a => `<option value="${a.name}">${a.name}</option>`).join('');
  });

  if (!_tourLibraryInited) {
    _tourLibraryInited = true;
    document.getElementById('tl-artist-filter')?.addEventListener('change', renderTourLibrary);
    document.getElementById('tl-status-filter')?.addEventListener('change', renderTourLibrary);
    document.getElementById('tl-perf-artist')?.addEventListener('change', renderMarketTracker);
    document.getElementById('tp-reference-tour')?.addEventListener('change', e => tlSetReferenceTour(e.target.value));
  }

  // Email generator sub-tabs
  document.querySelectorAll('.email-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.email-tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.email-tab-panel').forEach(p => {
        p.classList.remove('active');
        p.style.display = 'none';
      });
      btn.classList.add('active');
      const panel = document.getElementById('etab-' + btn.dataset.etab);
      if (panel) { panel.classList.add('active'); panel.style.display = 'block'; }
    });
  });

  renderTourLibrary();
  renderVenueBank();
  initEmailGenerator();
}
