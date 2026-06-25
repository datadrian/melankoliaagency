/* ================================================
   MELANKOLIA AGENCY — ARTIST PAGE JS
   ================================================ */

(function() {
  // NAV
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
  if (navToggle) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));

  // Get slug from URL
  const pathParts = window.location.pathname.split('/');
  const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2];

  const artist = ARTISTS.find(a => a.slug === slug);

  if (!artist) {
    document.getElementById('artistName').textContent = 'Artist Not Found';
    document.getElementById('artistBio').textContent = 'We could not find this artist.';
    return;
  }

  // Set page title
  document.title = `${artist.name} — Melankolia Agency`;

  // Hero
  document.getElementById('artistName').textContent = artist.name;
  if (artist.image) {
    const bg = document.getElementById('artistHeroBg');
    bg.style.backgroundImage = `url('/images/${artist.image}')`;
  }

  // Photo
  const photo = document.getElementById('artistPhoto');
  if (artist.image) {
    photo.src = `/images/${artist.image}`;
    photo.alt = artist.name;
  } else {
    photo.style.display = 'none';
  }

  // Bio
  document.getElementById('artistBio').textContent = artist.bio;

  // Social links
  const socialContainer = document.getElementById('artistSocial');
  const SOCIAL_ICONS = {
    website: 'Website',
    instagram: 'Instagram',
    facebook: 'Facebook',
    bandcamp: 'Bandcamp',
    spotify: 'Spotify',
    soundcloud: 'SoundCloud',
    youtube: 'YouTube',
    tiktok: 'TikTok'
  };

  if (artist.social_links) {
    Object.entries(artist.social_links).forEach(([platform, url]) => {
      if (!url) return;
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.className = 'social-link';
      a.textContent = SOCIAL_ICONS[platform] || platform;
      socialContainer.appendChild(a);
    });
  }

  // Book button with artist pre-filled
  const bookBtn = document.getElementById('bookBtn');
  bookBtn.href = `/booking.html?artist=${encodeURIComponent(artist.name)}`;

  // Music videos
  const videosContainer = document.getElementById('artistVideos');
  const artistVideos = (MELANKOLIA_DATA.artists.find(a => a.slug === slug) || {}).music_videos || [];

  if (artistVideos.length > 0) {
    videosContainer.innerHTML = '<h3>Music Videos</h3><div class="artist-video-grid" id="artistVideoGrid"></div>';
    const videoGrid = document.getElementById('artistVideoGrid');
    artistVideos.forEach(video => {
      const ytId = extractYouTubeId(video.url);
      if (!ytId) return;
      const card = document.createElement('div');
      card.className = 'artist-video-thumb';
      card.innerHTML = `
        <img src="https://img.youtube.com/vi/${ytId}/mqdefault.jpg" alt="${video.title}" loading="lazy">
        <div class="artist-video-play"></div>
      `;
      card.addEventListener('click', () => openVideoModal(ytId, video.title, artist.name));
      videoGrid.appendChild(card);
    });
  }

  // Video modal
  function extractYouTubeId(url) {
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
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
    document.getElementById('closeVidModal').addEventListener('click', () => modal.remove());
  }

})();
