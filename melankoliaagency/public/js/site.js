/* ================================================
   MELANKOLIA AGENCY — PUBLIC SITE
   Single source of truth: artists.json (in git).
   On production the data + images are read from the
   GitHub CDN so edits go live without a redeploy.
   ================================================ */
(function () {
  'use strict';

  var REPO = 'datadrian/melankoliaagency';
  var SUBDIR = 'melankoliaagency/public';
  var isProd = /(^|\.)melankoliaagency\.com$/.test(location.hostname);
  // Production reads committed content from jsDelivr (purged on save).
  // Previews/branch deploys read their own locally-deployed copy.
  var DATA_BASE = isProd
    ? 'https://cdn.jsdelivr.net/gh/' + REPO + '@main/' + SUBDIR
    : '';

  function mediaUrl(path) {
    if (!path) return '';
    if (/^https?:|^data:/.test(path)) return path;
    return DATA_BASE + (path.charAt(0) === '/' ? path : '/' + path);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function ytId(url) {
    var m = String(url || '').match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/);
    return m ? m[1] : null;
  }

  var SOCIAL_LABELS = {
    website: 'Website', instagram: 'Instagram', facebook: 'Facebook',
    bandcamp: 'Bandcamp', spotify: 'Spotify', soundcloud: 'SoundCloud',
    youtube: 'YouTube', tiktok: 'TikTok', apple: 'Apple Music', bandsintown: 'Tour Dates'
  };

  function loadArtists() {
    return fetch(DATA_BASE + '/artists.json', { cache: 'no-cache' })
      .then(function (r) { if (!r.ok) throw new Error('data ' + r.status); return r.json(); })
      .then(function (d) { return (d && d.artists) || []; });
  }

  /* ---- NAV (shared) ---- */
  function initNav() {
    var nav = document.getElementById('nav');
    var toggle = document.getElementById('navToggle');
    var links = document.getElementById('navLinks');
    if (nav) {
      window.addEventListener('scroll', function () {
        nav.classList.toggle('scrolled', window.scrollY > 40);
      }, { passive: true });
    }
    if (toggle && links) toggle.addEventListener('click', function () { links.classList.toggle('open'); });
  }

  /* ================= HOMEPAGE GRID ================= */
  function initGrid() {
    var grid = document.getElementById('artistsGrid');
    if (!grid) return false;
    var search = document.getElementById('artistSearch');

    loadArtists().then(function (artists) {
      var visible = artists.filter(function (a) { return (a.status || 'active') !== 'inactive'; });

      function render(list) {
        if (!list.length) {
          grid.innerHTML = '<p style="padding:3rem;color:#666;text-align:center;letter-spacing:.1em;text-transform:uppercase;font-size:.8rem;">No artists found</p>';
          return;
        }
        grid.innerHTML = list.map(function (a) {
          var img = mediaUrl(a.photo);
          var fx = (a.focalX != null ? a.focalX : 50), fy = (a.focalY != null ? a.focalY : 50);
          var inner = img
            ? '<img class="artist-card-img" src="' + esc(img) + '" alt="' + esc(a.name) + '" loading="lazy" style="object-position:' + fx + '% ' + fy + '%">'
            : '<div class="artist-card-placeholder"><span class="artist-card-placeholder-text">' + esc((a.name || '?').charAt(0)) + '</span></div>';
          return '<a class="artist-card" href="/artists/' + esc(a.slug) + '">' + inner +
            '<div class="artist-card-overlay"><span class="artist-card-name">' + esc(a.name) + '</span></div></a>';
        }).join('');
      }

      render(visible);
      if (search) {
        search.addEventListener('input', function () {
          var q = search.value.toLowerCase().trim();
          render(q ? visible.filter(function (a) { return (a.name || '').toLowerCase().indexOf(q) > -1; }) : visible);
        });
      }
    }).catch(function (e) {
      grid.innerHTML = '<p style="padding:3rem;color:#666;text-align:center;">Could not load artists.</p>';
      console.error(e);
    });
    return true;
  }

  /* ================= ARTIST DETAIL ================= */
  function currentSlug() {
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts[0] === 'artists' && parts[1]) return decodeURIComponent(parts[1]);
    var qs = new URLSearchParams(location.search).get('slug');
    return qs || parts[parts.length - 1] || '';
  }

  function initDetail() {
    var heroBg = document.getElementById('artistHeroBg');
    if (!heroBg) return false;
    var slug = currentSlug();

    loadArtists().then(function (artists) {
      var a = artists.filter(function (x) { return x.slug === slug; })[0];
      if (!a) {
        document.getElementById('artistName').textContent = 'Artist Not Found';
        return;
      }
      document.title = a.name + ' — Melankolia Agency';
      document.getElementById('artistName').textContent = a.name;

      var meta = document.getElementById('artistMeta');
      if (meta) {
        var bits = [];
        if (a.genres) bits.push('<span class="artist-tag">' + esc(a.genres) + '</span>');
        if (a.location) bits.push('<span class="artist-tag">' + esc(a.location) + '</span>');
        meta.innerHTML = bits.join('');
      }

      var photo = mediaUrl(a.photo);
      var heroSrc = mediaUrl(a.banner) || photo;
      if (heroSrc) {
        heroBg.style.backgroundImage = "url('" + heroSrc + "')";
        var bfx = (a.banner ? (a.bannerFocalX != null ? a.bannerFocalX : 50) : (a.focalX != null ? a.focalX : 50));
        var bfy = (a.banner ? (a.bannerFocalY != null ? a.bannerFocalY : 50) : (a.focalY != null ? a.focalY : 50));
        heroBg.style.backgroundPosition = bfx + '% ' + bfy + '%';
      }

      var photoEl = document.getElementById('artistPhoto');
      if (photo) {
        photoEl.src = photo; photoEl.alt = a.name;
        photoEl.style.objectPosition = (a.focalX != null ? a.focalX : 50) + '% ' + (a.focalY != null ? a.focalY : 50) + '%';
      } else { photoEl.style.display = 'none'; }

      var social = document.getElementById('artistSocial');
      if (social && a.links) {
        social.innerHTML = Object.keys(a.links).map(function (k) {
          if (!a.links[k]) return '';
          return '<a class="social-link" href="' + esc(a.links[k]) + '" target="_blank" rel="noopener noreferrer">' + esc(SOCIAL_LABELS[k] || k) + '</a>';
        }).join('');
      }

      var bookBtn = document.getElementById('bookBtn');
      if (bookBtn) bookBtn.href = '/booking?artist=' + encodeURIComponent(a.name);

      var shortBio = document.getElementById('artistShortBio');
      if (shortBio && a.shortBio && a.shortBio !== a.bio) shortBio.textContent = a.shortBio;
      document.getElementById('artistBio').textContent = a.bio || '';

      var disc = document.getElementById('artistDiscography');
      if (disc && Array.isArray(a.discography) && a.discography.length) {
        disc.innerHTML = '<h3>Discography</h3><ul class="discography-list">' +
          a.discography.map(function (r) {
            return '<li>' + esc(r.title || '') + (r.year ? ' <span class="disc-year">(' + esc(r.year) + ')</span>' : '') + '</li>';
          }).join('') + '</ul>';
      }

      var vids = document.getElementById('artistVideos');
      if (vids && Array.isArray(a.videos) && a.videos.length) {
        var cards = a.videos.map(function (u) {
          var id = ytId(u); if (!id) return '';
          return '<div class="artist-video-thumb" data-yt="' + id + '">' +
            '<img src="https://img.youtube.com/vi/' + id + '/mqdefault.jpg" alt="" loading="lazy">' +
            '<div class="artist-video-play">▶</div></div>';
        }).join('');
        if (cards) {
          vids.innerHTML = '<h3>Music Videos</h3><div class="artist-video-grid">' + cards + '</div>';
          vids.querySelectorAll('.artist-video-thumb').forEach(function (c) {
            c.addEventListener('click', function () { openVideo(c.getAttribute('data-yt')); });
          });
        }
      }
    }).catch(function (e) {
      document.getElementById('artistName').textContent = 'Artist Not Found';
      console.error(e);
    });
    return true;
  }

  function openVideo(id) {
    var modal = document.createElement('div');
    modal.style.cssText = 'position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.92)';
    modal.innerHTML = '<div style="position:relative;width:min(900px,95vw)">' +
      '<button style="position:absolute;top:-2rem;right:0;color:#888;font-size:1.2rem;background:none;border:none;cursor:pointer">✕</button>' +
      '<div style="aspect-ratio:16/9"><iframe width="100%" height="100%" src="https://www.youtube.com/embed/' + id + '?autoplay=1" frameborder="0" allow="autoplay;encrypted-media" allowfullscreen></iframe></div></div>';
    document.body.appendChild(modal);
    modal.addEventListener('click', function (e) { if (e.target === modal || e.target.tagName === 'BUTTON') modal.remove(); });
  }

  /* ---- boot ---- */
  initNav();
  initGrid();
  initDetail();
})();
