/* ================================================
   MELANKOLIA AGENCY — MAIN JS
   ================================================ */

(function() {
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

  // ---- ARTIST GRID ----
  const grid = document.getElementById('artistsGrid');
  const searchInput = document.getElementById('artistSearch');

  if (grid && typeof ARTISTS !== 'undefined') {
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

        if (artist.image) {
          card.innerHTML = `
            <img class="artist-card-img" src="/images/${artist.image}" alt="${artist.name}" loading="lazy">
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

    renderGrid(ARTISTS);

    if (searchInput) {
      searchInput.addEventListener('input', () => {
        const q = searchInput.value.toLowerCase().trim();
        const filtered = q ? ARTISTS.filter(a => a.name.toLowerCase().includes(q)) : ARTISTS;
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
