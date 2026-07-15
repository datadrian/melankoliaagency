/* ================================================
   MELANKOLIA — ARTIST MANAGER (admin)
   Edits artists.json in git via the save-artists function.
   Gallery (bucket) + tile/profile/banner roles, each with
   center point + zoom and a real crop preview.
   ================================================ */
(function () {
  'use strict';

  var API = '/.netlify/functions/save-artists';
  // Images are committed to git and deployed with the site — read same-origin.
  var CDN = '';
  var LINK_FIELDS = ['website', 'instagram', 'facebook', 'bandcamp', 'spotify', 'soundcloud', 'youtube', 'tiktok', 'apple', 'ra', 'bandsintown'];
  var ROLES = [
    { key: 'tile', label: 'Tile (homepage)', ratio: '1 / 1', sub: 'Square thumbnail in the artist grid' },
    { key: 'profile', label: 'Profile (artist page)', ratio: '1 / 1', sub: 'Main photo on the artist page' },
    { key: 'banner', label: 'Banner (page header)', ratio: '5 / 2', sub: 'Wide image behind the artist name' }
  ];

  var artists = [];
  var current = -1;
  var fresh = {};   // path -> dataURL just uploaded (instant preview)
  var dirty = false;

  function pw() { return sessionStorage.getItem('mk_admin_pw') || ''; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
  function sortArtists() {
    var sel = current >= 0 ? artists[current] : null;
    artists.sort(function (a, b) { return String(a.name || '').toLowerCase().localeCompare(String(b.name || '').toLowerCase()); });
    current = sel ? artists.indexOf(sel) : -1;
  }
  function setStatus(m, k) { var e = $('status'); e.textContent = m || ''; e.className = 'status' + (k ? ' ' + k : ''); }
  function imgUrl(path) { if (!path) return ''; if (fresh[path]) return fresh[path]; if (/^https?:|^data:/.test(path)) return path; return CDN + path; }

  var EMBED = /[?&]embed=1/.test(location.search);

  /* ---------- gate ---------- */
  function initGate() {
    // When embedded in the main dashboard, the dashboard already handled auth.
    if (EMBED) {
      if (!sessionStorage.getItem('mk_admin_pw')) sessionStorage.setItem('mk_admin_pw', 'melankolia2025');
      sessionStorage.setItem('mk_admin_ok', '1');
      var g = $('gate'); if (g) g.style.display = 'none';
      document.body.classList.add('embed');
      return load();
    }
    if (sessionStorage.getItem('mk_admin_ok') === '1') { $('gate').style.display = 'none'; return load(); }
    $('gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      sessionStorage.setItem('mk_admin_pw', $('gatePw').value);
      sessionStorage.setItem('mk_admin_ok', '1');
      $('gate').style.display = 'none';
      load();
    });
  }

  /* ---------- load ---------- */
  function load() {
    setStatus('Loading…');
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'get' }) })
      .then(function (r) { return r.json(); })
      .then(function (d) {
        if (d && d.success && (d.artists || []).length) { artists = d.artists; ready(); }
        else loadLocal();
      })
      .catch(loadLocal);
  }
  function loadLocal() {
    fetch('/artists.json', { cache: 'no-cache' }).then(function (r) { return r.json(); })
      .then(function (d) { artists = (d && d.artists) || []; ready(); })
      .catch(function (e) { setStatus('Load failed: ' + e.message, 'err'); });
  }
  function ready() {
    sortArtists();
    artists.forEach(normalize);
    setStatus(artists.length + ' artists loaded', 'ok');
    renderList();
  }
  function normalize(a) {
    a.links = a.links || {}; a.gallery = a.gallery || []; a.roles = a.roles || {};
    a.videos = a.videos || []; a.discography = a.discography || [];
  }

  /* ---------- list ---------- */
  function renderList() {
    var html = artists.map(function (a, i) {
      var r = (a.roles && (a.roles.tile || a.roles.profile)) || (a.gallery[0] ? { src: a.gallery[0] } : null);
      var t = r ? imgUrl(r.src) : '';
      var thumb = t ? '<img class="list-thumb" src="' + esc(t) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<div class="list-thumb"></div>';
      return '<div class="list-item ' + (i === current ? 'active' : '') + '" data-i="' + i + '">' + thumb + '<span class="list-name">' + esc(a.name || '(unnamed)') + '</span></div>';
    }).join('');
    html += '<div class="list-add"><button class="btn secondary" id="addBtn" style="width:100%">+ Add artist</button></div>';
    $('list').innerHTML = html;
    $('list').querySelectorAll('.list-item').forEach(function (el) { el.addEventListener('click', function () { current = parseInt(el.getAttribute('data-i'), 10); renderList(); renderEditor(); }); });
    $('addBtn').addEventListener('click', addArtist);
  }
  function addArtist() {
    artists.push({ slug: 'new-artist-' + Date.now().toString(36), name: 'New Artist', bio: '', shortBio: '', genres: '', location: '', status: 'active', featured: false, links: {}, videos: [], discography: [], gallery: [], roles: {} });
    var justAdded = artists[artists.length - 1]; sortArtists(); current = artists.indexOf(justAdded); dirty = true; renderList(); renderEditor();
  }

  /* ---------- editor ---------- */
  function renderEditor() {
    var a = artists[current];
    if (!a) { $('editor').className = 'editor empty'; $('editor').textContent = 'Select an artist to edit, or add a new one.'; return; }
    normalize(a);
    $('editor').className = 'editor';
    var linkRows = LINK_FIELDS.map(function (k) { return '<div class="field"><label>' + k + '</label><input data-link="' + k + '" value="' + esc(a.links[k] || '') + '" placeholder="https://…"></div>'; }).join('');

    $('editor').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:flex-end;gap:10px">' +
        '<div class="row" style="flex:1">' +
          '<div class="field" style="margin:0"><label>Name</label><input id="f_name" value="' + esc(a.name) + '"></div>' +
          '<div class="field" style="margin:0"><label>URL slug</label><input id="f_slug" value="' + esc(a.slug) + '"></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px"><button class="btn" id="researchBtn" title="Auto-fill bio, genres, links, discography & videos from AI research">✦ Research</button><button class="btn secondary" id="upBtn">↑</button><button class="btn secondary" id="dnBtn">↓</button><button class="btn danger" id="delBtn">Delete</button></div>' +
      '</div>' +

      '<h2 class="section">Photo gallery <span style="color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400">— every photo here appears on the EPK page</span></h2>' +
      '<div class="media-actions" style="margin-bottom:14px"><label class="upbtn">⬆ Upload photo(s)<input type="file" accept="image/*" multiple id="galFile" style="display:none"></label></div>' +
      '<div class="gallery" id="gallery"></div>' +

      '<h2 class="section">Roles, crop &amp; centering</h2>' +
      '<div class="roles" id="roles"></div>' +

      '<h2 class="section">Bio</h2>' +
      '<div class="row"><div class="field"><label>Genres</label><input id="f_genres" value="' + esc(a.genres) + '"></div><div class="field"><label>Location</label><input id="f_location" value="' + esc(a.location) + '"></div></div>' +
      '<div class="field"><label>Short bio (one line)</label><input id="f_shortBio" value="' + esc(a.shortBio) + '"></div>' +
      '<div class="field"><label>Full bio</label><textarea id="f_bio" rows="9">' + esc(a.bio) + '</textarea></div>' +

      '<h2 class="section">Links</h2>' + linkRows +
      '<h2 class="section">Videos (one YouTube URL per line)</h2><div class="field"><textarea id="f_videos" rows="5">' + esc((a.videos || []).join('\n')) + '</textarea></div>' +
      '<h2 class="section">Discography <span style="color:var(--muted);text-transform:none;letter-spacing:0;font-weight:400">— shown on the artist page</span></h2>' +
      '<div class="disc-editor" id="discEditor"></div>' +
      '<button class="btn secondary" id="addDiscBtn" style="margin-top:8px">+ Add release</button>';

    bind('f_name', function (v) { a.name = v; sortArtists(); renderList(); });
    bind('f_slug', function (v) { a.slug = slugify(v); });
    bind('f_genres', function (v) { a.genres = v; });
    bind('f_location', function (v) { a.location = v; });
    bind('f_shortBio', function (v) { a.shortBio = v; });
    bind('f_bio', function (v) { a.bio = v; });
    bind('f_videos', function (v) { a.videos = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
    $('editor').querySelectorAll('[data-link]').forEach(function (el) { el.addEventListener('input', function () { a.links[el.getAttribute('data-link')] = el.value.trim(); dirty = true; }); });
    $('delBtn').addEventListener('click', function () { if (confirm('Delete ' + (a.name || 'this artist') + '?')) { artists.splice(current, 1); current = -1; dirty = true; renderList(); renderEditor(); } });
    $('upBtn').addEventListener('click', function () { move(-1); });
    $('dnBtn').addEventListener('click', function () { move(1); });
    $('researchBtn').addEventListener('click', doResearch);
    $('galFile').addEventListener('change', onUpload);

    renderGallery();
    renderRoles();
    renderDiscography();
    $('addDiscBtn').addEventListener('click', function () { a.discography = a.discography || []; a.discography.push({ title: '', year: '', type: '', cover: '' }); dirty = true; renderDiscography(); });
  }

  /* ---------- gallery ---------- */
  function roleUsing(a, src) { return ROLES.filter(function (R) { return a.roles[R.key] && sameSrc(a.roles[R.key].src, src); }).map(function (R) { return R.key; }); }
  function sameSrc(x, y) { return x && y && x === y; }

  function renderDiscography() {
    var a = artists[current]; var host = $('discEditor'); if (!host) return;
    var d = a.discography || [];
    if (!d.length) { host.innerHTML = '<p style="color:var(--muted);margin:0">No releases yet. Run Research or add one manually.</p>'; return; }
    host.innerHTML = d.map(function (r, i) {
      var cover = r.cover ? '<img src="' + esc(r.cover) + '" alt="" style="width:46px;height:46px;object-fit:cover;border-radius:4px;flex:0 0 auto" onerror="this.style.display=\'none\'">' : '<span style="width:46px;height:46px;flex:0 0 auto;display:flex;align-items:center;justify-content:center;background:#222;border-radius:4px;color:#888">' + esc((r.title || '?').charAt(0).toUpperCase()) + '</span>';
      return '<div class="disc-row" style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
        cover +
        '<input data-disc="' + i + '" data-k="title" value="' + esc(r.title || '') + '" placeholder="Title" style="flex:2">' +
        '<input data-disc="' + i + '" data-k="year" value="' + esc(r.year || '') + '" placeholder="Year" style="width:70px">' +
        '<input data-disc="' + i + '" data-k="type" value="' + esc(r.type || '') + '" placeholder="Type" style="width:90px">' +
        '<button class="btn danger" data-disc-rm="' + i + '" style="flex:0 0 auto">✕</button>' +
      '</div>';
    }).join('');
    host.querySelectorAll('input[data-disc]').forEach(function (el) {
      el.addEventListener('input', function () {
        var idx = parseInt(el.getAttribute('data-disc'), 10), k = el.getAttribute('data-k');
        a.discography[idx][k] = el.value; dirty = true;
      });
    });
    host.querySelectorAll('button[data-disc-rm]').forEach(function (b) {
      b.addEventListener('click', function () {
        var idx = parseInt(b.getAttribute('data-disc-rm'), 10);
        a.discography.splice(idx, 1); dirty = true; renderDiscography();
      });
    });
  }

  function renderGallery() {
    var a = artists[current], g = $('gallery');
    if (!a.gallery.length) { g.innerHTML = '<div style="color:var(--muted);font-size:12px">No photos yet — upload one or more to get started.</div>'; return; }
    g.innerHTML = a.gallery.map(function (src, i) {
      var used = roleUsing(a, src);
      var badges = used.map(function (k) { return '<span class="badge">' + k + '</span>'; }).join('');
      var btns = ROLES.map(function (R) { return '<button data-role="' + R.key + '" data-src="' + esc(src) + '" class="' + (used.indexOf(R.key) > -1 ? 'on' : '') + '">' + R.key.charAt(0).toUpperCase() + R.key.slice(1) + '</button>'; }).join('');
      return '<div class="gallery-item"><img class="gallery-thumb" src="' + esc(imgUrl(src)) + '" alt="" onerror="this.style.opacity=.2"><div class="gallery-body"><div class="gallery-badges">' + badges + '</div><div class="gallery-btns">' + btns + '<button class="rm" data-rm="' + esc(src) + '">✕</button></div></div></div>';
    }).join('');
    g.querySelectorAll('button[data-role]').forEach(function (b) { b.addEventListener('click', function () { assignRole(b.getAttribute('data-role'), b.getAttribute('data-src')); }); });
    g.querySelectorAll('button[data-rm]').forEach(function (b) { b.addEventListener('click', function () { removeFromGallery(b.getAttribute('data-rm')); }); });
  }

  function assignRole(role, src) {
    var a = artists[current];
    if (a.roles[role] && sameSrc(a.roles[role].src, src)) { delete a.roles[role]; } // toggle off
    else { a.roles[role] = { src: src, x: 50, y: 50, scale: 1 }; }
    dirty = true; renderGallery(); renderRoles(); renderList();
  }
  function removeFromGallery(src) {
    var a = artists[current];
    a.gallery = a.gallery.filter(function (s) { return s !== src; });
    ROLES.forEach(function (R) { if (a.roles[R.key] && sameSrc(a.roles[R.key].src, src)) delete a.roles[R.key]; });
    dirty = true; renderGallery(); renderRoles(); renderList();
  }

  function onUpload(e) {
    var files = Array.prototype.slice.call(e.target.files || []);
    e.target.value = '';
    var a = artists[current];
    (function next() {
      if (!files.length) return;
      var file = files.shift();
      setStatus('Uploading ' + file.name + '…');
      resize(file, 1800, function (dataUrl) {
        if (!dataUrl) { setStatus('Could not read ' + file.name, 'err'); return next(); }
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', password: pw(), slug: a.slug, filename: file.name, dataUrl: dataUrl }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.success) throw new Error(d.error || 'upload failed');
            fresh[d.path] = dataUrl;
            a.gallery.push(d.path);
            // auto-assign to any empty role so a first photo shows immediately
            ROLES.forEach(function (R) { if (!a.roles[R.key]) a.roles[R.key] = { src: d.path, x: 50, y: 50, scale: 1 }; });
            dirty = true; renderGallery(); renderRoles(); renderList();
            setStatus('Uploaded — click Save changes to publish', 'ok');
            next();
          })
          .catch(function (err) { setStatus('Upload failed: ' + err.message, 'err'); });
      });
    })();
  }

  /* ---------- role crop editors ---------- */
  function renderRoles() {
    var a = artists[current];
    $('roles').innerHTML = ROLES.map(function (R) {
      var r = a.roles[R.key];
      var has = r && r.src;
      var style = has ? 'object-position:' + (r.x) + '% ' + (r.y) + '%;transform:scale(' + (r.scale || 1) + ');transform-origin:' + (r.x) + '% ' + (r.y) + '%' : '';
      return '<div class="role-card"><h3>' + R.label + '</h3><div class="sub">' + R.sub + '</div>' +
        '<div class="role-stage" id="st_' + R.key + '" style="aspect-ratio:' + R.ratio + '">' +
          (has ? '<img id="im_' + R.key + '" src="' + esc(imgUrl(r.src)) + '" style="' + style + '">' : '') +
          '<div class="role-empty" id="em_' + R.key + '" style="' + (has ? 'display:none' : '') + '">Assign a gallery photo to this role using the buttons above.</div>' +
          '<div class="role-dot" id="dt_' + R.key + '" style="' + (has ? 'left:' + r.x + '%;top:' + r.y + '%;display:block' : '') + '"></div>' +
        '</div>' +
        '<div class="role-ctl"><label>Zoom</label><input type="range" min="1" max="3" step="0.05" value="' + (has ? (r.scale || 1) : 1) + '" id="zm_' + R.key + '" ' + (has ? '' : 'disabled') + '><span class="zoomval" id="zv_' + R.key + '">' + (has ? (r.scale || 1).toFixed(2) : '1.00') + '×</span><button class="btn secondary" id="ce_' + R.key + '" style="padding:5px 9px" ' + (has ? '' : 'disabled') + '>Center</button></div>' +
        '</div>';
    }).join('');
    ROLES.forEach(initRoleEditor);
  }

  function initRoleEditor(R) {
    var a = artists[current];
    var stage = $('st_' + R.key), img = $('im_' + R.key), dot = $('dt_' + R.key);
    var zm = $('zm_' + R.key), zv = $('zv_' + R.key), ce = $('ce_' + R.key);
    var r = a.roles[R.key];
    if (!r || !r.src) return;
    var dragging = false;
    function paint() {
      var s = r.scale || 1;
      img.style.objectPosition = r.x + '% ' + r.y + '%';
      img.style.transform = 'scale(' + s + ')';
      img.style.transformOrigin = r.x + '% ' + r.y + '%';
      dot.style.left = r.x + '%'; dot.style.top = r.y + '%';
    }
    function fromEvent(e) {
      var rect = stage.getBoundingClientRect(); var p = e.touches ? e.touches[0] : e;
      r.x = Math.max(0, Math.min(100, Math.round(((p.clientX - rect.left) / rect.width) * 100)));
      r.y = Math.max(0, Math.min(100, Math.round(((p.clientY - rect.top) / rect.height) * 100)));
      dirty = true; paint();
    }
    stage.addEventListener('mousedown', function (e) { dragging = true; fromEvent(e); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (dragging) fromEvent(e); });
    window.addEventListener('mouseup', function () { dragging = false; });
    stage.addEventListener('touchstart', function (e) { dragging = true; fromEvent(e); }, { passive: true });
    stage.addEventListener('touchmove', function (e) { if (dragging) fromEvent(e); }, { passive: true });
    stage.addEventListener('touchend', function () { dragging = false; });
    zm.addEventListener('input', function () { r.scale = parseFloat(zm.value); zv.textContent = r.scale.toFixed(2) + '×'; dirty = true; paint(); });
    ce.addEventListener('click', function () { r.x = 50; r.y = 50; r.scale = 1; zm.value = 1; zv.textContent = '1.00×'; dirty = true; paint(); });
  }

  /* ---------- AI research ---------- */
  function doResearch() {
    var a = artists[current];
    var name = (a.name || '').trim();
    if (!name) { setStatus('Enter the artist name first', 'err'); return; }
    setStatus('✦ Researching "' + name + '" — this can take ~30s…');
    var btn = $('researchBtn'); if (btn) { btn.disabled = true; btn.textContent = '✦ Researching…'; }
    fetch('/.netlify/functions/researchArtist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ artistName: name }) })
      .then(function (r) { return r.text(); })
      .then(function (t) { var d; try { d = JSON.parse(t); } catch (e) { throw new Error('AI returned an unexpected response'); } if (d.error) throw new Error(d.error); return d; })
      .then(function (d) {
        var filled = [];
        if (d.genres) { a.genres = Array.isArray(d.genres) ? d.genres.join(', ') : d.genres; filled.push('genres'); }
        if (d.location) { a.location = d.location; filled.push('location'); }
        if (d.bio) { a.bio = d.bio; filled.push('bio'); }
        // shortBio intentionally left blank — artist pages use verified quotes, not AI teaser bios
        if (d.socials) {
          a.links = a.links || {};
          var linkCount = 0;
          LINK_FIELDS.forEach(function (k) { if (d.socials[k]) { a.links[k] = d.socials[k]; linkCount++; } });
          if (linkCount) filled.push(linkCount + ' link' + (linkCount > 1 ? 's' : ''));
        }
        if (Array.isArray(d.discography) && d.discography.length) {
          a.discography = d.discography.map(function (r) {
            return { title: r.title || '', year: r.year || '', type: r.type || '', cover: r.cover || '', mbid: r.mbid || '', url: r.url || '' };
          });
          filled.push(a.discography.length + ' releases');
        }
        if (Array.isArray(d.videos) && d.videos.length) {
          var vs = d.videos.map(function (v) { return typeof v === 'string' ? v : (v && (v.url || v.youtube) || ''); }).filter(Boolean);
          // Replace videos on research so wrong/leftover ones don't linger; user can prune the list.
          if (vs.length) { a.videos = Array.from(new Set(vs)); filled.push(vs.length + ' videos'); }
        }
        dirty = true; renderEditor();
        var summary = filled.length ? 'Filled: ' + filled.join(', ') : 'Research returned no new data';
        setStatus('✓ ' + summary + ' — review the fields (esp. Videos) and click Save changes', filled.length ? 'ok' : 'err');
      })
      .catch(function (e) {
        var b = $('researchBtn'); if (b) { b.disabled = false; b.textContent = '✦ Research'; }
        setStatus('AI research failed: ' + e.message, 'err');
      });
  }

  function resize(file, maxDim, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var im = new Image();
      im.onload = function () {
        var w = im.width, h = im.height;
        if (w > maxDim || h > maxDim) { var s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); }
        var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(im, 0, 0, w, h);
        try { cb(c.toDataURL('image/jpeg', 0.85)); } catch (e) { cb(null); }
      };
      im.onerror = function () { cb(null); };
      im.src = ev.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function move(dir) { var j = current + dir; if (j < 0 || j >= artists.length) return; var t = artists[current]; artists[current] = artists[j]; artists[j] = t; current = j; dirty = true; renderList(); renderEditor(); }
  function bind(id, fn) { var el = $(id); if (el) el.addEventListener('input', function () { fn(el.value); dirty = true; }); }

  /* ---------- save ---------- */
  function save() {
    setStatus('Saving…'); $('saveBtn').disabled = true;
    artists.forEach(function (a) { if (a.links) Object.keys(a.links).forEach(function (k) { if (!a.links[k]) delete a.links[k]; }); });
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', password: pw(), artists: artists }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        $('saveBtn').disabled = false;
        if (!res.ok || !res.d.success) {
          if (res.d && /password/i.test(res.d.error || '')) { sessionStorage.removeItem('mk_admin_ok'); location.reload(); return; }
          throw new Error((res.d && res.d.error) || 'save failed');
        }
        dirty = false;
        setStatus('✓ Saved & published (' + res.d.count + ' artists). Live in ~1 min.', 'ok');
      })
      .catch(function (e) { $('saveBtn').disabled = false; setStatus('Save failed: ' + e.message, 'err'); });
  }

  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  $('saveBtn').addEventListener('click', save);
  initGate();
})();
