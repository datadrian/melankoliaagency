/* ================================================
   MELANKOLIA ADMIN — JavaScript
   All data stored in localStorage (JSON)
   Reads artists from data.js MELANKOLIA_DATA
   ================================================ */

/* ---- NAVIGATION ---- */
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  const el = document.getElementById('view-' + name);
  if (el) el.classList.add('active');
  const link = document.querySelector(`.sidebar-link[data-view="${name}"]`);
  if (link) link.classList.add('active');
  if (name === 'artists')  renderArtistGrid();
  if (name === 'epk')      renderEPKList();
  if (name === 'videos')   renderVideoAdmin();
  if (name === 'bookings') renderBookings();
  if (name === 'dashboard') renderDashboard();
}

document.querySelectorAll('.sidebar-link[data-view]').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); showView(link.dataset.view); });
});

/* ---- DATA LAYER ---- */
// Artists are seeded from MELANKOLIA_DATA (data.js), then extended with admin edits
function getArtists() {
  const stored = localStorage.getItem('mk_artists');
  if (stored) return JSON.parse(stored);
  // Seed from global data — MELANKOLIA_DATA = { artists: [...] }
  const source = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists)
    ? MELANKOLIA_DATA.artists
    : (Array.isArray(MELANKOLIA_DATA) ? MELANKOLIA_DATA : []);
  if (source.length) {
    const seeded = source.map((a, i) => ({
      id: 'artist_' + i,
      name: a.name || '',
      slug: a.slug || a.name.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
      photo: a.image ? '/images/' + a.image : (a.photo || ''),
      banner: '',
      photos: [],
      genres: Array.isArray(a.genres) ? a.genres.join(', ') : (a.genres || ''),
      location: '',
      bio: a.bio || '',
      shortBio: '',
      quotes: '',
      notes: '',
      spotify:    a.social_links?.spotify    || a.links?.spotify    || '',
      soundcloud: a.social_links?.soundcloud || a.links?.soundcloud || '',
      bandcamp:   a.social_links?.bandcamp   || a.links?.bandcamp   || '',
      apple:      a.social_links?.apple      || '',
      instagram:  a.social_links?.instagram  || a.links?.instagram  || '',
      facebook:   a.social_links?.facebook   || a.links?.facebook   || '',
      youtube:    a.social_links?.youtube    || a.links?.youtube    || '',
      website:    a.social_links?.website    || a.links?.website    || '',
      bandsintown:'',
      ra: '',
      presskit: '',
      techRider: '',
      bookingEmail: '',
      status: 'active',
      featured: a.featured || false,
      epk: null,
    }));
    saveArtists(seeded);
    return seeded;
  }
  return [];
}

function saveArtists(artists) {
  localStorage.setItem('mk_artists', JSON.stringify(artists));
}

function getVideos() {
  const stored = localStorage.getItem('mk_videos');
  if (stored) return JSON.parse(stored);
  const source = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists)
    ? MELANKOLIA_DATA.artists
    : (Array.isArray(MELANKOLIA_DATA) ? MELANKOLIA_DATA : []);
  const vids = [];
  source.forEach((a, i) => {
    (a.music_videos || a.videos || []).forEach((v, j) => {
      if (!v) return;
      const url = typeof v === 'string' ? v : (v.url || '');
      if (!url) return;
      vids.push({ id:`vid_${i}_${j}`, artistId:'artist_'+i, artistName:a.name, url, title: v.title || a.name, category:'Music Video', featured:false });
    });
  });
  localStorage.setItem('mk_videos', JSON.stringify(vids));
  return vids;
}
function saveVideos(v) { localStorage.setItem('mk_videos', JSON.stringify(v)); }
function getBookings() { return JSON.parse(localStorage.getItem('mk_bookings')||'[]'); }
function saveBookings(b) { localStorage.setItem('mk_bookings', JSON.stringify(b)); }

