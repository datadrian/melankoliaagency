/* ================================================
   MELANKOLIA AGENCY — MAIN JS
   ================================================ */

(async function() {
  // ---- NAV SCROLL ----
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');

  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });

  if (navToggle) {
    navToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });
  }

  // ---- DATA: published Firestore site-data first, static fallback only ----

  async function getMergedArtists() {
    let base = (typeof ARTISTS !== 'undefined') ? ARTISTS : [];
    // Public homepage uses published Firestore data;
    // static data.js is the only fallback if the managed publish endpoint is unavailable.
    try {
      const res = await fetch('/.netlify/functions/site-data', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ action:'getArtists' }) });
      const json = await res.json();
      const remote = json?.data?.artists || [];
      if (remote.length) return remote;
    } catch(e) {}
    return base;
  }


  // Homepage grid uses dedicated grid image fields so profile photos can stay separate.
  function artistImgSrc(a) {
    if (a.gridPhoto) return a.gridPhoto;            // admin homepage image
    if (a.gridImage) return '/images/' + a.gridImage; // static homepage image
    if (a.photo) return a.photo;
    if (a.image) return '/images/' + a.image;
    return '';
  }

  // ---- ARTIST GRID ----
  const grid = document.getElementById('artistsGrid');
  const searchInput = document.getElementById('artistSearch');

  const MERGED_ARTISTS = await getMergedArtists();

  if (grid) {
    function renderGrid(artists) {
      grid.innerHTML = '';
      if (!artists.length) {
        grid.innerHTML = '<p style="padding:3rem;color:#666;text-align:center;letter-spacing:.1em;text-transform:uppercase;font-size:.8rem;">No artists found</p>';
        return;
      }
      artists.forEach(artist => {
        const card = document.createElement('a');
        card.href = `/artists/${artist.slug}`;
        card.className = 'artist-card';

        const imgSrc = artistImgSrc(artist);
        if (imgSrc) {
          const fx = (artist.gridFocalX != null && artist.gridFocalX !== '') ? artist.gridFocalX : ((artist.focalX != null && artist.focalX !== '') ? artist.focalX : 50);
          const fy = (artist.gridFocalY != null && artist.gridFocalY !== '') ? artist.gridFocalY : ((artist.focalY != null && artist.focalY !== '') ? artist.focalY : 50);
          const sc = (artist.gridCropScale != null && artist.gridCropScale !== '') ? artist.gridCropScale : ((artist.cropScale != null && artist.cropScale !== '') ? artist.cropScale : 1);
          card.innerHTML = `
            <img class="artist-card-img" src="${imgSrc}" alt="${artist.name}" loading="lazy" style="object-position:${fx}% ${fy}%;transform-origin:${fx}% ${fy}%;--crop-scale:${sc}">
            <div class="artist-card-overlay">
              <span class="artist-card-name">${artist.name}</span>
            </div>
          `;
        } else {
          const initial = artist.name.charAt(0);
          card.innerHTML = `
            <div class="artist-card-placeholder">
              <span class="artist-card-placeholder-text">${initial}</span>
            </div>
            <div class="artist-card-overlay">
              <span class="artist-card-name">${artist.name}</span>
            </div>
          `;
        }
        grid.appendChild(card);
      });
    }

    renderGrid(MERGED_ARTISTS);

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = q ? MERGED_ARTISTS.filter(a => a.name.toLowerCase().includes(q)) : MERGED_ARTISTS;
        renderGrid(filtered);
      });
    }
  }

  // ---- NETLIFY FORMS ----
  function handleNetlifyForm(formEl, successEl) {
    if (!formEl) return;
    formEl.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(formEl);
      try {
        await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(data).toString()
        });
        formEl.style.opacity = '0.4';
        formEl.style.pointerEvents = 'none';
        if (successEl) successEl.style.display = 'block';
      } catch (err) {
        console.error(err);
      }
    });
  }

  handleNetlifyForm(document.getElementById('submissionForm'), document.getElementById('subSuccess'));

})();
