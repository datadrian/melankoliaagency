/**
 * Melankolia Agency — Admin Advancing Tab
 * Handles: show creation, band management, promoter links,
 * pending review, approve, publish, notifications dashboard.
 */

const ADV_API = '/.netlify/functions/advancing-api';
let _advInited = false;
let _agencyToken = null;
let _advShows = [];
let _advBands = [];
let _advTours = [];
let _advNotifs = [];
let _currentShowId = null;

// Called when the Advancing tab is activated
async function initAdvancing() {
  if (_advInited) { await loadAdvancingDashboard(); return; }
  _advInited = true;

  // Agency token stored in sessionStorage for convenience
  _agencyToken = sessionStorage.getItem('mk_agency_token');
  if (!_agencyToken) { renderAdvancingLogin(); return; }
  await loadAdvancingDashboard();
}

// ── TOKEN LOGIN ───────────────────────────────────────

function renderAdvancingLogin() {
  const el = document.getElementById('view-advancing');
  if (!el) return;
  el.innerHTML = `
    <div style="max-width:360px;margin:80px auto;padding:0 16px;">
      <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#c8a96e;margin-bottom:24px;">Advancing Admin</div>
      <div style="margin-bottom:12px;">
        <label style="display:block;font-size:10px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#888;margin-bottom:6px;">Admin Token</label>
        <input type="password" id="adv-token-input" style="width:100%;padding:10px 12px;background:#f5f5f5;border:1px solid #ddd;font-size:14px;border-radius:2px;" placeholder="Enter agency admin token">
      </div>
      <button onclick="advTokenLogin()" style="width:100%;padding:11px;background:#c8a96e;color:#000;border:none;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Access Advancing Panel</button>
      <div id="adv-token-error" style="color:#c00;font-size:12px;margin-top:8px;"></div>
    </div>`;
}

async function advTokenLogin() {
  const token = document.getElementById('adv-token-input').value.trim();
  if (!token) return;
  // Verify by hitting the API
  const res = await advApi({ action: 'agency_get_dashboard' }, token);
  if (res.success) {
    _agencyToken = token;
    sessionStorage.setItem('mk_agency_token', token);
    await loadAdvancingDashboard();
  } else {
    document.getElementById('adv-token-error').textContent = 'Invalid token.';
  }
}

// ── DASHBOARD ─────────────────────────────────────────

