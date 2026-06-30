/* ================================================
   MELANKOLIA AGENCY — VIDEOS PAGE JS v2
   Reads from mk_videos (admin-managed) with fallback to static data.js
   ================================================ */

(async function() {
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
  if (navToggle) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));

  const grid = document.getElementById('videosGrid');
  const noVideos = document.getElementById('noVideos');
  const searchInput = document.getElementById('videoSearch');

  function getVideoMeta(url) {
    if (!url) return null;
    const yt = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    if (yt) return {
      provider: 'youtube',
      id: yt[1],
      embed: `https://www.youtube.com/embed/${yt[1]}?autoplay=1&rel=0`,
      thumb: `https://img.youtube.com/vi/${yt[1]}/mqdefault.jpg`,
      fallbackThumb: `https://img.youtube.com/vi/${yt[1]}/0.jpg`
    };
    const vm = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vm) return {
      provider: 'vimeo',
      id: vm[1],
      embed: `https://player.vimeo.com/video/${vm[1]}?autoplay=1`,
      thumb: `https://vumbnail.com/${vm[1]}.jpg`,
      fallbackThumb: ''
    };
    return null;
  }

  function extractYouTubeId(url) {
    const meta = getVideoMeta(url);
    return meta && meta.provider === 'youtube' ? meta.id : null;
  }

  // Collect all videos from published Firestore data first.
  // Published Firestore videos win; static data.js is the only fallback.
  let allVideos = [];

  try {
    const res = await fetch('/.netlify/functions/site-data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'getArtists' }) });
    const json = await res.json();
    const remoteVideos = json?.data?.videos || [];
    const remoteArtists = json?.data?.artists || [];
    if (Array.isArray(remoteVideos) && remoteVideos.length) allVideos = remoteVideos.slice();
    if (!allVideos.length && Array.isArray(remoteArtists) && remoteArtists.length) {
      remoteArtists.forEach(artist => {
        (artist.music_videos || artist.videos || []).forEach(video => {
          if (!video) return;
          if (typeof video === 'string') allVideos.push({ url: video, artistName: artist.name, artist_name: artist.name, artistSlug: artist.slug, artist_slug: artist.slug, title: artist.name });
          else allVideos.push({ ...video, artistName: video.artistName || artist.name, artist_name: video.artist_name || artist.name, artistSlug: video.artistSlug || artist.slug, artist_slug: video.artist_slug || artist.slug });
        });
      });
    }
  } catch(e) {}

  if (!allVideos.length && typeof MELANKOLIA_DATA !== 'undefined' && Array.isArray(MELANKOLIA_DATA.videos) && MELANKOLIA_DATA.videos.length) {
    allVideos = MELANKOLIA_DATA.videos.slice();
  }
  if (!allVideos.length && typeof ARTISTS !== 'undefined') {
    ARTISTS.forEach(artist => {
      (artist.music_videos || []).forEach(video => {
        if (!video) return;
        if (typeof video === 'string') allVideos.push({ url: video, artistName: artist.name, artist_name: artist.name, artistSlug: artist.slug, artist_slug: artist.slug, title: artist.name });
        else allVideos.push({ ...video, artistName: video.artistName || artist.name, artist_name: video.artist_name || artist.name, artistSlug: video.artistSlug || artist.slug, artist_slug: video.artist_slug || artist.slug });
      });
    });
  }

  allVideos = allVideos.map((v, i) => ({ ...v, order: Number.isFinite(Number(v.order)) ? Number(v.order) : i }))
                       .sort((a, b) => (a.order || 0) - (b.order || 0));

  function renderVideos(videos) {
    if (!grid) return;
    grid.innerHTML = '';
    const renderable = (videos || []).map(video => ({ video, meta: getVideoMeta(video.url || '') })).filter(x => x.meta);
    if (!renderable.length) {
      if (noVideos) noVideos.style.display = 'block';
      return;
    }
    if (noVideos) noVideos.style.display = 'none';
    renderable.forEach(({ video, meta }) => {
      const artistName = video.artistName || video.artist_name || '';
      const title = video.title || artistName || 'Music Video';
      const thumb = video.thumb || meta.thumb;

      const card = document.createElement('div');
      card.className = 'video-card';
      card.innerHTML = `
        <div class="video-card-thumb">
          ${thumb ? `<img src="${escHtml(thumb)}" alt="${escHtml(title)}" loading="lazy" ${meta.fallbackThumb ? `onerror="this.src='${meta.fallbackThumb}'"` : ''}>` : `<div class="video-thumb-fallback"></div>`}
          <div class="video-play-btn"><div class="video-play-icon"></div></div>
        </div>
        <div class="video-card-info">
          <p class="video-card-title">${escHtml(title)}</p>
          <p class="video-card-artist">${escHtml(artistName)}</p>
        </div>
      `;
      card.addEventListener('click', () => openModal(meta, title, artistName, video.description || ''));
      grid.appendChild(card);
    });
  }

  function escHtml(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function openModal(meta, title, artistName, description) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('videoModalPlayer');
    document.getElementById('videoModalTitle').textContent = title;
    document.getElementById('videoModalArtist').textContent = artistName;
    const descEl = document.getElementById('videoModalDescription');
    if (descEl) { descEl.textContent = description || ''; descEl.style.display = description ? 'block' : 'none'; }
    player.innerHTML = `<iframe width="100%" height="100%" src="${meta.embed}" frameborder="0" allow="autoplay;encrypted-media;fullscreen;picture-in-picture" allowfullscreen></iframe>`;
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  function closeModal() {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('videoModalPlayer');
    modal.style.display = 'none';
    player.innerHTML = '';
    document.body.style.overflow = '';
  }

  const closeBtn = document.getElementById('videoModalClose');
  const backdrop = document.getElementById('videoModalBackdrop');
  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (backdrop) backdrop.addEventListener('click', closeModal);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = q ? allVideos.filter(v =>
        (v.artistName || v.artist_name || '').toLowerCase().includes(q) ||
        (v.title || '').toLowerCase().includes(q)
      ) : allVideos;
      renderVideos(filtered);
    });
  }

  renderVideos(allVideos);
})();
