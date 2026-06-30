/* ================================================
   MELANKOLIA AGENCY — ARTIST PAGE JS
   Data source: published Firestore site-data → MELANKOLIA_DATA static fallback
   ================================================ */

(async function() {
  // NAV scroll
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
  if (navToggle) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));


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

  /* ---- DATA: published Firestore site-data first, static fallback only ---- */

  async function getAllArtists() {
    // Public artist pages use published Firestore data;
    // static data.js is the only fallback if the managed publish endpoint is unavailable.
    try {
      const res = await fetch('/.netlify/functions/site-data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'getArtists' }) });
      const json = await res.json();
      const remote = json?.data?.artists || [];
      const remoteVideos = json?.data?.videos || [];
      if (remote.length) return remote.map(a => {
        const matchedVideos = (remoteVideos || []).filter(v => {
          const vSlug = v.artistSlug || v.artist_slug || '';
          const vName = v.artistName || v.artist_name || '';
          return (vSlug && a.slug && vSlug === a.slug) || (vName && a.name && vName.toLowerCase() === String(a.name).toLowerCase());
        });
        return {...a, videos:[...(Array.isArray(a.videos)?a.videos:[]), ...matchedVideos], __source:'published'};
      });
    } catch(e) {}
    // Fallback to static data.js
    const src = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists)
      ? MELANKOLIA_DATA.artists
      : (Array.isArray(MELANKOLIA_DATA) ? MELANKOLIA_DATA : []);
    return src.map(a => ({...a, __source: 'static'}));
  }


  // Get slug from URL  
  const pathParts = window.location.pathname.replace(/\/$/, '').split('/');
  const slug = pathParts[pathParts.length - 1];

  const allArtists = await getAllArtists();
  const artist = allArtists.find(a => a.slug === slug);

  if (!artist) {
    document.getElementById('artistName').textContent = 'Artist Not Found';
    const bioEl = document.getElementById('artistBio');
    if (bioEl) bioEl.textContent = 'We could not find this artist.';
    return;
  }

  /* ---- normalise field names between static & admin schemas ---- */
  function field(primary, ...fallbacks) {
    if (artist[primary] != null && artist[primary] !== '') return artist[primary];
    for (const f of fallbacks) {
      if (artist[f] != null && artist[f] !== '') return artist[f];
    }
    return '';
  }

  // Static visitors may use static `image` fallback; published records must use explicit media roles.
  const _rawPhoto   = artist.__source === 'static' ? field('photo', 'image') : field('photo');
  let photoUrl    = _rawPhoto ? (_rawPhoto.startsWith('http') || _rawPhoto.startsWith('data:') || _rawPhoto.startsWith('/') ? _rawPhoto : '/images/' + _rawPhoto) : '';
  const _rawBanner  = field('banner');
  const bannerUrl   = _rawBanner ? (_rawBanner.startsWith('http') || _rawBanner.startsWith('data:') || _rawBanner.startsWith('/') ? _rawBanner : '/images/' + _rawBanner) : '';
  // v19: profile and banner are independent manual roles. Never auto-replace profile with a static fallback.
  if (isBrandLogoMedia(photoUrl)) photoUrl = '';
  if (isBrandLogoMedia(bannerUrl)) bannerUrl = '';
  // Hero uses banner if set, otherwise falls back to photo
  const heroUrl     = bannerUrl || photoUrl;
  const artistName  = field('name');
  const artistBio   = String(field('bio') || '');
  const genres      = String(field('genres') || '');
  const location    = String(field('location') || '');
  const quotes      = normalizeQuotes(Array.isArray(artist.quotes) || typeof artist.quotes === 'string' ? artist.quotes : []);
  const discography = Array.isArray(artist.discography) || typeof artist.discography === 'string' ? artist.discography : [];

  /* ---- socials: admin uses flat keys, static uses social_links obj ---- */
  const SOCIAL_MAP = {
    website:    field('website'),
    instagram:  field('instagram'),
    facebook:   field('facebook'),
    spotify:    field('spotify'),
    soundcloud: field('soundcloud'),
    youtube:    field('youtube'),
    bandcamp:   field('bandcamp'),
    ra:         field('ra'),
    bandsintown:field('bandsintown'),
  };
  // Merge published nested socials/static social_links if present
  if (artist.socials) {
    Object.entries(artist.socials).forEach(([k, v]) => {
      if (v && !SOCIAL_MAP[k]) SOCIAL_MAP[k] = v;
    });
  }
  if (artist.social_links) {
    Object.entries(artist.social_links).forEach(([k, v]) => {
      if (v && !SOCIAL_MAP[k]) SOCIAL_MAP[k] = v;
    });
  }
  if (artist.links) {
    Object.entries(artist.links).forEach(([k, v]) => {
      if (v && !SOCIAL_MAP[k]) SOCIAL_MAP[k] = v;
    });
  }

  /* ---- Page title ---- */
  document.title = `${artistName} — Melankolia Agency`;

  /* ---- Hero ---- */
  const heroNameEl = document.getElementById('artistName');
  if (heroNameEl) heroNameEl.textContent = artistName;

  if (heroUrl) {
    const bg = document.getElementById('artistHeroBg');
    if (bg) {
      bg.style.backgroundImage = `url('${heroUrl}')`;
      const fx = (artist.bannerFocalX != null && artist.bannerFocalX !== '') ? parseFloat(artist.bannerFocalX) : 50;
      const fy = (artist.bannerFocalY != null && artist.bannerFocalY !== '') ? parseFloat(artist.bannerFocalY) : 50;
      const sc = (artist.bannerCropScale != null && artist.bannerCropScale !== '') ? parseFloat(artist.bannerCropScale) : 1;
      bg.style.backgroundPosition = fx + '% ' + fy + '%';
      bg.style.backgroundSize = 'cover';
      bg.style.transformOrigin = fx + '% ' + fy + '%';
      bg.style.transform = 'scale(' + sc + ')';
    }
  }

  /* ---- Photo ---- */
  const photo = document.getElementById('artistPhoto');
  if (photo) {
    if (photoUrl) {
      photo.src = photoUrl;
      photo.alt = artistName;
      // Public profile photos render in their original aspect ratio. Crop/focal controls are kept for admin reference only.
      photo.style.objectPosition = '';
      photo.style.transformOrigin = '';
      photo.style.transform = '';
      applyProfileDisplayDimensions(photo, artist);
    } else {
      photo.style.display = 'none';
    }
  }

  /* ---- Genre / location tags ---- */
  const metaEl = document.getElementById('artistMeta');
  if (metaEl) {
    const parts = [];
    if (genres)   parts.push(`<span class="artist-tag">${genres}</span>`);
    if (location) parts.push(`<span class="artist-tag">${location}</span>`);
    metaEl.innerHTML = parts.join('');
  }

  /* ---- Lead quote (above fold). Never use generated/truncated shortBio here. ---- */
  renderLeadQuote(quotes);

  /* ---- Full bio ---- */
  var bioEl = document.getElementById('artistBio');
  if (bioEl) {
    if (artistBio) {
      var bioParts = artistBio.split('\n\n');
      var bioHtml = bioParts.map(function(p) {
        return '<p>' + p.replace(/\n/g, ' ').trim() + '</p>';
      }).filter(function(p) { return p !== '<p></p>'; }).join('');
      bioEl.innerHTML = bioHtml;
    } else {
      bioEl.innerHTML = '';
    }
  }

  /* ---- Quotes ---- */
  renderQuotes(quotes.slice(1));

  /* ---- Discography ---- */
  renderDiscography(discography);

  /* ---- Social links ---- */
  const SOCIAL_LABELS = {
    website: 'Website', instagram: 'Instagram', facebook: 'Facebook',
    bandcamp: 'Bandcamp', spotify: 'Spotify', soundcloud: 'SoundCloud',
    youtube: 'YouTube', tiktok: 'TikTok', ra: 'RA', bandsintown: 'Bandsintown'
  };
  const socialContainer = document.getElementById('artistSocial');
  if (socialContainer) {
    socialContainer.innerHTML = '';
    Object.entries(SOCIAL_MAP).forEach(([platform, url]) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'social-link';
      a.textContent = SOCIAL_LABELS[platform] || platform;
      socialContainer.appendChild(a);
    });
  }

  /* ---- Book button ---- */
  const bookBtn = document.getElementById('bookBtn');
  if (bookBtn) bookBtn.href = `/booking.html?artist=${encodeURIComponent(artistName)}`;

  if (new URLSearchParams(window.location.search).get('edit') === '1') initArtistPageEditMode(artist);

  /* ---- Spotify Player ---- */
  const spotifyUrl = field('spotify');
  const spotifyPlayerEl = document.getElementById('artistSpotifyPlayer');
  if (spotifyPlayerEl && spotifyUrl) {
    const spotifyIdMatch = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/);
    if (spotifyIdMatch) {
      const spotifyId = spotifyIdMatch[1];
      spotifyPlayerEl.innerHTML = `
        <div class="spotify-player-wrap">
          <iframe
            src="https://open.spotify.com/embed/artist/${spotifyId}?utm_source=generator&theme=0"
            width="100%" height="352"
            frameborder="0"
            allowfullscreen=""
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
            loading="lazy"
            style="border-radius:12px;display:block;">
          </iframe>
        </div>`;
      spotifyPlayerEl.style.display = 'block';
    }
  }

  /* ---- Music videos ---- */
  const videosContainer = document.getElementById('artistVideos');

  // Collect videos from published artist data, then static fallback only
  let artistVideos = [];

  // From published artist object and matched global published video library
  const rawArtistVids = [
    ...(Array.isArray(artist.videos) ? artist.videos : []),
    ...(Array.isArray(artist.music_videos) ? artist.music_videos : [])
  ];
  rawArtistVids.forEach(v => {
    const url = typeof v === 'string' ? v : (v.url || '');
    if (url) artistVideos.push({ url, title: (typeof v === 'object' && v.title) ? v.title : artistName });
  });

  // Static fallback
  if (!artistVideos.length) {
    const staticVideos = (typeof MELANKOLIA_DATA !== 'undefined' && Array.isArray(MELANKOLIA_DATA.videos)) ? MELANKOLIA_DATA.videos : [];
    staticVideos.filter(v => v.artistSlug === slug || v.artistName === artistName).forEach(v => {
      if (v.url && !artistVideos.some(ex => ex.url === v.url)) artistVideos.push({ url: v.url, title: v.title || artistName, description: v.description || '' });
    });
    const staticArtist = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists)
      ? MELANKOLIA_DATA.artists.find(a => a.slug === slug) : null;
    (staticArtist?.music_videos || []).forEach(v => {
      const url = typeof v === 'string' ? v : (v.url || '');
      if (url && !artistVideos.some(ex => ex.url === url)) artistVideos.push({ url, title: (typeof v === 'object' && v.title) ? v.title : artistName });
    });
  }

  if (videosContainer && artistVideos.length > 0) {
    videosContainer.innerHTML = '<h3 class="section-label">Music Videos</h3><div class="artist-video-grid" id="artistVideoGrid"></div>';
    const videoGrid = document.getElementById('artistVideoGrid');
    artistVideos.forEach(video => {
      const ytId = extractYouTubeId(video.url);
      if (!ytId) return;
      const card = document.createElement('div');
      card.className = 'artist-video-thumb';
      card.innerHTML = `
        <img src="https://img.youtube.com/vi/${ytId}/hqdefault.jpg" alt="${video.title}" loading="lazy"
             onerror="this.src='https://img.youtube.com/vi/${ytId}/0.jpg'">
        <div class="artist-video-play"></div>
        <div class="artist-video-title">${video.title !== artistName ? video.title : ''}</div>
      `;
      card.addEventListener('click', () => openVideoModal(ytId, video.title, artistName));
      videoGrid.appendChild(card);
    });
  }

  /* ---- LIVE STATS PANEL ---- */
  const statsContainer = document.getElementById('artistStats');
  if (statsContainer) {
    // First: show stored stats from admin (instant, no API call)
    const storedStats = artist.stats;
    if (storedStats && (storedStats.lastfmListeners || storedStats.lastfmPlaycount)) {
      renderStats({
        lastfmListeners: storedStats.lastfmListeners,
        lastfmPlaycount: storedStats.lastfmPlaycount,
        lastfmTags: storedStats.lastfmTags || [],
      }, statsContainer);
    }
    // Then refresh live
    fetchArtistStats(artistName, SOCIAL_MAP.spotify, statsContainer);
  }

  /* ---- QUOTES ---- */
  function renderLeadQuote(quotes) {
    const el = document.getElementById('artistShortBio');
    if (!el) return;
    const q = (quotes || []).find(x => x && String(x.text || x).trim());
    if (!q) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.classList.add('artist-lead-quote');
    el.innerHTML = `<span class="lead-quote-text">“${escHtml(q.text || q)}”</span>${q.source ? `<cite>— ${escHtml(q.source)}${q.year ? ', ' + escHtml(q.year) : ''}</cite>` : ''}`;
  }
  function renderQuotes(quotes) {
    const el = document.getElementById('artistQuotes');
    if (!el) return;
    const arr = normalizeQuotes(quotes);
    if (!arr.length) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    el.innerHTML = `
      <h3 class="section-label">Press</h3>
      <div class="quotes-list">
        ${arr.map(q => `
          <blockquote class="artist-quote">
            <p>“${escHtml(q.text || q)}”</p>
            ${q.source ? `<cite>— ${escHtml(q.source)}${q.year ? ', ' + escHtml(q.year) : ''}</cite>` : ''}
          </blockquote>
        `).join('')}
      </div>
    `;
  }

  function normalizeQuotes(input) {
    if (Array.isArray(input)) return input.map(q => typeof q === 'string' ? parseQuoteLine(q) : q).filter(q => q && String(q.text || q).trim());
    const str = String(input || '').trim();
    if (!str) return [];
    try { const p = JSON.parse(str); if (Array.isArray(p)) return normalizeQuotes(p); } catch {}
    return str.split(/\n\s*\n|\n(?=[“"])/).map(parseQuoteLine).filter(q => q && q.text);
  }
  function parseQuoteLine(line) {
    const raw = String(line || '').trim();
    if (!raw) return null;
    const cleaned = raw.replace(/^['"“”]+|['"“”]+$/g, '').trim();
    const parts = cleaned.split(/\s+[—–-]\s+/);
    const text = (parts[0] || '').replace(/^['"“”]+|['"“”]+$/g, '').trim();
    const sourcePart = parts.slice(1).join(' — ').trim();
    const yearMatch = sourcePart.match(/,\s*(\d{4})\s*$/);
    return { text, source: yearMatch ? sourcePart.replace(/,\s*\d{4}\s*$/, '').trim() : sourcePart, year: yearMatch ? yearMatch[1] : '' };
  }
  function escHtml(v) { return String(v || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

  /* ---- DISCOGRAPHY ---- */
  function renderDiscography(discog) {
    const el = document.getElementById('artistDiscography');
    if (!el) return;
    const arr = typeof discog === 'string' ? tryParseQuotes(discog) : (Array.isArray(discog) ? discog : []);
    if (!arr.length) { el.style.display = 'none'; return; }
    el.style.display = '';
    el.innerHTML = `
      <h3 class="section-label">Discography</h3>
      <div class="discog-grid">
        ${arr.map(r => `
          <div class="discog-card" ${r.url ? `onclick="window.open('${r.url}','_blank')"` : ''}>
            <div class="discog-cover">
              <img src="${r.cover || ''}" alt="${r.title}" loading="lazy"
                   onerror="this.parentElement.style.background='#111';this.style.display='none'">
            </div>
            <div class="discog-info">
              <div class="discog-title">${r.title}</div>
              <div class="discog-meta">${[r.year, r.type].filter(Boolean).join(' · ')}</div>
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /* ---- LIVE STATS ---- */
  async function fetchArtistStats(name, spotifyUrl, container) {
    container.innerHTML = '<div class="stats-loading">Loading stats…</div>';

    const stats = {};

    // Last.fm — free public API, just needs app key baked in (or we use the open endpoint)
    try {
      const lfResp = await fetch(
        `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(name)}&api_key=b25b959554ed76058ac220b7b2e0a026&format=json`
      );
      const lfData = await lfResp.json();
      const lfArtist = lfData?.artist;
      if (lfArtist?.stats) {
        stats.lastfmListeners  = parseInt(lfArtist.stats.listeners || 0);
        stats.lastfmPlaycount  = parseInt(lfArtist.stats.playcount || 0);
        stats.lastfmTags       = (lfArtist.tags?.tag || []).slice(0, 3).map(t => t.name);
        stats.lastfmBio        = lfArtist.bio?.summary?.replace(/<[^>]+>/g, '').split('Read more')[0].trim();
        stats.lastfmUrl        = lfArtist.url;
      }
    } catch (e) {}

    // Spotify follower count via public embed metadata
    // (Monthly listeners aren't in the public API — but followers are)
    if (spotifyUrl) {
      try {
        // Extract Spotify artist ID
        const match = spotifyUrl.match(/artist\/([a-zA-Z0-9]+)/);
        if (match) {
          const spotifyId = match[1];
          // Use Spotify's open embed API — no auth needed for basic metadata
          const embedResp = await fetch(`https://open.spotify.com/oembed?url=https://open.spotify.com/artist/${spotifyId}`);
          if (embedResp.ok) {
            const embedData = await embedResp.json();
            stats.spotifyName  = embedData.title;
            stats.spotifyThumb = embedData.thumbnail_url;
          }
          stats.spotifyUrl = `https://open.spotify.com/artist/${spotifyId}`;
          stats.spotifyId  = spotifyId;
        }
      } catch (e) {}
    }

    // MusicBrainz — tags, genre, area
    try {
      const mbResp = await fetch(
        `https://musicbrainz.org/ws/2/artist?query=${encodeURIComponent(name)}&limit=1&fmt=json`,
        { headers: { 'User-Agent': 'MelankoliaAgency/1.0 (booking@melankoliaagency.com)' } }
      );
      const mbData = await mbResp.json();
      const mbArtist = mbData?.artists?.[0];
      if (mbArtist) {
        stats.mbTags     = (mbArtist.tags || []).slice(0, 5).map(t => t.name);
        stats.mbArea     = mbArtist.area?.name;
        stats.mbCareer   = mbArtist['life-span']?.begin ? `Active since ${mbArtist['life-span'].begin.slice(0, 4)}` : '';
        stats.mbType     = mbArtist.type;
      }
    } catch (e) {}

    renderStats(stats, container);
  }

  function renderStats(stats, container) {
    const fmt = n => n >= 1000000
      ? (n / 1000000).toFixed(1) + 'M'
      : n >= 1000 ? (n / 1000).toFixed(1) + 'K' : n.toString();

    const hasAny = stats.lastfmListeners || stats.lastfmPlaycount || stats.mbCareer;
    if (!hasAny) { container.innerHTML = ''; return; }

    const tiles = [];

    if (stats.lastfmListeners) {
      tiles.push(`
        <div class="stat-tile">
          <div class="stat-value">${fmt(stats.lastfmListeners)}</div>
          <div class="stat-label">Last.fm Listeners</div>
        </div>
      `);
    }
    if (stats.lastfmPlaycount) {
      tiles.push(`
        <div class="stat-tile">
          <div class="stat-value">${fmt(stats.lastfmPlaycount)}</div>
          <div class="stat-label">Total Scrobbles</div>
        </div>
      `);
    }
    if (stats.mbCareer) {
      tiles.push(`
        <div class="stat-tile">
          <div class="stat-value">${stats.mbCareer.replace('Active since ', '')}</div>
          <div class="stat-label">Active Since</div>
        </div>
      `);
    }
    if (stats.mbArea) {
      tiles.push(`
        <div class="stat-tile">
          <div class="stat-value">${stats.mbArea}</div>
          <div class="stat-label">Origin</div>
        </div>
      `);
    }

    const tags = [...new Set([...(stats.lastfmTags || []), ...(stats.mbTags || [])])].slice(0, 5);

    container.innerHTML = `
      <div class="artist-stats-wrap">
        <div class="stats-tiles">${tiles.join('')}</div>
        ${tags.length ? `<div class="stats-tags">${tags.map(t => `<span class="stats-tag">${t}</span>`).join('')}</div>` : ''}
        ${stats.lastfmUrl ? `<a href="${stats.lastfmUrl}" target="_blank" rel="noopener" class="stats-source">Data via Last.fm ↗</a>` : ''}
      </div>
    `;
  }



  function applyProfileDisplayDimensions(img, src) {
    if (!img || !src) return;
    const w = parseFloat(src.profileDisplayWidth || src.profileWidth || '100');
    const mh = parseFloat(src.profileMaxHeight || '');
    img.style.width = Number.isFinite(w) ? Math.max(35, Math.min(100, w)) + '%' : '100%';
    img.style.maxWidth = '100%';
    img.style.height = 'auto';
    img.style.objectFit = 'contain';
    img.style.marginLeft = 'auto';
    img.style.marginRight = 'auto';
    img.style.display = 'block';
    img.style.maxHeight = Number.isFinite(mh) && mh > 0 ? Math.max(140, Math.min(1200, mh)) + 'px' : '';
  }

  /* ---- ADMIN LIVE PAGE EDIT MODE ---- */
  function initArtistPageEditMode(renderedArtist) {
    document.body.classList.add('artist-edit-mode');
    const qs = new URLSearchParams(window.location.search);
    const editSlug = renderedArtist.slug || slug;
    let artists = Array.isArray(allArtists) ? allArtists.slice() : [];
    let rec = artists.find(a => a.slug === editSlug) || artists.find(a => String(a.name||'').toLowerCase() === String(renderedArtist.name||'').toLowerCase()) || {...renderedArtist};
    const panel = document.createElement('aside');
    panel.className = 'artist-page-editor-panel';
    panel.innerHTML = `
      <div class="ape-head"><strong>Artist Page Edit</strong><button type="button" id="apeClose">×</button></div>
      <label>Bio</label><textarea id="apeBio" rows="9">${escHtml(rec.bio || '')}</textarea>
      <label>Lead / Press Quotes <small>first quote becomes page pull quote</small></label><textarea id="apeQuotes" rows="5">${escHtml(quotesToText(rec.quotes || ''))}</textarea>
      <label>Profile Photo URL <small>renders natural size; no crop</small></label><input id="apePhoto" value="${escHtml(rec.photo || '')}">
      <div id="apePhotoVault" class="ape-vault"></div>
      <label>Upload New Profile Image</label><input id="apeUpload" type="file" accept="image/*">
      <div class="ape-grid"><label>Profile Width<input id="apeProfileWidth" type="range" min="35" max="100" value="${num(rec.profileDisplayWidth || rec.profileWidth,100)}"></label><label>Profile Max Height<input id="apeProfileMaxHeight" type="range" min="180" max="900" step="10" value="${num(rec.profileMaxHeight,620)}"></label></div>
      <label>Banner URL</label><input id="apeBanner" value="${escHtml(rec.banner || '')}">
      <div class="ape-grid"><label>Banner X<input id="apeBannerX" type="range" min="0" max="100" value="${num(rec.bannerFocalX,50)}"></label><label>Banner Y<input id="apeBannerY" type="range" min="0" max="100" value="${num(rec.bannerFocalY,50)}"></label><label>Banner Scale<input id="apeBannerScale" type="range" min="1" max="2.4" step="0.02" value="${num(rec.bannerCropScale,1)}"></label></div>
      <p class="ape-note">Pick an existing image, upload a new one, and resize the profile photo directly on this page. Save + Publish writes the artist record and refreshes the public page data.</p>
      <button type="button" id="apeSave" class="ape-save">Save + Publish</button><div id="apeStatus" class="ape-status"></div>`;
    document.body.appendChild(panel);
    document.getElementById('apeClose').onclick = () => panel.remove();
    ['apeBio','apeQuotes','apePhoto','apeProfileWidth','apeProfileMaxHeight','apeBanner','apeBannerX','apeBannerY','apeBannerScale'].forEach(id => document.getElementById(id)?.addEventListener('input', previewArtistPageEdit));
    renderProfileVault();
    document.getElementById('apeUpload')?.addEventListener('change', uploadProfileImageFromEdit);
    document.getElementById('apeSave').onclick = saveArtistPageEdit;
    makeBannerClickToCenter();
    function num(v,d){ const n=parseFloat(v); return Number.isFinite(n)?n:d; }
    function quotesToText(q){ return normalizeQuotes(q).map(x => x.source ? `"${x.text}" — ${x.source}${x.year?', '+x.year:''}` : String(x.text||x)).join('\n\n'); }
    function previewArtistPageEdit(){
      const bio = document.getElementById('apeBio').value;
      const bioEl = document.getElementById('artistBio');
      if (bioEl) bioEl.innerHTML = bio.split('\n\n').map(p=>'<p>'+escHtml(p).replace(/\n/g,' ')+'</p>').join('');
      renderLeadQuote(normalizeQuotes(document.getElementById('apeQuotes').value));
      const purl = document.getElementById('apePhoto').value.trim();
      const ph = document.getElementById('artistPhoto');
      if (ph && purl) { ph.style.display=''; ph.src=purl; ph.style.height='auto'; ph.style.objectFit='contain'; ph.style.transform=''; applyProfileDisplayDimensions(ph, { profileDisplayWidth: document.getElementById('apeProfileWidth').value, profileMaxHeight: document.getElementById('apeProfileMaxHeight').value }); }
      const burl = document.getElementById('apeBanner').value.trim();
      const bg = document.getElementById('artistHeroBg');
      if (bg && burl) bg.style.backgroundImage = `url('${burl}')`;
      updateBannerPreview();
    }
    function updateBannerPreview(){
      const bg = document.getElementById('artistHeroBg'); if (!bg) return;
      const x=document.getElementById('apeBannerX').value, y=document.getElementById('apeBannerY').value, sc=document.getElementById('apeBannerScale').value;
      bg.style.backgroundPosition = x + '% ' + y + '%'; bg.style.transformOrigin = x + '% ' + y + '%'; bg.style.transform = 'scale(' + sc + ')'; bg.style.backgroundSize = 'cover';
    }
    function makeBannerClickToCenter(){
      const bg = document.getElementById('artistHeroBg'); if (!bg) return;
      bg.style.cursor='crosshair';
      bg.title='Edit mode: click to set banner center';
      bg.addEventListener('click', e => {
        if (!document.body.classList.contains('artist-edit-mode')) return;
        const r=bg.getBoundingClientRect();
        document.getElementById('apeBannerX').value = Math.max(0, Math.min(100, Math.round(((e.clientX-r.left)/r.width)*100)));
        document.getElementById('apeBannerY').value = Math.max(0, Math.min(100, Math.round(((e.clientY-r.top)/r.height)*100)));
        updateBannerPreview();
      });
    }
    function currentVaultImages(){
      return Array.from(new Set([rec.gridPhoto, rec.photo, rec.banner, renderedArtist.gridPhoto, renderedArtist.photo, renderedArtist.banner, ...(Array.isArray(rec.photos)?rec.photos:String(rec.photos||'').split('\n')), ...(Array.isArray(renderedArtist.photos)?renderedArtist.photos:[])].filter(Boolean).map(x=>String(x).trim()).filter(Boolean)));
    }
    function renderProfileVault(){
      const el=document.getElementById('apePhotoVault'); if (!el) return;
      const active=document.getElementById('apePhoto')?.value.trim();
      const imgs=currentVaultImages();
      el.innerHTML = imgs.length ? imgs.map(u=>`<button type="button" class="ape-thumb ${u===active?'active':''}" data-url="${escHtml(u)}"><img src="${escHtml(u)}" alt=""></button>`).join('') : '<div class="ape-empty">No saved media yet — upload a profile image below.</div>';
      el.querySelectorAll('.ape-thumb').forEach(btn=>btn.addEventListener('click',()=>{ document.getElementById('apePhoto').value=btn.dataset.url; previewArtistPageEdit(); renderProfileVault(); }));
    }
    async function uploadProfileImageFromEdit(e){
      const file=e.target.files && e.target.files[0]; if (!file) return;
      const status=document.getElementById('apeStatus'); status.textContent='Uploading image…'; status.className='ape-status';
      const password=sessionStorage.getItem('mk_admin_password') || prompt('Admin password to upload this image:');
      if (!password) { status.textContent='Upload cancelled — password required.'; status.className='ape-status error'; return; }
      sessionStorage.setItem('mk_admin_password', password);
      const dataUrl = await resizeImageForUpload(file, 1600, 0.86);
      const res = await fetch('/.netlify/functions/media-upload', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ password, filename:file.name, dataUrl }) });
      const json = await res.json().catch(()=>({}));
      if (!res.ok || !json.success || !json.url) { status.textContent='Upload failed: ' + (json.error || res.status); status.className='ape-status error'; return; }
      rec.photos = Array.from(new Set([...(Array.isArray(rec.photos)?rec.photos:[]), json.url]));
      document.getElementById('apePhoto').value=json.url;
      previewArtistPageEdit(); renderProfileVault();
      status.textContent='Uploaded. Click Save + Publish to lock it.'; status.className='ape-status ok';
    }
    function resizeImageForUpload(file, maxSide, quality){
      return new Promise((resolve,reject)=>{
        const img=new Image(); const reader=new FileReader();
        reader.onload=()=>{ img.onload=()=>{ const scale=Math.min(1, maxSide/Math.max(img.width,img.height)); const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round(img.width*scale)); canvas.height=Math.max(1,Math.round(img.height*scale)); const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,canvas.width,canvas.height); resolve(canvas.toDataURL('image/jpeg', quality)); }; img.onerror=reject; img.src=reader.result; };
        reader.onerror=reject; reader.readAsDataURL(file);
      });
    }
    function stripInlineDataImagesForPageEdit(value){
      if (typeof value === 'string') return /^data:image\//i.test(value) ? '' : value;
      if (Array.isArray(value)) return value.map(stripInlineDataImagesForPageEdit).filter(v => !(typeof v === 'string' && !v));
      if (value && typeof value === 'object') { const out={}; Object.entries(value).forEach(([k,v])=>{ const c=stripInlineDataImagesForPageEdit(v); if (c !== '' && c != null) out[k]=c; }); return out; }
      return value;
    }
    async function saveArtistPageEdit(){
      const btn=document.getElementById('apeSave'), status=document.getElementById('apeStatus');
      btn.disabled=true; status.textContent='Saving + publishing…'; status.className='ape-status';
      const idx = artists.findIndex(a => a.id === rec.id || a.slug === editSlug);
      const next = {...(idx>=0?artists[idx]:rec)};
      next.bio=document.getElementById('apeBio').value;
      next.quotes=document.getElementById('apeQuotes').value;
      next.photo=document.getElementById('apePhoto').value.trim();
      next.profileDisplayWidth=parseFloat(document.getElementById('apeProfileWidth').value);
      next.profileMaxHeight=parseFloat(document.getElementById('apeProfileMaxHeight').value);
      next.banner=document.getElementById('apeBanner').value.trim();
      next.bannerFocalX=parseFloat(document.getElementById('apeBannerX').value);
      next.bannerFocalY=parseFloat(document.getElementById('apeBannerY').value);
      next.bannerCropScale=parseFloat(document.getElementById('apeBannerScale').value);
      next.photos = Array.from(new Set([next.gridPhoto,next.photo,next.banner,...(Array.isArray(next.photos)?next.photos:String(next.photos||'').split('\n'))].filter(Boolean)));
      const cleanNext = stripInlineDataImagesForPageEdit(next);
      const password = sessionStorage.getItem('mk_admin_password') || prompt('Admin password to publish this artist page:');
      if (!password) { btn.disabled=false; status.textContent='Not published — password required.'; status.className='ape-status error'; return; }
      sessionStorage.setItem('mk_admin_password', password);
      const res = await fetch('/.netlify/functions/site-data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'publishArtist', password, artist:cleanNext, order:idx>=0?idx:9999, data_version:'artist-page-edit-v3' }) });
      const json = await res.json().catch(()=>({}));
      if (!res.ok || !json.success) { btn.disabled=false; status.textContent='Publish failed: ' + (json.error || res.status); status.className='ape-status error'; return; }
      status.textContent='Published to server storage. Refreshing…'; status.className='ape-status ok';
      setTimeout(()=>location.href=location.pathname+'?v=artist-page-edit-v1',900);
    }
  }

  /* ---- VIDEO HELPERS ---- */
  function extractYouTubeId(url) {
    if (!url) return null;
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function openVideoModal(ytId, title, artistName) {
    const modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.92)';
    modal.innerHTML = `
      <div style="position:relative;width:min(900px,95vw)">
        <button style="position:absolute;top:-2rem;right:0;color:#888;font-size:1.2rem;background:none;border:none;cursor:pointer" id="closeVidModal">✕</button>
        <div style="aspect-ratio:16/9">
          <iframe width="100%" height="100%" src="https://www.youtube.com/embed/${ytId}?autoplay=1" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen></iframe>
        </div>
        <p style="padding:.75rem 0;font-size:.85rem;color:#fff">${title}</p>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.getElementById('closeVidModal').addEventListener('click', () => modal.remove());
  }

})();