/* ---- RESET / RESEED ---- */
function resetAndReseed() {
  if (!confirm('This will clear all local admin data and reload from the original artist data. Continue?')) return;
  localStorage.removeItem('mk_artists');
  localStorage.removeItem('mk_videos');
  location.reload();
}

/* ---- DASHBOARD ---- */
function renderDashboard() {
  const artists = getArtists();
  const videos  = getVideos();
  const bookings= getBookings();
  const epks    = artists.filter(a => a.epk).length;
  document.getElementById('statArtists').textContent  = artists.filter(a=>a.status==='active').length;
  document.getElementById('statVideos').textContent   = videos.length;
  document.getElementById('statEpks').textContent     = epks;
  document.getElementById('statBookings').textContent = bookings.length;
}

/* ---- ARTIST GRID ---- */
function renderArtistGrid(filter='') {
  const grid = document.getElementById('artistAdminGrid');
  const artists = getArtists().filter(a =>
    !filter || a.name.toLowerCase().includes(filter.toLowerCase())
  );
  if (!artists.length) { grid.innerHTML = '<div class="empty-state">No artists found.</div>'; return; }
  grid.innerHTML = artists.map(a => `
    <div class="artist-admin-card">
      <div class="artist-status-dot ${a.status !== 'active' ? 'inactive' : ''}"></div>
      ${a.photo
        ? `<img class="artist-admin-card-img" src="${a.photo}" alt="${a.name}" onerror="this.style.display='none'">`
        : `<div class="artist-admin-card-placeholder">${a.name[0]}</div>`
      }
      <div class="artist-admin-info">
        <div class="artist-admin-name">${a.name}</div>
        <div class="artist-admin-genre">${a.genres || '—'}</div>
        <div class="artist-admin-actions">
          <button class="btn-secondary btn-sm" onclick="editArtist('${a.id}')">Edit</button>
          <button class="btn-secondary btn-sm" onclick="openEPK('${a.id}')">EPK</button>
          <button class="btn-danger btn-sm" onclick="deleteArtist('${a.id}')">✕</button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('adminArtistSearch').addEventListener('input', e => {
  renderArtistGrid(e.target.value);
});

/* ---- ARTIST FORM ---- */
function showArtistForm(data={}) {
  document.getElementById('artistFormTitle').textContent = data.id ? 'Edit Artist' : 'Add Artist';
  document.getElementById('editArtistId').value = data.id || '';
  // Fill fields
  const fields = ['Name','Slug','Genres','Location','BookingEmail','Status','Featured',
    'Photo','Banner','Photos','Presskit','TechRider',
    'Spotify','Soundcloud','Bandcamp','Apple','Instagram','Facebook','Youtube','Website','Bandsintown','RA',
    'ShortBio','Bio','Quotes','Notes'];
  fields.forEach(f => {
    const el = document.getElementById('a'+f);
    if (el) el.value = data[f.charAt(0).toLowerCase()+f.slice(1)] || '';
  });
  // Preview images
  updateImgPreview('aPhoto', 'photoPreview');
  updateImgPreview('aBanner', 'bannerPreview');
  // Default tab
  switchTab('basic');
  document.getElementById('artistModal').classList.add('open');
}

function updateImgPreview(inputId, previewId) {
  const val = document.getElementById(inputId)?.value;
  const prev = document.getElementById(previewId);
  if (!prev) return;
  prev.innerHTML = val ? `<img src="${val}" alt="">` : '<span>No image</span>';
}
['aPhoto','aBanner'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    updateImgPreview('aPhoto','photoPreview');
    updateImgPreview('aBanner','bannerPreview');
  });
});

function closeArtistModal() {
  document.getElementById('artistModal').classList.remove('open');
}

function editArtist(id) {
  const a = getArtists().find(x => x.id === id);
  if (a) showArtistForm(a);
  showView('artists');
}

function deleteArtist(id) {
  if (!confirm('Delete this artist?')) return;
  saveArtists(getArtists().filter(a => a.id !== id));
  renderArtistGrid();
  renderDashboard();
}

document.getElementById('artistForm').addEventListener('submit', e => {
  e.preventDefault();
  const artists = getArtists();
  const id = document.getElementById('editArtistId').value;
  const data = {
    name: document.getElementById('aName').value,
    slug: document.getElementById('aSlug').value || document.getElementById('aName').value.toLowerCase().replace(/[^a-z0-9]+/g,'-'),
    genres: document.getElementById('aGenres').value,
    location: document.getElementById('aLocation').value,
    bookingEmail: document.getElementById('aBookingEmail').value,
    status: document.getElementById('aStatus').value,
    featured: document.getElementById('aFeatured').value === 'true',
    photo: document.getElementById('aPhoto').value,
    banner: document.getElementById('aBanner').value,
    photos: document.getElementById('aPhotos').value.split('\n').filter(Boolean),
    presskit: document.getElementById('aPresskit').value,
    techRider: document.getElementById('aTechRider').value,
    spotify: document.getElementById('aSpotify').value,
    soundcloud: document.getElementById('aSoundcloud').value,
    bandcamp: document.getElementById('aBandcamp').value,
    apple: document.getElementById('aApple').value,
    instagram: document.getElementById('aInstagram').value,
    facebook: document.getElementById('aFacebook').value,
    youtube: document.getElementById('aYoutube').value,
    website: document.getElementById('aWebsite').value,
    bandsintown: document.getElementById('aBandsintown').value,
    ra: document.getElementById('aRA').value,
    shortBio: document.getElementById('aShortBio').value,
    bio: document.getElementById('aBio').value,
    quotes: document.getElementById('aQuotes').value,
    notes: document.getElementById('aNotes').value,
  };

  if (id) {
    const idx = artists.findIndex(a => a.id === id);
    if (idx > -1) artists[idx] = { ...artists[idx], ...data };
  } else {
    data.id = 'artist_' + Date.now();
    data.epk = null;
    artists.push(data);
  }

  saveArtists(artists);
  closeArtistModal();
  renderArtistGrid();
  renderDashboard();
});

/* ---- TABS ---- */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab===name));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.toggle('active', c.dataset.tab===name));
}
document.querySelectorAll('.tab-btn').forEach(b => {
  b.addEventListener('click', () => switchTab(b.dataset.tab));
});

/* ---- EPK BUILDER ---- */
function renderEPKList() {
  const list = document.getElementById('epkArtistList');
  const artists = getArtists().filter(a => a.status === 'active');
  list.innerHTML = artists.map(a => `
    <div class="epk-artist-item ${a.epk ? 'has-epk' : ''}" onclick="openEPKEditor('${a.id}')">
      ${a.photo ? `<img class="epk-artist-avatar" src="${a.photo}" alt="${a.name}" onerror="this.style.display='none'">` : '<div class="epk-artist-avatar"></div>'}
      <span>${a.name}</span>
      ${a.epk ? '<span class="epk-badge">EPK</span>' : ''}
    </div>
  `).join('');
}

function openEPK(artistId) {
  showView('epk');
  openEPKEditor(artistId);
}

function openEPKEditor(artistId) {
  const a = getArtists().find(x => x.id === artistId);
  if (!a) return;

  document.querySelectorAll('.epk-artist-item').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.epk-artist-item').forEach(el => {
    if (el.onclick.toString().includes(artistId)) el.classList.add('active');
  });

  const epk = a.epk || {
    heroStyle: 'fullBleed',
    accentColor: '#c8a96e',
    showSocials: true,
    showSpotify: true,
    showVideos: true,
    showTechRider: true,
    showQuotes: true,
    showGigCalendar: true,
    customIntro: '',
    embedGigwell: '',
    published: false,
  };

  const editor = document.getElementById('epkEditor');
  const epkUrl = `/epk/${a.slug || a.id}`;

  editor.innerHTML = `
    <div class="epk-editor-inner">
      <div class="epk-preview-btn">
        <div class="epk-url-display">${window.location.origin}${epkUrl}</div>
        <button class="btn-secondary" onclick="window.open('${epkUrl}','_blank')">Preview EPK →</button>
        <button class="btn-primary" onclick="saveAndPublishEPK('${a.id}')">Save & Publish</button>
      </div>

      <div class="epk-section">
        <div class="epk-section-header">
          <span class="epk-section-title">Hero / Header</span>
        </div>
        <div class="epk-section-body">
          <div class="form-row">
            <div class="form-group">
              <label>Hero Style</label>
              <select id="epkHeroStyle" class="form-input">
                <option value="fullBleed" ${epk.heroStyle==='fullBleed'?'selected':''}>Full Bleed Photo</option>
                <option value="split" ${epk.heroStyle==='split'?'selected':''}>Split (photo + bio)</option>
                <option value="cinematic" ${epk.heroStyle==='cinematic'?'selected':''}>Cinematic Dark</option>
              </select>
            </div>
            <div class="form-group">
              <label>Accent Colour</label>
              <input type="color" id="epkAccentColor" class="form-input" value="${epk.accentColor}" style="height:38px;padding:2px">
            </div>
          </div>
          <div class="form-group">
            <label>Custom Intro (overrides short bio on EPK)</label>
            <textarea id="epkCustomIntro" class="form-input form-textarea" rows="3" placeholder="For use on EPK only...">${epk.customIntro||a.shortBio||''}</textarea>
          </div>
        </div>
      </div>

      <div class="epk-section">
        <div class="epk-section-header">
          <span class="epk-section-title">Content Sections</span>
        </div>
        <div class="epk-section-body">
          ${epkToggle('epkShowSocials', 'Show Social Media Links & Stats', epk.showSocials)}
          ${epkToggle('epkShowSpotify', 'Embed Spotify Player', epk.showSpotify)}
          ${epkToggle('epkShowVideos', 'Show Video Gallery', epk.showVideos)}
          ${epkToggle('epkShowQuotes', 'Show Press Quotes', epk.showQuotes)}
          ${epkToggle('epkShowTechRider', 'Show / Link Tech Rider', epk.showTechRider)}
          ${epkToggle('epkShowGigCalendar', 'Show Gig Calendar (Bandsintown)', epk.showGigCalendar)}
        </div>
      </div>

      <div class="epk-section">
        <div class="epk-section-header">
          <span class="epk-section-title">Gigwell Integration</span>
        </div>
        <div class="epk-section-body">
          <div class="form-group">
            <label>Gigwell EPK Embed Code (paste full iframe code from Gigwell)</label>
            <textarea id="epkGigwellEmbed" class="form-input form-textarea" rows="4" placeholder="&lt;iframe src=&quot;https://...gigwell.com/epk/...&quot;&gt;&lt;/iframe&gt;">${epk.embedGigwell||''}</textarea>
          </div>
          <div class="form-group">
            <label>Gigwell Booking Form URL (auto-embeds in EPK)</label>
            <input type="url" id="epkGigwellBooking" class="form-input" value="${epk.gigwellBooking||''}" placeholder="https://...gigwell.com/booking/...">
          </div>
          <p style="font-size:0.7rem;color:var(--muted);margin-top:0.5rem">
            In Gigwell: Artists → [Artist] → Share EPK → Copy Embed Code. Paste above to replace the built-in EPK with your Gigwell-managed version.
          </p>
        </div>
      </div>

      <div class="epk-section">
        <div class="epk-section-header">
          <span class="epk-section-title">Downloads & Rider</span>
        </div>
        <div class="epk-section-body">
          <div class="form-row">
            <div class="form-group">
              <label>Tech Rider URL (PDF/link)</label>
              <input type="url" id="epkTechRider" class="form-input" value="${a.techRider||''}" placeholder="https://...">
            </div>
            <div class="form-group">
              <label>Press Kit / Photo Pack URL</label>
              <input type="url" id="epkPresskit" class="form-input" value="${a.presskit||''}" placeholder="https://...">
            </div>
          </div>
          <div class="form-group">
            <label>Stage Plot / Hospitality Rider URL</label>
            <input type="url" id="epkStagePlot" class="form-input" value="${epk.stagePlot||''}" placeholder="https://...">
          </div>
        </div>
      </div>

      <div class="epk-section">
        <div class="epk-section-header">
          <span class="epk-section-title">Current Info — pulls from Artist record</span>
        </div>
        <div class="epk-section-body" style="display:grid;grid-template-columns:1fr 1fr;gap:1rem">
          <div>
            <div style="font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Photo</div>
            <div style="height:80px;overflow:hidden;background:#111">${a.photo?`<img src="${a.photo}" style="width:100%;height:100%;object-fit:cover">`:'—'}</div>
          </div>
          <div>
            <div style="font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin-bottom:.3rem">Spotify</div>
            <div style="font-size:.75rem;color:var(--off)">${a.spotify||'Not set'}</div>
            <div style="font-size:.62rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:.6rem 0 .3rem">Instagram</div>
            <div style="font-size:.75rem;color:var(--off)">${a.instagram||'Not set'}</div>
          </div>
        </div>
        <button class="btn-secondary btn-sm" style="margin-top:.75rem" onclick="editArtist('${a.id}')">Edit Artist Record →</button>
      </div>
    </div>
  `;
}

function epkToggle(id, label, value) {
  return `
    <div class="form-group" style="flex-direction:row;align-items:center;justify-content:space-between;margin-bottom:.6rem">
      <label style="text-transform:none;letter-spacing:0;font-size:.8rem;color:var(--off)">${label}</label>
      <select id="${id}" class="form-input" style="width:80px">
        <option value="true" ${value?'selected':''}>On</option>
        <option value="false" ${!value?'selected':''}>Off</option>
      </select>
    </div>
  `;
}

function saveAndPublishEPK(artistId) {
  const artists = getArtists();
  const idx = artists.findIndex(a => a.id === artistId);
  if (idx === -1) return;

  const epk = {
    heroStyle: document.getElementById('epkHeroStyle')?.value || 'fullBleed',
    accentColor: document.getElementById('epkAccentColor')?.value || '#c8a96e',
    customIntro: document.getElementById('epkCustomIntro')?.value || '',
    showSocials: document.getElementById('epkShowSocials')?.value === 'true',
    showSpotify: document.getElementById('epkShowSpotify')?.value === 'true',
    showVideos: document.getElementById('epkShowVideos')?.value === 'true',
    showQuotes: document.getElementById('epkShowQuotes')?.value === 'true',
    showTechRider: document.getElementById('epkShowTechRider')?.value === 'true',
    showGigCalendar: document.getElementById('epkShowGigCalendar')?.value === 'true',
    embedGigwell: document.getElementById('epkGigwellEmbed')?.value || '',
    gigwellBooking: document.getElementById('epkGigwellBooking')?.value || '',
    stagePlot: document.getElementById('epkStagePlot')?.value || '',
    published: true,
    publishedAt: new Date().toISOString(),
  };

  // Also update rider/presskit on artist record
  artists[idx].techRider = document.getElementById('epkTechRider')?.value || artists[idx].techRider;
  artists[idx].presskit  = document.getElementById('epkPresskit')?.value  || artists[idx].presskit;
  artists[idx].epk = epk;
  saveArtists(artists);
  renderEPKList();
  renderDashboard();
  alert(`EPK saved for ${artists[idx].name}!`);
}

/* ---- VIDEOS ---- */
function showVideoForm(data={}) {
  document.getElementById('editVideoId').value = data.id || '';
  document.getElementById('vUrl').value = data.url || '';
  document.getElementById('vTitle').value = data.title || '';
  document.getElementById('vCategory').value = data.category || 'Music Video';
  document.getElementById('vFeatured').value = data.featured ? 'true' : 'false';
  // Populate artist select
  const sel = document.getElementById('vArtist');
  const artists = getArtists();
  sel.innerHTML = '<option value="">Select artist...</option>' +
    artists.map(a => `<option value="${a.id}" ${data.artistId===a.id?'selected':''}>${a.name}</option>`).join('');
  document.getElementById('videoModal').classList.add('open');
}

document.getElementById('videoForm').addEventListener('submit', e => {
  e.preventDefault();
  const videos = getVideos();
  const id = document.getElementById('editVideoId').value;
  const artistId = document.getElementById('vArtist').value;
  const artist = getArtists().find(a => a.id === artistId);
  const data = {
    url: document.getElementById('vUrl').value,
    title: document.getElementById('vTitle').value,
    category: document.getElementById('vCategory').value,
    featured: document.getElementById('vFeatured').value === 'true',
    artistId, artistName: artist?.name || '',
  };
  if (id) {
    const idx = videos.findIndex(v => v.id === id);
    if (idx > -1) videos[idx] = { ...videos[idx], ...data };
  } else {
    data.id = 'vid_' + Date.now();
    videos.push(data);
  }
  saveVideos(videos);
  document.getElementById('videoModal').classList.remove('open');
  renderVideoAdmin();
});

function getYTId(url) {
  const m = url.match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

function renderVideoAdmin() {
  const list = document.getElementById('videoAdminList');
  const videos = getVideos();
  if (!videos.length) { list.innerHTML = '<div class="empty-state">No videos yet. Click + Add Video.</div>'; return; }
  list.innerHTML = videos.map(v => {
    const ytId = getYTId(v.url);
    const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : '';
    return `
      <div class="video-admin-row">
        ${thumb ? `<img class="video-admin-thumb" src="${thumb}" alt="">` : '<div class="video-admin-thumb"></div>'}
        <div>
          <div class="video-admin-title">${v.title || '—'}</div>
          <div class="video-admin-artist">${v.artistName || '—'} · ${v.category}</div>
        </div>
        <div style="font-size:.68rem;color:var(--muted)">${v.featured?'★ Featured':''}</div>
        <div style="display:flex;gap:.4rem">
          <button class="btn-secondary btn-sm" onclick='showVideoForm(${JSON.stringify(v)})'>Edit</button>
          <button class="btn-danger btn-sm" onclick="deleteVideo('${v.id}')">✕</button>
        </div>
      </div>
    `;
  }).join('');
}

function deleteVideo(id) {
  if (!confirm('Delete?')) return;
  saveVideos(getVideos().filter(v => v.id !== id));
  renderVideoAdmin();
}

/* ---- BOOKINGS ---- */
function renderBookings() {
  const list = document.getElementById('bookingsList');
  const bookings = getBookings();
  if (!bookings.length) {
    list.innerHTML = '<div class="empty-state">No booking requests yet. They will appear here when submitted via the website form.</div>';
    return;
  }
  list.innerHTML = bookings.map(b => `
    <div class="booking-row">
      <div>
        <div class="booking-name">${b.name}</div>
        <div class="booking-detail">${b.date || '—'}</div>
      </div>
      <div>
        <div style="font-size:.8rem;color:var(--off)">${b.artist || 'Any'} · ${b.venue||'—'}</div>
        <div class="booking-detail">${b.email}</div>
      </div>
      <div style="font-size:.72rem;color:var(--muted)">${b.type||'Booking'}</div>
      <span class="booking-status ${b.status==='new'?'new':''}">${b.status||'New'}</span>
      <button class="btn-danger btn-sm" onclick="deleteBooking('${b.id}')">✕</button>
    </div>
  `).join('');
}

function deleteBooking(id) {
  if (!confirm('Remove?')) return;
  saveBookings(getBookings().filter(b => b.id !== id));
  renderBookings();
}

/* ---- INIT ---- */
showView('dashboard');
