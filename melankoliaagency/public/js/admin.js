/* ================================================
   MELANKOLIA AGENCY — ADMIN JS
   Password-protected CMS for editing artists/videos
   NOTE: For a production site, connect to Netlify CMS
   or a proper backend. This version uses localStorage
   for demo/staging with data.js as source of truth.
   ================================================ */

(function() {
  const ADMIN_PASS = 'melankolia2025'; // Change this in production!
  const STORAGE_KEY = 'melankolia_data';

  // ---- Load data from localStorage or data.js ----
  let appData = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null') || 
    (typeof MELANKOLIA_DATA !== 'undefined' ? JSON.parse(JSON.stringify(MELANKOLIA_DATA)) : { artists: [], settings: {} });

  function saveData() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appData));
  }

  // ---- LOGIN ----
  const loginEl = document.getElementById('adminLogin');
  const panelEl = document.getElementById('adminPanel');
  const loginForm = document.getElementById('loginForm');
  const loginError = document.getElementById('loginError');

  function isLoggedIn() { return sessionStorage.getItem('ma_auth') === '1'; }
  function doLogin() {
    sessionStorage.setItem('ma_auth', '1');
    loginEl.style.display = 'none';
    panelEl.style.display = 'flex';
    initPanel();
  }

  if (isLoggedIn()) {
    loginEl.style.display = 'none';
    panelEl.style.display = 'flex';
    initPanel();
  }

  loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const pw = document.getElementById('adminPassword').value;
    if (pw === ADMIN_PASS) {
      loginError.style.display = 'none';
      doLogin();
    } else {
      loginError.style.display = 'block';
      document.getElementById('adminPassword').value = '';
    }
  });

  // ---- TABS ----
  function initPanel() {
    document.querySelectorAll('.admin-nav-item').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.admin-nav-item').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
      });
    });

    renderArtistList();
    renderVideoList();
    populateVideoArtistSelect();
    initArtistModal();
    initVideoModal();
    initSettings();
  }

  // ---- ARTISTS ----
  function renderArtistList() {
    const list = document.getElementById('adminArtistList');
    list.innerHTML = '';
    appData.artists.forEach((artist, idx) => {
      const row = document.createElement('div');
      row.className = 'admin-artist-row';
      row.innerHTML = `
        ${artist.image
          ? `<img class="admin-artist-thumb" src="/images/${artist.image}" alt="">`
          : `<div class="admin-artist-thumb" style="background:#181818;display:flex;align-items:center;justify-content:center;font-size:1.2rem;color:#333">${artist.name.charAt(0)}</div>`
        }
        <div style="flex:1">
          <div class="admin-artist-name">${artist.name}</div>
          <div class="admin-artist-slug">/${artist.slug}</div>
        </div>
        <div class="admin-row-actions">
          <button class="admin-btn admin-btn-sm admin-btn-secondary" data-idx="${idx}" data-action="edit">Edit</button>
          <button class="admin-btn admin-btn-sm admin-btn-danger" data-idx="${idx}" data-action="delete">Delete</button>
        </div>
      `;
      list.appendChild(row);
    });

    list.querySelectorAll('[data-action="edit"]').forEach(btn => {
      btn.addEventListener('click', () => openArtistModal(parseInt(btn.dataset.idx)));
    });
    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this artist?')) {
          appData.artists.splice(parseInt(btn.dataset.idx), 1);
          saveData();
          renderArtistList();
        }
      });
    });
  }

  let editingArtistIdx = -1;

  function openArtistModal(idx) {
    editingArtistIdx = idx;
    const modal = document.getElementById('artistModal');
    const artist = idx >= 0 ? appData.artists[idx] : {};
    document.getElementById('artistModalTitle').textContent = idx >= 0 ? 'Edit Artist' : 'Add Artist';
    document.getElementById('editArtistName').value = artist.name || '';
    document.getElementById('editArtistSlug').value = artist.slug || '';
    document.getElementById('editArtistBio').value = artist.bio || '';
    document.getElementById('editArtistImage').value = artist.image || '';
    document.getElementById('editArtistWebsite').value = (artist.social_links || {}).website || '';
    document.getElementById('editArtistInstagram').value = (artist.social_links || {}).instagram || '';
    document.getElementById('editArtistFacebook').value = (artist.social_links || {}).facebook || '';
    document.getElementById('editArtistBandcamp').value = (artist.social_links || {}).bandcamp || '';
    document.getElementById('editArtistSpotify').value = (artist.social_links || {}).spotify || '';
    document.getElementById('editArtistTiktok').value = (artist.social_links || {}).tiktok || '';
    document.getElementById('editArtistYoutube').value = (artist.social_links || {}).youtube || '';
    document.getElementById('editArtistFeatured').checked = artist.featured || false;
    modal.style.display = 'flex';
  }

  function initArtistModal() {
    document.getElementById('addArtistBtn').addEventListener('click', () => openArtistModal(-1));
    document.getElementById('cancelArtistBtn').addEventListener('click', closeArtistModal);
    document.getElementById('artistModalBackdrop').addEventListener('click', closeArtistModal);

    document.getElementById('artistForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const artistData = {
        name: document.getElementById('editArtistName').value.trim(),
        slug: document.getElementById('editArtistSlug').value.trim().toLowerCase().replace(/\s+/g, '-'),
        bio: document.getElementById('editArtistBio').value.trim(),
        image: document.getElementById('editArtistImage').value.trim(),
        social_links: {
          website: document.getElementById('editArtistWebsite').value.trim() || undefined,
          instagram: document.getElementById('editArtistInstagram').value.trim() || undefined,
          facebook: document.getElementById('editArtistFacebook').value.trim() || undefined,
          bandcamp: document.getElementById('editArtistBandcamp').value.trim() || undefined,
          spotify: document.getElementById('editArtistSpotify').value.trim() || undefined,
          tiktok: document.getElementById('editArtistTiktok').value.trim() || undefined,
          youtube: document.getElementById('editArtistYoutube').value.trim() || undefined,
        },
        featured: document.getElementById('editArtistFeatured').checked,
        music_videos: editingArtistIdx >= 0 ? (appData.artists[editingArtistIdx].music_videos || []) : []
      };
      // Remove undefined social links
      Object.keys(artistData.social_links).forEach(k => {
        if (!artistData.social_links[k]) delete artistData.social_links[k];
      });

      if (editingArtistIdx >= 0) {
        appData.artists[editingArtistIdx] = artistData;
      } else {
        appData.artists.push(artistData);
        appData.artists.sort((a, b) => a.name.localeCompare(b.name));
      }
      saveData();
      closeArtistModal();
      renderArtistList();
      populateVideoArtistSelect();
    });
  }

  function closeArtistModal() {
    document.getElementById('artistModal').style.display = 'none';
  }

  // ---- VIDEOS ----
  function renderVideoList() {
    const list = document.getElementById('adminVideoList');
    list.innerHTML = '';
    let videoCount = 0;
    appData.artists.forEach((artist, artistIdx) => {
      (artist.music_videos || []).forEach((video, videoIdx) => {
        videoCount++;
        const ytId = extractYouTubeId(video.url);
        const card = document.createElement('div');
        card.className = 'admin-video-card';
        card.innerHTML = `
          <div class="admin-video-thumb">
            ${ytId ? `<img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="">` : ''}
          </div>
          <div class="admin-video-info">
            <p class="admin-video-title">${video.title}</p>
            <p class="admin-video-artist-name">${artist.name}</p>
          </div>
          <div class="admin-video-actions">
            <button class="admin-btn admin-btn-sm admin-btn-danger" data-aidx="${artistIdx}" data-vidx="${videoIdx}" data-action="del-video">Delete</button>
          </div>
        `;
        list.appendChild(card);
      });
    });

    if (!videoCount) {
      list.innerHTML = '<p style="color:#555;font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;padding:2rem 0">No videos yet. Click + Add Video to add a YouTube video.</p>';
    }

    list.querySelectorAll('[data-action="del-video"]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (confirm('Delete this video?')) {
          const aIdx = parseInt(btn.dataset.aidx);
          const vIdx = parseInt(btn.dataset.vidx);
          appData.artists[aIdx].music_videos.splice(vIdx, 1);
          saveData();
          renderVideoList();
        }
      });
    });
  }

  function initVideoModal() {
    document.getElementById('addVideoBtn').addEventListener('click', () => {
      document.getElementById('videoModal').style.display = 'flex';
      document.getElementById('videoForm').reset();
    });
    document.getElementById('cancelVideoBtn').addEventListener('click', closeVideoModal);
    document.getElementById('videoModalBackdrop').addEventListener('click', closeVideoModal);

    document.getElementById('videoForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const url = document.getElementById('editVideoUrl').value.trim();
      const title = document.getElementById('editVideoTitle').value.trim();
      const artistName = document.getElementById('editVideoArtist').value;
      const artistIdx = appData.artists.findIndex(a => a.name === artistName);
      if (artistIdx < 0) return;
      if (!appData.artists[artistIdx].music_videos) appData.artists[artistIdx].music_videos = [];
      appData.artists[artistIdx].music_videos.push({ url, title });
      saveData();
      closeVideoModal();
      renderVideoList();
    });
  }

  function closeVideoModal() {
    document.getElementById('videoModal').style.display = 'none';
  }

  function populateVideoArtistSelect() {
    const sel = document.getElementById('editVideoArtist');
    sel.innerHTML = '<option value="">Select artist...</option>';
    appData.artists.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      sel.appendChild(opt);
    });
  }

  // ---- SETTINGS ----
  function initSettings() {
    const emailInput = document.getElementById('settingEmail');
    if (appData.settings && appData.settings.email) emailInput.value = appData.settings.email;

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      if (!appData.settings) appData.settings = {};
      appData.settings.email = emailInput.value.trim();
      saveData();
      alert('Settings saved!');
    });
  }

  // ---- UTILS ----
  function extractYouTubeId(url) {
    const match = (url || '').match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  // Export data as JSON (for updating data.js)
  window.exportMelankoliaData = function() {
    const blob = new Blob([JSON.stringify(appData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'melankolia_data.json';
    a.click();
  };

})();
