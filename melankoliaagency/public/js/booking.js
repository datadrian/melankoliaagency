/* ================================================
   MELANKOLIA AGENCY — BOOKING PAGE JS
   ================================================ */

(function() {
  const nav = document.getElementById('nav');
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  window.addEventListener('scroll', () => {
    nav.classList.toggle('scrolled', window.scrollY > 40);
  }, { passive: true });
  if (navToggle) navToggle.addEventListener('click', () => navLinks.classList.toggle('open'));

  // Populate artist select
  const artistSelect = document.querySelector('select[name="artist"]');
  if (artistSelect && typeof ARTISTS !== 'undefined') {
    ARTISTS.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a.name;
      opt.textContent = a.name;
      artistSelect.appendChild(opt);
    });

    // Pre-select from URL param
    const params = new URLSearchParams(window.location.search);
    const preArtist = params.get('artist');
    if (preArtist) {
      for (const opt of artistSelect.options) {
        if (opt.value === preArtist) { opt.selected = true; break; }
      }
    }
  }

  // Set min date to today
  const dateInput = document.querySelector('input[name="event_date"]');
  if (dateInput) {
    const today = new Date().toISOString().split('T')[0];
    dateInput.min = today;
  }

  // Handle form submission (Netlify)
  const form = document.getElementById('bookingForm');
  const success = document.getElementById('formSuccess');
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = new FormData(form);
      try {
        await fetch('/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(data).toString()
        });
        form.style.opacity = '0.4';
        form.style.pointerEvents = 'none';
        if (success) success.style.display = 'block';
      } catch (err) {
        console.error(err);
      }
    });
  }
})();
