/* ================================================
   MELANKOLIA AGENCY — VIDEOS PAGE JS
   ================================================ */

(function() {
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

  // Collect all videos from all artists
  let allVideos = [];
  if (typeof ARTISTS !== 'undefined') {
    ARTISTS.forEach(artist => {
      (artist.music_videos || []).forEach(video => {
        allVideos.push({ ...video, artist_name: artist.name, artist_slug: artist.slug });
      });
    });
  }

  function extractYouTubeId(url) {
    const match = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
    return match ? match[1] : null;
  }

  function renderVideos(videos) {
    grid.innerHTML = '';
    if (!videos.length) {
      noVideos.style.display = 'block';
      return;
    }
    noVideos.style.display = 'none';
    videos.forEach(video => {
      const ytId = extractYouTubeId(video.url);
      if (!ytId) return;
      const card = document.createElement('div');
      card.className = 'video-card';
      card.innerHTML = `
        <div class="video-card-thumb">
          <img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="${video.title}" loading="lazy">
          <div class="video-play-btn"><div class="video-play-icon"></div></div>
        </div>
        <div class="video-card-info">
          <p class="video-card-title">${video.title}</p>
          <p class="video-card-artist">${video.artist_name}</p>
        </div>
      `;
      card.addEventListener('click', () => openModal(ytId, video.title, video.artist_name));
      grid.appendChild(card);
    });
  }

  function openModal(ytId, title, artistName) {
    const modal = document.getElementById('videoModal');
    const player = document.getElementById('videoModalPlayer');
    document.getElementById('videoModalTitle').textContent = title;
    document.getElementById('videoModalArtist').textContent = artistName;
    player.innerHTML = `<iframe width="100%" height="100%" src="https://www.youtube.com/embed/${ytId}?autoplay=1" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen></iframe>`;
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

  document.getElementById('videoModalClose').addEventListener('click', closeModal);
  document.getElementById('videoModalBackdrop').addEventListener('click', closeModal);

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const q = searchInput.value.toLowerCase().trim();
      const filtered = q ? allVideos.filter(v =>
        v.artist_name.toLowerCase().includes(q) || v.title.toLowerCase().includes(q)
      ) : allVideos;
      renderVideos(filtered);
    });
  }

  renderVideos(allVideos);
})();
