/* ================================================
   MELANKOLIA AGENCY — PUBLIC SITE
   Single source of truth: artists.json (in git).
   Production reads committed data/images from the GitHub CDN
   so edits go live without a redeploy.
   ================================================ */
(function () {
  'use strict';

  // Single source of truth: artists.json + images are committed to git and
  // deployed with the site, so read them same-origin (no external CDN).
  var DATA_BASE = '';

  function mediaUrl(path) {
    if (!path) return '';
    if (/^https?:|^data:/.test(path)) return path;
    return DATA_BASE + (path.charAt(0) === '/' ? path : '/' + path);
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function spotifyEmbed(url) {
    var m = String(url || '').match(/open\.spotify\.com\/(artist|album|track|playlist)\/([A-Za-z0-9]+)/);
    if (!m) return '';
    return 'https://open.spotify.com/embed/' + m[1] + '/' + m[2] + '?utm_source=generator&theme=0';
  }
  function ytId(url) {
    var m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }
  var SOCIAL_LABELS = { website: 'Website', instagram: 'Instagram', facebook: 'Facebook', bandcamp: 'Bandcamp', spotify: 'Spotify', soundcloud: 'SoundCloud', youtube: 'YouTube', tiktok: 'TikTok', apple: 'Apple Music', bandsintown: 'Tour Dates' };

  // role -> {src,x,y,scale}; fall back across roles / gallery so something always shows
  function pick(a, role) {
    var r = (a.roles && a.roles[role]) || null;
    if (r && r.src) return r;
    var order = role === 'banner' ? ['banner', 'profile', 'tile'] : (role === 'profile' ? ['profile', 'tile', 'banner'] : ['tile', 'profile', 'banner']);
    for (var i = 0; i < order.length; i++) { var rr = a.roles && a.roles[order[i]]; if (rr && rr.src) return rr; }
    if (a.gallery && a.gallery.length) return { src: a.gallery[0], x: 50, y: 50, scale: 1 };
    return null;
  }
  function cropStyle(r) {
    var x = r.x != null ? r.x : 50, y = r.y != null ? r.y : 50, s = r.scale || 1;
    return 'object-position:' + x + '% ' + y + '%;transform:scale(' + s + ');transform-origin:' + x + '% ' + y + '%';
  }

  function loadArtists() {
    return fetch(DATA_BASE + '/artists.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('data ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.artists) || []; });
  }

  function initNav() {
    var nav = document.getElementById('nav'), toggle = document.getElementById('navToggle'), links = document.getElementById('navLinks');
    if (nav) window.addEventListener('scroll', function () { nav.classList.toggle('scrolled', window.scrollY > 40); }, { passive: true });
    if (toggle && links) toggle.addEventListener('click', function () { links.classList.toggle('open'); });
  }

  /* ============== HOMEPAGE GRID ============== */
  function initGrid() {
    var grid = document.getElementById('artistsGrid');
    if (!grid) return;
    var search = document.getElementById('artistSearch');
    loadArtists().then(function (artists) {
      var visible = artists.filter(function (a) { return (a.status || 'active') !== 'inactive'; });
      function render(list) {
        if (!list.length) { grid.innerHTML = '<p style="padding:3rem;color:#666;text-align:center;text-transform:uppercase;font-size:.8rem;">No artists found</p>'; return; }
        grid.innerHTML = list.map(function (a) {
          var r = pick(a, 'tile'); var img = r ? mediaUrl(r.src) : '';
          var inner = img
            ? '<img class="artist-card-img" src="' + esc(img) + '" alt="' + esc(a.name) + '" loading="lazy" style="' + cropStyle(r) + '">'
            : '<div class="artist-card-placeholder"><span class="artist-card-placeholder-text">' + esc((a.name || '?').charAt(0)) + '</span></div>';
          return '<a class="artist-card" href="/artists/' + esc(a.slug) + '">' + inner + '<div class="artist-card-overlay"><span class="artist-card-name">' + esc(a.name) + '</span></div></a>';
        }).join('');
      }
      render(visible);
      if (search) search.addEventListener('input', function () {
        var q = search.value.toLowerCase().trim();
        render(q ? visible.filter(function (a) { return (a.name || '').toLowerCase().indexOf(q) > -1; }) : visible);
      });
    }).catch(function (e) { grid.innerHTML = '<p style="padding:3rem;color:#666;text-align:center;">Could not load artists.</p>'; console.error(e); });
  }

  /* ============== ARTIST / EPK DETAIL ============== */
  function currentSlug() {
    var parts = location.pathname.split('/').filter(Boolean);
    if ((parts[0] === 'artists' || parts[0] === 'epk') && parts[1]) return decodeURIComponent(parts[1]);
    var qs = new URLSearchParams(location.search).get('slug');
    return qs || parts[parts.length - 1] || '';
  }

  function renderSocial(a) {
    var social = document.getElementById('artistSocial');
    if (!social || !a.links) return;
    social.innerHTML = Object.keys(a.links).map(function (k) {
      if (!a.links[k]) return '';
      return '<a class="social-link" href="' + esc(a.links[k]) + '" target="_blank" rel="noopener noreferrer">' + esc(SOCIAL_LABELS[k] || k) + '</a>';
    }).join('');
  }
  function renderVideos(a) {
    var vids = document.getElementById('artistVideos');
    if (!vids || !Array.isArray(a.videos) || !a.videos.length) return;
    var cards = a.videos.map(function (u) {
      var id = ytId(u); if (!id) return '';
      return '<div class="artist-video-thumb" data-yt="' + id + '"><img src="https://img.youtube.com/vi/' + id + '/mqdefault.jpg" alt="" loading="lazy"><div class="artist-video-play">▶</div></div>';
    }).join('');
    if (!cards) return;
    vids.innerHTML = '<h3>Music Videos</h3><div class="artist-video-grid">' + cards + '</div>';
    vids.querySelectorAll('.artist-video-thumb').forEach(function (c) { c.addEventListener('click', function () { openVideo(c.getAttribute('data-yt')); }); });
  }

  function initDetail() {
    var hero = document.getElementById('artistHeroBg');
    var epkGallery = document.getElementById('epkGallery');
    if (!hero && !epkGallery) return;
    var slug = currentSlug();
    loadArtists().then(function (artists) {
      var a = artists.filter(function (x) { return x.slug === slug; })[0];
      if (!a) { var n = document.getElementById('artistName'); if (n) n.textContent = 'Artist Not Found'; return; }
      document.title = a.name + ' — Melankolia Agency';
      var nameEl = document.getElementById('artistName'); if (nameEl) nameEl.textContent = a.name;

      var meta = document.getElementById('artistMeta');
      if (meta) {
        var bits = [];
        if (a.genres) bits.push('<span class="artist-tag">' + esc(a.genres) + '</span>');
        if (a.location) bits.push('<span class="artist-tag">' + esc(a.location) + '</span>');
        meta.innerHTML = bits.join('');
      }

      // hero (banner role)
      if (hero) {
        var b = pick(a, 'banner');
        if (b) hero.innerHTML = '<img class="artist-hero-img" src="' + esc(mediaUrl(b.src)) + '" alt="" style="' + cropStyle(b) + '">';
      }
      // profile photo
      var photoEl = document.getElementById('artistPhoto');
      if (photoEl) {
        var p = pick(a, 'profile');
        if (p) { photoEl.src = mediaUrl(p.src); photoEl.alt = a.name; photoEl.style.cssText += ';' + cropStyle(p); }
        else photoEl.style.display = 'none';
      }

      renderSocial(a);
      var spotEl = document.getElementById('artistSpotify');
      if (spotEl) {
        var spUrl = spotifyEmbed(a.links && a.links.spotify);
        spotEl.innerHTML = spUrl
          ? '<iframe style="border-radius:12px" src="' + esc(spUrl) + '" width="100%" height="352" frameborder="0" allowfullscreen allow="autoplay;clipboard-write;encrypted-media;fullscreen;picture-in-picture" loading="lazy"></iframe>'
          : '';
      }
      var bookBtn = document.getElementById('bookBtn'); if (bookBtn) bookBtn.href = '/booking?artist=' + encodeURIComponent(a.name);
      var shortBio = document.getElementById('artistShortBio'); if (shortBio && a.shortBio && a.shortBio !== a.bio) shortBio.textContent = a.shortBio;
      var bioEl = document.getElementById('artistBio'); if (bioEl) bioEl.textContent = a.bio || '';

      var disc = document.getElementById('artistDiscography');
      if (disc && Array.isArray(a.discography) && a.discography.length) {
        disc.innerHTML = '<h3>Discography</h3><div class="discog-grid">' + a.discography.map(function (r) {
          var title = esc(r.title || '');
          var meta = [r.year ? esc(r.year) : '', r.type ? esc(r.type) : ''].filter(Boolean).join(' · ');
          var initial = esc((r.title || '?').charAt(0).toUpperCase());
          var coverInner = r.cover
            ? '<img src="' + esc(r.cover) + '" alt="' + title + '" loading="lazy" onerror="this.parentNode.classList.add(\'no-art\');this.parentNode.innerHTML=\'<span class=&quot;discog-fallback&quot;>' + initial + '</span>\';">'
            : '<span class="discog-fallback">' + initial + '</span>';
          var card = '<div class="discog-cover">' + coverInner + '</div>' +
                     '<div class="discog-title" title="' + title + '">' + title + '</div>' +
                     (meta ? '<div class="discog-meta">' + meta + '</div>' : '');
          return r.url
            ? '<a class="discog-card" href="' + esc(r.url) + '" target="_blank" rel="noopener noreferrer">' + card + '</a>'
            : '<div class="discog-card">' + card + '</div>';
        }).join('') + '</div>';
      }
      renderVideos(a);

      // EPK gallery: every photo in the bucket
      if (epkGallery) {
        var imgs = (a.gallery || []);
        epkGallery.innerHTML = imgs.length
          ? imgs.map(function (g) { return '<a class="epk-photo" href="' + esc(mediaUrl(g)) + '" target="_blank" rel="noopener"><img src="' + esc(mediaUrl(g)) + '" alt="' + esc(a.name) + '" loading="lazy"></a>'; }).join('')
          : '<p style="color:#666">No photos uploaded yet.</p>';
      }
    }).catch(function (e) { var n = document.getElementById('artistName'); if (n) n.textContent = 'Artist Not Found'; console.error(e); });
  }

  function openVideo(id) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.92)';
    modal.innerHTML = '<div style="position:relative;width:min(900px,95vw)"><button style="position:absolute;top:-2rem;right:0;color:#888;font-size:1.2rem;background:none;border:none;cursor:pointer">✕</button><div style="aspect-ratio:16/9"><iframe width="100%" height="100%" src="https://www.youtube.com/embed/' + id + '?autoplay=1" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen></iframe></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.tagName === 'BUTTON') modal.remove(); });
  }

  initNav();
  initGrid();
  initDetail();
})();