async function loadAdvancingDashboard() {
  const el = document.getElementById('view-advancing');
  if (!el) return;
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div class="spinner"></div></div>`;

  const [dashRes, bandsRes, toursRes] = await Promise.all([
    advApi({ action: 'agency_get_dashboard' }),
    advApi({ action: 'agency_list_bands' }),
    advApi({ action: 'agency_list_tours' }),
  ]);

  if (!dashRes.success) { renderAdvancingLogin(); return; }

  _advShows = dashRes.data.shows || [];
  _advNotifs = dashRes.data.notifications || [];
  _advBands = bandsRes.success ? bandsRes.data : [];
  _advTours = toursRes.success ? toursRes.data : [];
  const counts = dashRes.data.counts || {};

  const unread = _advNotifs.filter(n => !n.resolved).length;

  el.innerHTML = `
    <div style="padding:20px;">

      <!-- Header row -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:10px;">
        <div style="font-family:monospace;font-size:10px;font-weight:700;letter-spacing:0.25em;text-transform:uppercase;color:#c8a96e;">Advancing</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${unread ? `<button class="qa-btn" style="background:#fff3cd;border-color:#ffc107;" onclick="advScrollToNotifs()">⚠ ${unread} Pending Review</button>` : ''}
          <button class="qa-btn" onclick="advShowCreateShow()">+ New Show</button>
          <button class="qa-btn" onclick="advShowCreateBand()">+ Add Band</button>
          <button class="qa-btn" onclick="advShowCreateTour()">+ New Tour</button>
        </div>
      </div>

      <!-- Status counts -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin-bottom:24px;">
        ${advCountCard('Draft', counts.draft || 0, '#888')}
        ${advCountCard('Awaiting Promoter', counts.pending_promoter || 0, '#888')}
        ${advCountCard('Pending Review', counts.pending_review || 0, '#c8a96e')}
        ${advCountCard('Approved', counts.approved || 0, '#5a9')}
        ${advCountCard('Published', counts.published || 0, '#4a8')}
      </div>

      <!-- Notifications / pending submissions -->
      ${_advNotifs.filter(n=>!n.resolved).length ? `
      <div id="adv-notifs-section" style="margin-bottom:24px;">
        <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e8e5e0;">Needs Attention</div>
        ${_advNotifs.filter(n=>!n.resolved).map(n => advNotifCard(n)).join('')}
      </div>` : ''}

      <!-- Shows list -->
      <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid #e8e5e0;">All Shows</div>
      ${_advShows.length ? _advShows.map(s => advShowRow(s)).join('') : '<div style="color:#aaa;font-size:13px;padding:20px 0;">No shows yet. Create one above.</div>'}

      <!-- Bands section -->
      <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;margin:24px 0 10px;padding-bottom:6px;border-bottom:1px solid #e8e5e0;">Band Logins</div>
      ${_advBands.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:8px;">${_advBands.map(b => advBandCard(b)).join('')}</div>` : '<div style="color:#aaa;font-size:13px;">No bands added yet.</div>'}
    </div>`;
}

function advCountCard(label, count, color) {
  return `<div style="background:#fff;border:1px solid #e8e5e0;border-radius:3px;padding:12px;text-align:center;">
    <div style="font-size:22px;font-weight:700;color:${color};">${count}</div>
    <div style="font-size:10px;color:#aaa;margin-top:2px;">${label}</div>
  </div>`;
}

function advNotifCard(n) {
  const severity = n.severity === 'high' ? '#c00' : n.severity === 'medium' ? '#c8a96e' : '#888';
  return `<div style="background:#fffdf7;border:1px solid #f0e8d0;border-left:3px solid ${severity};border-radius:3px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">
    <div style="flex:1;">
      <div style="font-size:13px;color:#333;line-height:1.5;">${escHtmlAdv(n.message)}</div>
      <div style="font-size:10px;color:#aaa;margin-top:4px;">${relTimeAdv(n.created_at)}</div>
    </div>
    <div style="display:flex;gap:6px;flex-shrink:0;">
      ${n.show_id ? `<button class="qa-btn" onclick="advOpenShow('${n.show_id}')">Review</button>` : ''}
      <button class="qa-btn" style="color:#aaa;" onclick="advResolveNotif('${n.id}')">Dismiss</button>
    </div>
  </div>`;
}

function advShowRow(s) {
  const statusColors = { draft:'#aaa', pending_promoter:'#888', pending_review:'#c8a96e', approved:'#5a9', published:'#4a8' };
  const color = statusColors[s.status] || '#aaa';
  const band = _advBands.find(b => s.band_ids?.includes(b.id));
  return `<div style="background:#fff;border:1px solid #e8e5e0;border-radius:3px;padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;justify-content:space-between;gap:12px;cursor:pointer;" onclick="advOpenShow('${s.id}')">
    <div style="flex:1;min-width:0;">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span style="font-size:14px;font-weight:600;color:#222;">${escHtmlAdv(s.venue_name)}</span>
        <span style="font-family:monospace;font-size:8px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${color};background:${color}18;border:1px solid ${color}44;padding:2px 6px;border-radius:2px;">${s.status.replace('_',' ')}</span>
        ${s._pending_notifications ? `<span style="background:#c8a96e;color:#000;font-size:9px;font-weight:700;padding:2px 6px;border-radius:10px;">${s._pending_notifications}</span>` : ''}
      </div>
      <div style="font-size:12px;color:#888;margin-top:3px;">${escHtmlAdv(s.date)} · ${escHtmlAdv([s.city,s.country].filter(Boolean).join(', '))}${band ? ` · ${escHtmlAdv(band.name)}` : ''}</div>
    </div>
    <div style="color:#ccc;font-size:14px;flex-shrink:0;">›</div>
  </div>`;
}

function advBandCard(b) {
  return `<div style="background:#fff;border:1px solid #e8e5e0;border-radius:3px;padding:10px 12px;">
    <div style="font-size:13px;font-weight:600;color:#222;margin-bottom:2px;">${escHtmlAdv(b.name)}</div>
    <div style="font-family:monospace;font-size:10px;color:#aaa;">@${escHtmlAdv(b.username)}</div>
    <button class="qa-btn" style="margin-top:8px;font-size:9px;" onclick="advResetBandPassword('${b.id}','${escHtmlAdv(b.name)}')">Reset Password</button>
  </div>`;
}

// ── SHOW DETAIL / EDIT ────────────────────────────────

async function advOpenShow(show_id) {
  _currentShowId = show_id;
  const el = document.getElementById('view-advancing');
  el.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:200px;"><div class="spinner"></div></div>`;

  const res = await advApi({ action: 'agency_get_show', show_id });
  if (!res.success) { el.innerHTML = '<div style="padding:20px;color:#c00;">Failed to load show.</div>'; return; }

  const show = res.data;
  const sheet = show.sheets?.[0] || {};
  const promoterUrl = show.promoter_url || '';
  const canApprove = ['draft','pending_review','pending_promoter'].includes(show.status);
  const canPublish = show.status === 'approved';
  const band = _advBands.find(b => show.band_ids?.includes(b.id));

  el.innerHTML = `
    <div style="padding:20px;max-width:760px;">
      <button onclick="loadAdvancingDashboard()" style="background:none;border:none;color:#888;font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;cursor:pointer;padding:0 0 16px;display:flex;align-items:center;gap:4px;">← Back</button>

      <!-- Show header -->
      <div style="margin-bottom:20px;">
        <div style="font-size:20px;font-weight:700;color:#222;">${escHtmlAdv(show.venue_name)}</div>
        <div style="font-size:13px;color:#888;margin-top:3px;">${escHtmlAdv(show.date)} · ${escHtmlAdv([show.city,show.country].filter(Boolean).join(', '))}${band ? ` · <strong>${escHtmlAdv(band.name)}</strong>` : ''}</div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
          ${canApprove ? `<button class="qa-btn" style="background:#c8a96e;color:#000;font-weight:700;" onclick="advApproveSheet('${show.id}')">✓ Approve Sheet</button>` : ''}
          ${canPublish ? `<button class="qa-btn" style="background:#2d6a4f;color:#fff;font-weight:700;" onclick="advPublishSheet('${show.id}')">▶ Publish to Band</button>` : ''}
          <button class="qa-btn" onclick="advCopyLink('${promoterUrl}')">📋 Copy Promoter Link</button>
          <button class="qa-btn" onclick="advSendPromoterEmail('${show.id}')">✉ Email Promoter Link</button>
        </div>
        ${promoterUrl ? `<div style="margin-top:8px;font-size:11px;color:#aaa;word-break:break-all;">Promoter link: <a href="${promoterUrl}" target="_blank" style="color:#c8a96e;">${promoterUrl}</a></div>` : ''}
      </div>

      <!-- Submissions inbox -->
      ${show.submissions?.length ? `
      <div style="margin-bottom:20px;">
        <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;margin-bottom:10px;">Promoter Submission${show.submissions.length > 1 ? 's' : ''}</div>
        ${show.submissions.map(sub => `
          <div style="background:#fffdf7;border:1px solid #f0e8d0;border-radius:3px;padding:12px 14px;margin-bottom:8px;font-size:12px;color:#555;">
            Submitted ${relTimeAdv(sub.submitted_at)}
            ${sub.validation_gaps?.length ? `<span style="color:#c00;margin-left:8px;">⚠ Missing: ${sub.validation_gaps.join(', ')}</span>` : '<span style="color:#2d6a4f;margin-left:8px;">✓ Complete</span>'}
          </div>`).join('')}
      </div>` : ''}

      <!-- Advancing sheet editor -->
      <div style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#888;margin-bottom:12px;padding-bottom:6px;border-bottom:1px solid #e8e5e0;">Advancing Sheet <span style="color:#c8a96e;">${show.status.replace(/_/g,' ').toUpperCase()}</span></div>
      <form id="adv-sheet-form">
        ${advSheetEditor(sheet)}
        <div style="margin-top:16px;display:flex;gap:8px;">
          <button type="button" class="qa-btn" style="background:#c8a96e;color:#000;" onclick="advSaveSheet('${show.id}')">Save Sheet</button>
          <button type="button" class="qa-btn" style="color:#c00;" onclick="advSetStatus('${show.id}','pending_promoter')">Mark: Awaiting Promoter</button>
        </div>
      </form>
    </div>`;
}

function advSheetEditor(s) {
  const field = (label, name, value, type='text', placeholder='') =>
    `<div style="display:flex;flex-direction:column;gap:4px;">
      <label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;">${label}</label>
      <input type="${type}" name="${name}" value="${escHtmlAdv(value||'')}" placeholder="${placeholder}" style="padding:8px 10px;border:1px solid #ddd;background:#fafaf8;font-size:13px;border-radius:2px;">
    </div>`;
  const textarea = (label, name, value) =>
    `<div style="display:flex;flex-direction:column;gap:4px;">
      <label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;">${label}</label>
      <textarea name="${name}" rows="2" style="padding:8px 10px;border:1px solid #ddd;background:#fafaf8;font-size:13px;border-radius:2px;resize:vertical;">${escHtmlAdv(value||'')}</textarea>
    </div>`;
  const grid2 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">${fields.join('')}</div>`;
  const grid3 = (...fields) => `<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;">${fields.join('')}</div>`;
  const section = (title) => `<div style="font-family:monospace;font-size:8px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;margin:16px 0 8px;padding-bottom:5px;border-bottom:1px solid #f0ece5;">${title}</div>`;

  return `
    ${section('Schedule')}
    ${grid2(field('Load-In','load_in_time',s.load_in_time,'time'), field('Soundcheck','soundcheck_time',s.soundcheck_time,'time'))}
    ${grid2(field('Doors','doors_time',s.doors_time,'time'), field('Showtime','showtime',s.showtime,'time'))}
    ${grid2(field('Set Length (min)','set_length_mins',s.set_length_mins,'number'), field('Curfew','curfew_time',s.curfew_time,'time'))}

    ${section('Promoter & Contacts')}
    ${grid3(field('Promoter Name','promoter_name',s.promoter?.name,'text'), field('Promoter Email','promoter_email',s.promoter?.email,'email'), field('Promoter Phone','promoter_phone',s.promoter?.phone,'tel'))}
    ${grid2(field('Day-Of Contact','day_of_name',s.day_of_contact?.name,'text'), field('Day-Of Phone','day_of_phone',s.day_of_contact?.phone,'tel'))}
    ${grid2(field('Sound Engineer','sound_engineer_name',s.sound_engineer?.name,'text'), field('Engineer Contact','sound_engineer_contact',s.sound_engineer?.contact,'text'))}

    ${section('Technical')}
    ${grid2(textarea('PA / House Specs','pa_specs',s.pa_specs), field('Monitoring','monitoring',s.monitoring))}

    ${section('Guest List')}
    ${grid3(field('Spots','guestlist_spots',s.guest_list?.spots,'number'), field('Deadline','guestlist_deadline',s.guest_list?.deadline), field('Send List To','guestlist_send_to',s.guest_list?.send_to))}

    ${section('Merch')}
    ${grid2(field('Venue Cut %','merch_cut_pct',s.merch?.venue_cut_pct,'number'), field('Settlement Contact','merch_settlement_contact',s.merch?.settlement_contact))}

    ${section('Settlement')}
    ${grid3(field('Method','settlement_method',s.settlement?.method), field('Who Pays','settlement_who_pays',s.settlement?.who_pays), field('When','settlement_when',s.settlement?.when))}

    ${section('Hotel')}
    ${grid2(field('Hotel Name','hotel_name',s.hotel?.name), field('Hotel Address','hotel_address',s.hotel?.address))}
    ${grid3(field('Check-In','hotel_check_in',s.hotel?.check_in), field('Check-Out','hotel_check_out',s.hotel?.check_out), field('Confirmation #','hotel_confirmation',s.hotel?.confirmation_no))}

    ${section('Hospitality & Logistics')}
    ${grid2(textarea('Catering Rider','catering_rider',s.catering_rider), textarea('Parking','parking_instructions',s.parking_instructions))}
    ${grid2(field('WiFi Network','wifi_network',s.wifi?.network), field('WiFi Password','wifi_password',s.wifi?.password))}
    ${grid2(textarea('Green Room','green_room_info',s.green_room_info), textarea('Additional Notes','additional_notes',s.additional_notes))}
  `;
}

async function advSaveSheet(show_id) {
  const form = document.getElementById('adv-sheet-form');
  const fd = new FormData(form);
  const sheet_data = {
    load_in_time: fd.get('load_in_time'), soundcheck_time: fd.get('soundcheck_time'),
    doors_time: fd.get('doors_time'), showtime: fd.get('showtime'),
    set_length_mins: fd.get('set_length_mins'), curfew_time: fd.get('curfew_time'),
    promoter: { name: fd.get('promoter_name'), email: fd.get('promoter_email'), phone: fd.get('promoter_phone') },
    day_of_contact: { name: fd.get('day_of_name'), phone: fd.get('day_of_phone') },
    sound_engineer: { name: fd.get('sound_engineer_name'), contact: fd.get('sound_engineer_contact') },
    pa_specs: fd.get('pa_specs'), monitoring: fd.get('monitoring'),
    guest_list: { spots: fd.get('guestlist_spots'), deadline: fd.get('guestlist_deadline'), send_to: fd.get('guestlist_send_to') },
    merch: { venue_cut_pct: fd.get('merch_cut_pct'), settlement_contact: fd.get('merch_settlement_contact') },
    settlement: { method: fd.get('settlement_method'), who_pays: fd.get('settlement_who_pays'), when: fd.get('settlement_when') },
    hotel: { name: fd.get('hotel_name'), address: fd.get('hotel_address'), check_in: fd.get('hotel_check_in'), check_out: fd.get('hotel_check_out'), confirmation_no: fd.get('hotel_confirmation') },
    catering_rider: fd.get('catering_rider'), parking_instructions: fd.get('parking_instructions'),
    wifi: { network: fd.get('wifi_network'), password: fd.get('wifi_password') },
    green_room_info: fd.get('green_room_info'), additional_notes: fd.get('additional_notes'),
  };
  const res = await advApi({ action: 'agency_update_sheet', show_id, sheet_data });
  if (res.success) { showToast('Sheet saved ✓'); } else { showToast('Save failed: ' + res.error, 'error'); }
}

async function advApproveSheet(show_id) {
  if (!confirm('Approve this advancing sheet? It will be ready to publish to the band.')) return;
  const res = await advApi({ action: 'agency_approve_sheet', show_id, reviewed_by: 'agency' });
  if (res.success) { showToast('Approved ✓'); await advOpenShow(show_id); }
  else showToast('Error: ' + res.error, 'error');
}

async function advPublishSheet(show_id) {
  if (!confirm('Publish this advancing sheet to the band app? They will be notified.')) return;
  const res = await advApi({ action: 'agency_publish_sheet', show_id });
  if (res.success) {
    showToast(`Published ✓ — ${res.data.notified_bands} band(s) notified`);

    // Fire email notifications to bands
    const showRes = await advApi({ action: 'agency_get_show', show_id });
    if (showRes.success) {
      const show = showRes.data;
      for (const band_id of (show.band_ids || [])) {
        const band = _advBands.find(b => b.id === band_id);
        if (band?.contacts?.[0]?.email) {
          fetch('/.netlify/functions/advancing-notify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'band_published', show: { venue_name: show.venue_name, city: show.city, date: show.date }, band_email: band.contacts[0].email, band_name: band.name })
          }).catch(() => {});
        }
      }
    }
    await advOpenShow(show_id);
  } else showToast('Error: ' + res.error, 'error');
}

