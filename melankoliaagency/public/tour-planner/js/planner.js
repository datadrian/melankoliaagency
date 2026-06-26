/**
 * Melankolia Tour Planner — Main Planner Logic
 * Handles UI, form submissions, results rendering
 */

(function () {

  // ---- INIT ----
  document.addEventListener('DOMContentLoaded', () => {
    populateArtistDropdowns();
    initTabs();
    initForms();
    initChat();
    setDefaultDates();
  });

  function setDefaultDates() {
    const today = new Date();
    const future = new Date(today);
    future.setDate(today.getDate() + 14);
    const fmt = d => d.toISOString().split('T')[0];
    const sd = document.getElementById('startDate');
    const ed = document.getElementById('endDate');
    const osd = document.getElementById('optimizeStartDate');
    if (sd) sd.value = fmt(today);
    if (ed) ed.value = fmt(future);
    if (osd) osd.value = fmt(today);
  }

  function populateArtistDropdowns() {
    const artists = (typeof MELANKOLIA_DATA !== 'undefined' && MELANKOLIA_DATA.artists)
      ? MELANKOLIA_DATA.artists
      : (Array.isArray(MELANKOLIA_DATA) ? MELANKOLIA_DATA : []);

    const ids = ['artistSelect', 'optimizeArtist'];
    ids.forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      artists.forEach(a => {
        const opt = document.createElement('option');
        opt.value = a.name;
        opt.textContent = a.name;
        sel.appendChild(opt);
      });
    });

    // Pre-select from URL param
    const params = new URLSearchParams(window.location.search);
    const artist = params.get('artist');
    if (artist) {
      ids.forEach(id => {
        const sel = document.getElementById(id);
        if (sel) for (const o of sel.options) if (o.value === artist) { o.selected = true; break; }
      });
    }
  }

  // ---- TABS ----
  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('tab-' + btn.dataset.tab)?.classList.add('active');
      });
    });
  }

  // ---- LOADING STATE ----
  function setLoading(active, text = 'Generating...') {
    const el = document.getElementById('mapLoading');
    const txt = document.getElementById('mapLoadingText');
    if (el) el.classList.toggle('active', active);
    if (txt) txt.textContent = text;
  }

  function setButtonLoading(btnId, loading) {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.disabled = loading;
    if (loading) {
      btn.dataset.origText = btn.innerHTML;
      btn.innerHTML = '<div class="spinner" style="width:14px;height:14px;border-width:2px;margin:0 auto;"></div>';
    } else {
      btn.innerHTML = btn.dataset.origText || btn.innerHTML;
    }
  }

  // ---- FORMS ----
  function initForms() {
    document.getElementById('tourForm')?.addEventListener('submit', onGenerateTour);
    document.getElementById('optimizeBtn')?.addEventListener('click', onOptimizeRoute);
    document.getElementById('budgetBtn')?.addEventListener('click', onEstimateBudget);
    document.getElementById('venueBtn')?.addEventListener('click', onFindVenues);
  }

  // --- GENERATE TOUR ---
  async function onGenerateTour(e) {
    e.preventDefault();
    const artist = document.getElementById('artistSelect').value;
    const region = document.querySelector('input[name="region"]:checked')?.value;
    const startCity = document.getElementById('startCity').value.trim();
    const endCity = document.getElementById('endCity').value.trim();
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const numShows = document.getElementById('numShows').value;
    const budget = document.getElementById('budget').value.trim();
    const preferences = document.getElementById('preferences').value.trim();

    if (!artist || !startCity || !startDate || !endDate) {
      addChatMessage('ai', 'Please fill in artist, start city, and dates to generate a tour plan.');
      return;
    }

    setLoading(true, 'AI is planning your tour route...');
    setButtonLoading('generateBtn', true);
    addChatMessage('ai', `Generating tour plan for ${artist} — ${startCity} to ${endCity || 'loop'}, ${startDate} → ${endDate}...`);

    try {
      const tour = await API.ai('generate_tour', {
        artist, region, startCity, endCity, startDate, endDate,
        budget, numShows: parseInt(numShows) || undefined, preferences
      });

      renderTourResults(tour);
      await MapController.renderTourLegs(tour.legs);
      addChatMessage('ai', `Done. "${tour.tour_name}" — ${tour.total_shows} shows, ${tour.estimated_total_km?.toLocaleString() || '?'}km total. ${tour.warnings?.length ? `⚠ ${tour.warnings[0]}` : 'Route looks clean.'}`);

      // Store context for chat
      window._tourContext = `Tour: "${tour.tour_name}" for ${artist}. ${tour.summary} Cities: ${tour.legs.filter(l => !l.day_off).map(l => l.city).join(', ')}.`;

    } catch (err) {
      console.error(err);
      addChatMessage('ai', `Error generating tour: ${err.message}. Please try again.`);
      setResults('<div class="warning-item">Failed to generate tour plan. Check console for details.</div>');
    } finally {
      setLoading(false);
      setButtonLoading('generateBtn', false);
    }
  }

  // --- OPTIMIZE ROUTE ---
  async function onOptimizeRoute() {
    const artist = document.getElementById('optimizeArtist').value;
    const citiesRaw = document.getElementById('optimizeCities').value.trim();
    const startDate = document.getElementById('optimizeStartDate').value;

    if (!citiesRaw) {
      addChatMessage('ai', 'Enter at least 3 cities to optimize.');
      return;
    }

    const cities = citiesRaw.split('\n').map(c => c.trim()).filter(Boolean);
    if (cities.length < 2) {
      addChatMessage('ai', 'Need at least 2 cities to optimize.');
      return;
    }

    setLoading(true, 'Optimizing route order...');
    setButtonLoading('optimizeBtn', true);

    try {
      const result = await API.ai('optimize_route', { artist, cities, startDate });
      renderOptimizeResults(result);

      // Render on map
      if (result.optimized_order) {
        const legs = result.day_by_day?.map((d, i) => ({
          day: d.day,
          city: d.city,
          country: '',
          is_anchor_show: i === 0 || i === result.day_by_day.length - 1,
          day_off: false,
          drive_from_previous_km: d.drive_km,
          notes: d.note
        })) || result.optimized_order.map((city, i) => ({ day: i+1, city, country: '', is_anchor_show: false, day_off: false }));
        await MapController.renderTourLegs(legs);
      }

      addChatMessage('ai', `Route optimized. Saved ${result.savings_km || 0}km vs naive ordering. ${result.problem_cities?.length ? `⚠ Watch: ${result.problem_cities.join(', ')}` : 'No major routing issues.'}`);
    } catch (err) {
      addChatMessage('ai', `Optimization failed: ${err.message}`);
    } finally {
      setLoading(false);
      setButtonLoading('optimizeBtn', false);
    }
  }

  // --- ESTIMATE BUDGET ---
  async function onEstimateBudget() {
    const region = document.getElementById('budgetRegion').value;
    const numPeople = parseInt(document.getElementById('budgetPeople').value) || 4;
    const numDays = parseInt(document.getElementById('budgetDays').value) || 10;
    const citiesRaw = document.getElementById('budgetCities').value.trim();
    const vanRental = document.getElementById('vanRental').checked;
    const cities = citiesRaw.split('\n').map(c => c.trim()).filter(Boolean);

    setLoading(true, 'Calculating budget estimate...');
    setButtonLoading('budgetBtn', true);

    try {
      const result = await API.ai('estimate_budget', { region, numPeople, numDays, cities, vanRental });
      renderBudgetResults(result);
      addChatMessage('ai', `Budget estimate: ~$${result.total_estimated_cost_usd?.toLocaleString() || '?'} for ${numDays} days. Need ${result.minimum_guarantee_needed_per_show_usd ? '$' + result.minimum_guarantee_needed_per_show_usd.toLocaleString() : '?'}/show to break even.`);
    } catch (err) {
      addChatMessage('ai', `Budget estimation failed: ${err.message}`);
    } finally {
      setLoading(false);
      setButtonLoading('budgetBtn', false);
    }
  }

  // --- FIND VENUES ---
  async function onFindVenues() {
    const city = document.getElementById('venueCity').value.trim();
    const country = document.getElementById('venueCountry').value.trim();
    const genre = document.getElementById('venueGenre').value;
    const capacity = document.getElementById('venueCapacity').value;

    if (!city) {
      addChatMessage('ai', 'Enter a city to find venues.');
      return;
    }

    setLoading(true, `Searching venues in ${city}...`);
    setButtonLoading('venueBtn', true);

    try {
      const venues = await API.ai('suggest_venues', { city, country, genre, capacity });
      renderVenueResults(venues, city, country);
      await MapController.renderVenueMarkers(venues, `${city}, ${country}`);
      addChatMessage('ai', `Found ${venues.length} underground venues in ${city} suited for ${genre}.`);
    } catch (err) {
      addChatMessage('ai', `Venue search failed: ${err.message}`);
    } finally {
      setLoading(false);
      setButtonLoading('venueBtn', false);
    }
  }

  // ---- RENDER FUNCTIONS ----

  function setResults(html) {
    document.getElementById('resultsArea').innerHTML = html;
  }

  function renderTourResults(tour) {
    const legsHtml = tour.legs.map((leg, i) => `
      <div class="leg-item" data-index="${i}" onclick="PlannerUI.focusLeg(${i})">
        <div class="leg-day">D${leg.day}</div>
        <div class="leg-dot-col">
          <div class="leg-dot ${leg.is_anchor_show ? 'anchor-dot' : leg.day_off ? 'dayoff-dot' : 'show-dot'}"></div>
          ${i < tour.legs.length - 1 ? '<div class="leg-connector"></div>' : ''}
        </div>
        <div class="leg-info">
          <div class="leg-city">${leg.city}${leg.country ? `, <span style="color:#666;font-weight:400">${leg.country}</span>` : ''}</div>
          <div class="leg-date">${leg.date || ''}</div>
          ${leg.drive_from_previous_km ? `<div class="leg-drive">↑ ${leg.drive_from_previous_km}km / ~${leg.drive_hours || '?'}h drive</div>` : ''}
          ${leg.notes ? `<div class="leg-note">${leg.notes}</div>` : ''}
        </div>
        ${leg.is_anchor_show ? '<div class="leg-badge badge-anchor">Anchor</div>' : ''}
        ${leg.day_off ? '<div class="leg-badge badge-off">Off</div>' : ''}
      </div>
    `).join('');

    const warningsHtml = tour.warnings?.length
      ? `<div class="section-label">Warnings</div>${tour.warnings.map(w => `<div class="warning-item">${w}</div>`).join('')}` : '';

    const tipsHtml = tour.ai_tips?.length
      ? `<div class="section-label">AI Tips</div>${tour.ai_tips.map(t => `<div class="tip-item">${t}</div>`).join('')}` : '';

    const gapsHtml = tour.gaps?.length
      ? `<div class="section-label">Potential Gaps to Fill</div><div class="tip-item">${tour.gaps.join(' · ')}</div>` : '';

    setResults(`
      <div class="tour-header">
        <div class="tour-name">${tour.tour_name}</div>
        <div class="tour-summary">${tour.summary}</div>
        <div class="tour-stats">
          <div class="stat-pill"><div class="num">${tour.total_shows}</div><div class="lbl">Shows</div></div>
          <div class="stat-pill"><div class="num">${tour.total_days}</div><div class="lbl">Days</div></div>
          <div class="stat-pill"><div class="num">${(tour.estimated_total_km||0).toLocaleString()}</div><div class="lbl">km</div></div>
          <div class="stat-pill"><div class="num">${tour.routing_model?.replace('_',' ') || '—'}</div><div class="lbl">Strategy</div></div>
        </div>
      </div>
      <div class="section-label">Itinerary</div>
      <div class="itinerary">${legsHtml}</div>
      ${gapsHtml}
      ${warningsHtml}
      ${tipsHtml}
    `);
  }

  function renderOptimizeResults(result) {
    const citiesHtml = result.day_by_day?.map((d, i) => `
      <div class="opt-city">
        <div class="opt-num">${d.day}</div>
        <div class="opt-city-name">${d.city}</div>
        <div class="opt-drive">${d.drive_km ? d.drive_km + 'km' : '—'}</div>
      </div>
    `).join('') || result.optimized_order?.map((c, i) => `
      <div class="opt-city">
        <div class="opt-num">${i+1}</div>
        <div class="opt-city-name">${c}</div>
      </div>
    `).join('') || '';

    const problemsHtml = result.problem_cities?.length
      ? `<div class="section-label">Problem Cities</div>${result.problem_cities.map(c => `<div class="warning-item">${c}</div>`).join('')}` : '';

    const suggestHtml = result.suggested_additions?.length
      ? `<div class="section-label">Suggested Additions</div><div class="tip-item">${result.suggested_additions.join(' · ')}</div>` : '';

    setResults(`
      <div class="tour-header">
        <div class="tour-name">Optimized Route</div>
        <div class="tour-summary">${result.routing_strategy || ''}</div>
        <div class="tour-stats">
          <div class="stat-pill"><div class="num">${(result.total_km_optimized||0).toLocaleString()}</div><div class="lbl">Opt. km</div></div>
          <div class="stat-pill"><div class="num">${(result.savings_km||0).toLocaleString()}</div><div class="lbl">Saved km</div></div>
        </div>
      </div>
      <div class="section-label">Optimized Order</div>
      <div class="optimize-cities">${citiesHtml}</div>
      ${suggestHtml}
      ${problemsHtml}
    `);
  }

  function renderBudgetResults(result) {
    const db = result.daily_breakdown || {};
    const tipsHtml = result.tips?.map(t => `<div class="tip-item">${t}</div>`).join('') || '';

    setResults(`
      <div class="budget-total">
        <div class="big-num">$${(result.total_estimated_cost_usd||0).toLocaleString()}</div>
        <div class="big-lbl">Estimated Total</div>
      </div>
      <div class="section-label">Daily Breakdown</div>
      <div class="budget-row"><span class="lbl">Fuel</span><span class="val">$${db.fuel_per_day_usd || '—'}/day</span></div>
      <div class="budget-row"><span class="lbl">Lodging</span><span class="val">$${db.lodging_per_person_per_day_usd || '—'}/person/day</span></div>
      <div class="budget-row"><span class="lbl">Food</span><span class="val">$${db.food_per_person_per_day_usd || '—'}/person/day</span></div>
      ${db.van_rental_per_day_usd ? `<div class="budget-row"><span class="lbl">Van Rental</span><span class="val">$${db.van_rental_per_day_usd}/day</span></div>` : ''}
      <div class="section-label">Break Even</div>
      <div class="budget-row"><span class="lbl">Min. guarantee / show</span><span class="val">$${(result.minimum_guarantee_needed_per_show_usd||0).toLocaleString()}</span></div>
      <div class="budget-row"><span class="lbl">Shows to break even</span><span class="val">${result.break_even_shows || '—'}</span></div>
      ${tipsHtml ? `<div class="section-label">Cost-Saving Tips</div>${tipsHtml}` : ''}
    `);
  }

  function renderVenueResults(venues, city, country) {
    if (!venues?.length) {
      setResults('<div class="warning-item">No venues found. Try a different city or genre.</div>');
      return;
    }

    const html = venues.map(v => `
      <div class="venue-card">
        <div class="venue-name">${v.name}</div>
        <div class="venue-address">${v.address || ''}</div>
        <div class="venue-meta">
          ${v.type ? `<span class="venue-tag">${v.type}</span>` : ''}
          ${v.capacity ? `<span class="venue-tag">${v.capacity} cap</span>` : ''}
        </div>
        ${v.notes ? `<div class="venue-note">${v.notes}</div>` : ''}
        ${v.booking_tip ? `<div class="venue-tip">→ ${v.booking_tip}</div>` : ''}
      </div>
    `).join('');

    setResults(`
      <div class="section-label">Venues in ${city}${country ? ', ' + country : ''}</div>
      ${html}
    `);
  }

  // ---- CHAT ----
  function initChat() {
    const input = document.getElementById('chatInput');
    const btn = document.getElementById('chatSendBtn');
    const send = () => {
      const msg = input?.value.trim();
      if (!msg) return;
      input.value = '';
      onChat(msg);
    };
    btn?.addEventListener('click', send);
    input?.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
  }

  async function onChat(message) {
    addChatMessage('user', message);
    try {
      const result = await API.ai('chat', {
        message,
        context: window._tourContext || ''
      });
      addChatMessage('ai', result.reply);
    } catch (err) {
      addChatMessage('ai', 'Sorry, something went wrong. Try again.');
    }
  }

  function addChatMessage(type, text) {
    const box = document.getElementById('chatMessages');
    if (!box) return;
    const div = document.createElement('div');
    div.className = type === 'user' ? 'user-msg' : 'ai-msg';
    div.textContent = text;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
  }

  // ---- PUBLIC ----
  window.PlannerUI = {
    focusLeg: async (i) => {
      // Pan map to the clicked leg's city
      const legs = document.querySelectorAll('.leg-item');
      legs.forEach(l => l.style.background = '');
      legs[i]?.style.setProperty('background', 'rgba(200,169,110,0.08)');
    },
    addChatMessage
  };

})();