async function advSetStatus(show_id, status) {
  const res = await advApi({ action: 'agency_set_show_status', show_id, status });
  if (res.success) { showToast('Status updated'); await advOpenShow(show_id); }
}

async function advResolveNotif(notif_id) {
  await advApi({ action: 'agency_resolve_notification', notification_id: notif_id });
  await loadAdvancingDashboard();
}

// ── CREATE MODALS ─────────────────────────────────────

function advShowCreateShow() {
  const tourOptions = _advTours.map(t => `<option value="${t.id}">${escHtmlAdv(t.name)}</option>`).join('');
  const bandOptions = _advBands.map(b => `<option value="${b.id}">${escHtmlAdv(b.name)}</option>`).join('');
  showAdvModal('Create Show', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Tour</label>
        <select id="new-show-tour" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"><option value="">No tour</option>${tourOptions}</select></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Band *</label>
        <select id="new-show-band" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"><option value="">Select...</option>${bandOptions}</select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Venue Name *</label>
        <input type="text" id="new-show-venue" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="Venue name"></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Date *</label>
        <input type="date" id="new-show-date" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">City</label>
        <input type="text" id="new-show-city" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="City"></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Country</label>
        <input type="text" id="new-show-country" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="Country"></div>
    </div>
    <div style="margin-bottom:10px;"><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Venue Address</label>
      <input type="text" id="new-show-addr" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="Full address"></div>
    <div id="new-show-error" style="color:#c00;font-size:12px;margin-top:4px;"></div>
  `, advCreateShowSubmit);
}

async function advCreateShowSubmit() {
  const tour_id = document.getElementById('new-show-tour').value;
  const band_id = document.getElementById('new-show-band').value;
  const venue_name = document.getElementById('new-show-venue').value.trim();
  const date = document.getElementById('new-show-date').value;
  const city = document.getElementById('new-show-city').value.trim();
  const country = document.getElementById('new-show-country').value.trim();
  const venue_address = document.getElementById('new-show-addr').value.trim();
  const errEl = document.getElementById('new-show-error');

  if (!band_id || !venue_name || !date) { errEl.textContent = 'Band, venue name and date are required.'; return; }

  const res = await advApi({ action: 'agency_create_show', tour_id: tour_id || null, band_ids: [band_id], date, venue_name, city, country, venue_address });
  if (res.success) {
    closeAdvModal();
    showToast('Show created ✓ — promoter link ready');
    await loadAdvancingDashboard();
    advOpenShow(res.data.show_id);
  } else { errEl.textContent = res.error; }
}

function advShowCreateBand() {
  showAdvModal('Add Band Login', `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Band Name *</label>
        <input type="text" id="new-band-name" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="e.g. Bootblacks"></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Username *</label>
        <input type="text" id="new-band-user" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="e.g. bootblacks" autocapitalize="none"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Password *</label>
        <input type="text" id="new-band-pass" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="Assign a password"></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Band Email (for notifications)</label>
        <input type="email" id="new-band-email" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="band@email.com"></div>
    </div>
    <div id="new-band-error" style="color:#c00;font-size:12px;"></div>
  `, advCreateBandSubmit);
}

async function advCreateBandSubmit() {
  const name = document.getElementById('new-band-name').value.trim();
  const username = document.getElementById('new-band-user').value.trim().toLowerCase();
  const password = document.getElementById('new-band-pass').value.trim();
  const email = document.getElementById('new-band-email').value.trim();
  const errEl = document.getElementById('new-band-error');
  if (!name || !username || !password) { errEl.textContent = 'Name, username and password are required.'; return; }
  const res = await advApi({ action: 'agency_create_band', name, username, password, contacts: email ? [{ email }] : [] });
  if (res.success) {
    closeAdvModal();
    showToast(`Band login created ✓ — @${username}`);
    await loadAdvancingDashboard();
  } else { errEl.textContent = res.error; }
}

function advShowCreateTour() {
  const bandOptions = _advBands.map(b => `<option value="${b.id}">${escHtmlAdv(b.name)}</option>`).join('');
  showAdvModal('Create Tour', `
    <div style="margin-bottom:10px;"><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Tour Name *</label>
      <input type="text" id="new-tour-name" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;" placeholder="e.g. Bootblacks EU Tour 2026"></div>
    <div style="margin-bottom:10px;"><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Band *</label>
      <select id="new-tour-band" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"><option value="">Select...</option>${bandOptions}</select></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">Start Date</label>
        <input type="date" id="new-tour-start" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"></div>
      <div><label style="font-size:10px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#888;display:block;margin-bottom:4px;">End Date</label>
        <input type="date" id="new-tour-end" style="width:100%;padding:8px;border:1px solid #ddd;font-size:13px;border-radius:2px;"></div>
    </div>
    <div id="new-tour-error" style="color:#c00;font-size:12px;"></div>
  `, advCreateTourSubmit);
}

async function advCreateTourSubmit() {
  const name = document.getElementById('new-tour-name').value.trim();
  const band_id = document.getElementById('new-tour-band').value;
  const start_date = document.getElementById('new-tour-start').value;
  const end_date = document.getElementById('new-tour-end').value;
  const errEl = document.getElementById('new-tour-error');
  if (!name || !band_id) { errEl.textContent = 'Name and band are required.'; return; }
  const res = await advApi({ action: 'agency_create_tour', name, band_id, start_date, end_date });
  if (res.success) { closeAdvModal(); showToast('Tour created ✓'); await loadAdvancingDashboard(); }
  else { errEl.textContent = res.error; }
}

async function advResetBandPassword(band_id, name) {
  const pw = prompt(`New password for ${name}:`);
  if (!pw) return;
  const res = await advApi({ action: 'agency_update_band_password', band_id, new_password: pw });
  if (res.success) showToast('Password updated ✓');
  else showToast('Error: ' + res.error, 'error');
}

// ── PROMOTER EMAIL ────────────────────────────────────

async function advSendPromoterEmail(show_id) {
  const showRes = await advApi({ action: 'agency_get_show', show_id });
  if (!showRes.success) return;
  const show = showRes.data;
  const to = prompt('Promoter email address:');
  if (!to) return;
  const deadline = prompt('Submission deadline (e.g. "1 week before show"):', '');
  fetch('/.netlify/functions/advancing-notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'advancing_request', to, show: { venue_name: show.venue_name, date: show.date }, promoter_url: show.promoter_url, deadline: deadline || '' })
  }).then(() => showToast('Email sent to promoter ✓')).catch(() => showToast('Email send failed', 'error'));
}

function advCopyLink(url) {
  navigator.clipboard.writeText(url).then(() => showToast('Link copied ✓')).catch(() => { prompt('Copy this link:', url); });
}

// ── MODAL HELPERS ─────────────────────────────────────

function showAdvModal(title, body, onConfirm) {
  const existing = document.getElementById('adv-modal');
  if (existing) existing.remove();
  const modal = document.createElement('div');
  modal.id = 'adv-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:4px;max-width:560px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 8px 32px rgba(0,0,0,0.2);">
      <div style="background:#080808;padding:14px 20px;border-bottom:2px solid #c8a96e;display:flex;align-items:center;justify-content:space-between;border-radius:4px 4px 0 0;">
        <span style="font-family:monospace;font-size:9px;font-weight:700;letter-spacing:0.2em;text-transform:uppercase;color:#c8a96e;">${title}</span>
        <button onclick="closeAdvModal()" style="background:none;border:none;color:#555;font-size:18px;cursor:pointer;line-height:1;">×</button>
      </div>
      <div style="padding:20px;">${body}</div>
      <div style="padding:0 20px 20px;display:flex;gap:8px;">
        <button onclick="(${onConfirm.name || 'arguments[0]'})()" style="padding:10px 20px;background:#c8a96e;color:#000;border:none;font-family:monospace;font-size:10px;font-weight:700;letter-spacing:0.15em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Confirm</button>
        <button onclick="closeAdvModal()" style="padding:10px 16px;background:#f5f5f5;color:#666;border:1px solid #ddd;font-family:monospace;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;cursor:pointer;border-radius:2px;">Cancel</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  // Store callback
  modal._onConfirm = onConfirm;
  modal.querySelector('button[onclick*="Confirm"]').onclick = onConfirm;
  modal.addEventListener('click', e => { if (e.target === modal) closeAdvModal(); });
}

function closeAdvModal() {
  const m = document.getElementById('adv-modal');
  if (m) m.remove();
}

function advScrollToNotifs() {
  const el = document.getElementById('adv-notifs-section');
  if (el) el.scrollIntoView({ behavior: 'smooth' });
}

// ── API WRAPPER ───────────────────────────────────────

async function advApi(body, token) {
  const t = token || _agencyToken;
  try {
    const res = await fetch(ADV_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agency-Token': t || '' },
      body: JSON.stringify(body)
    });
    return await res.json();
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ── UTILS ─────────────────────────────────────────────

function escHtmlAdv(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function relTimeAdv(iso) {
  if (!iso) return '';
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms/60000);
  if (m < 2) return 'just now';
  if (m < 60) return m + 'm ago';
  const h = Math.floor(m/60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h/24) + 'd ago';
}
function showToast(msg, type='success') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:${type==='error'?'#c00':'#080808'};color:#fff;padding:10px 20px;border-radius:3px;font-size:13px;z-index:99999;border:1px solid ${type==='error'?'#900':'#c8a96e'};box-shadow:0 4px 12px rgba(0,0,0,0.2);`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
