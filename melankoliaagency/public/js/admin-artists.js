/* ================================================
   MELANKOLIA — ARTIST MANAGER (admin)
   Edits artists.json in git via the save-artists function.
   ================================================ */
(function () {
  'use strict';

  var API = '/.netlify/functions/save-artists';
  var isProd = /(^|\.)melankoliaagency\.com$/.test(location.hostname);
  // Production previews existing images from the GitHub CDN; on Netlify branch
  // previews the data/images are served locally by the preview deploy.
  var CDN = isProd ? 'https://cdn.jsdelivr.net/gh/datadrian/melankoliaagency@main/melankoliaagency/public' : '';
  var LINK_FIELDS = ['website', 'instagram', 'facebook', 'bandcamp', 'spotify', 'soundcloud', 'youtube', 'tiktok', 'apple', 'bandsintown'];

  var artists = [];
  var current = -1;
  var fresh = {}; // slug+kind -> dataURL just-uploaded (for instant preview)
  var dirty = false;

  function pw() { return sessionStorage.getItem('mk_admin_pw') || ''; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function slugify(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }

  function setStatus(msg, kind) {
    var el = $('status'); el.textContent = msg || ''; el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function imgFor(art, kind) {
    var key = art.slug + '|' + kind;
    if (fresh[key]) return fresh[key];
    var p = kind === 'banner' ? art.banner : art.photo;
    if (!p) return '';
    return /^https?:|^data:/.test(p) ? p : CDN + p;
  }

  /* ---------- gate ---------- */
  function initGate() {
    if (sessionStorage.getItem('mk_admin_ok') === '1') { $('gate').style.display = 'none'; load(); return; }
    $('gateForm').addEventListener('submit', function (e) {
      e.preventDefault();
      var v = $('gatePw').value;
      // Validate by attempting a no-op authenticated check via save of nothing? Simpler: store and verify on first save.
      sessionStorage.setItem('mk_admin_pw', v);
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
        if (d && d.success && (d.artists || []).length) {
          artists = d.artists;
          setStatus(artists.length + ' artists loaded', 'ok');
          renderList();
        } else {
          loadLocal();
        }
      })
      .catch(function () { loadLocal(); });
  }

  // Fallback for branch previews (before content is on main): read the
  // locally-deployed artists.json so the manager can be tested end to end.
  function loadLocal() {
    fetch('/artists.json', { cache: 'no-cache' })
      .then(function (r) { return r.json(); })
      .then(function (d) { artists = (d && d.artists) || []; setStatus(artists.length + ' artists loaded', 'ok'); renderList(); })
      .catch(function (e) { setStatus('Load failed: ' + e.message, 'err'); });
  }

  /* ---------- list ---------- */
  function renderList() {
    var html = artists.map(function (a, i) {
      var t = imgFor(a, 'photo');
      var thumb = t ? '<img class="list-thumb" src="' + esc(t) + '" alt="" onerror="this.style.visibility=\'hidden\'">' : '<div class="list-thumb"></div>';
      return '<div class="list-item ' + (i === current ? 'active' : '') + '" data-i="' + i + '">' + thumb +
        '<span class="list-name">' + esc(a.name || '(unnamed)') + '</span></div>';
    }).join('');
    html += '<div class="list-add"><button class="btn secondary" id="addBtn" style="width:100%">+ Add artist</button></div>';
    $('list').innerHTML = html;
    $('list').querySelectorAll('.list-item').forEach(function (el) {
      el.addEventListener('click', function () { select(parseInt(el.getAttribute('data-i'), 10)); });
    });
    $('addBtn').addEventListener('click', addArtist);
  }

  function addArtist() {
    artists.push({ slug: 'new-artist-' + Date.now(), name: 'New Artist', bio: '', shortBio: '', genres: '', location: '', photo: '', focalX: 50, focalY: 50, banner: '', bannerFocalX: 50, bannerFocalY: 50, links: {}, videos: [], discography: [], status: 'active', featured: false });
    current = artists.length - 1; dirty = true;
    renderList(); renderEditor();
  }

  function select(i) { current = i; renderList(); renderEditor(); }

  /* ---------- editor ---------- */
  function renderEditor() {
    var a = artists[current];
    if (!a) { $('editor').className = 'editor empty'; $('editor').textContent = 'Select an artist to edit, or add a new one.'; return; }
    $('editor').className = 'editor';
    var linkRows = LINK_FIELDS.map(function (k) {
      return '<div class="field"><label>' + k + '</label><input data-link="' + k + '" value="' + esc((a.links && a.links[k]) || '') + '" placeholder="https://…"></div>';
    }).join('');
    $('editor').innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
        '<div class="row" style="flex:1">' +
          '<div class="field" style="margin:0"><label>Name</label><input id="f_name" value="' + esc(a.name) + '"></div>' +
          '<div class="field" style="margin:0"><label>URL slug</label><input id="f_slug" value="' + esc(a.slug) + '"></div>' +
        '</div>' +
        '<div style="display:flex;gap:6px;align-items:flex-end">' +
          '<button class="btn secondary" id="upBtn" title="Move up">↑</button>' +
          '<button class="btn secondary" id="dnBtn" title="Move down">↓</button>' +
          '<button class="btn danger" id="delBtn">Delete</button>' +
        '</div>' +
      '</div>' +

      '<h2 class="section">Photos &amp; centering</h2>' +
      '<div class="media-grid">' +
        mediaBlock('photo', 'Main photo (grid + page)', a) +
        mediaBlock('banner', 'Banner (optional page header)', a) +
      '</div>' +

      '<h2 class="section">Bio</h2>' +
      '<div class="row"><div class="field"><label>Genres</label><input id="f_genres" value="' + esc(a.genres) + '"></div>' +
      '<div class="field"><label>Location</label><input id="f_location" value="' + esc(a.location) + '"></div></div>' +
      '<div class="field"><label>Short bio (one line)</label><input id="f_shortBio" value="' + esc(a.shortBio) + '"></div>' +
      '<div class="field"><label>Full bio</label><textarea id="f_bio" rows="9">' + esc(a.bio) + '</textarea></div>' +

      '<h2 class="section">Links</h2>' + linkRows +

      '<h2 class="section">Videos (one YouTube URL per line)</h2>' +
      '<div class="field"><textarea id="f_videos" rows="5">' + esc((a.videos || []).join('\n')) + '</textarea></div>';

    // wire text fields
    bind('f_name', function (v) { a.name = v; renderListNameOnly(); });
    bind('f_slug', function (v) { a.slug = slugify(v); });
    bind('f_genres', function (v) { a.genres = v; });
    bind('f_location', function (v) { a.location = v; });
    bind('f_shortBio', function (v) { a.shortBio = v; });
    bind('f_bio', function (v) { a.bio = v; });
    bind('f_videos', function (v) { a.videos = v.split('\n').map(function (s) { return s.trim(); }).filter(Boolean); });
    $('editor').querySelectorAll('[data-link]').forEach(function (el) {
      el.addEventListener('input', function () { a.links = a.links || {}; a.links[el.getAttribute('data-link')] = el.value.trim(); dirty = true; });
    });
    $('delBtn').addEventListener('click', function () {
      if (!confirm('Delete ' + (a.name || 'this artist') + '?')) return;
      artists.splice(current, 1); current = -1; dirty = true; renderList(); renderEditor();
    });
    $('upBtn').addEventListener('click', function () { move(-1); });
    $('dnBtn').addEventListener('click', function () { move(1); });

    initCrop('photo'); initCrop('banner');
  }

  function mediaBlock(kind, label, a) {
    var src = imgFor(a, kind);
    var fx = (kind === 'banner' ? a.bannerFocalX : a.focalX); if (fx == null) fx = 50;
    var fy = (kind === 'banner' ? a.bannerFocalY : a.focalY); if (fy == null) fy = 50;
    return '<div><div class="field" style="margin-bottom:8px"><label>' + label + '</label></div>' +
      '<div class="crop-stage ' + (kind === 'banner' ? 'banner' : '') + '" id="stage_' + kind + '">' +
        '<img id="img_' + kind + '" ' + (src ? 'src="' + esc(src) + '"' : '') + ' style="object-position:' + fx + '% ' + fy + '%">' +
        '<div class="crop-empty" id="empty_' + kind + '" style="' + (src ? 'display:none' : '') + '">No image</div>' +
        '<div class="crop-dot" id="dot_' + kind + '" style="left:' + fx + '%;top:' + fy + '%;' + (src ? 'display:block' : '') + '"></div>' +
      '</div>' +
      '<div class="media-actions">' +
        '<label class="upbtn">⬆ Upload<input type="file" accept="image/*" id="file_' + kind + '" style="display:none"></label>' +
        '<button class="btn secondary" id="reset_' + kind + '">Center</button>' +
        (kind === 'banner' ? '<button class="btn secondary" id="clear_' + kind + '">Remove</button>' : '') +
      '</div>' +
      '<p class="hint">Drag the dot to choose what stays in view when the image is cropped.</p></div>';
  }

  function initCrop(kind) {
    var a = artists[current];
    var stage = $('stage_' + kind), img = $('img_' + kind), dot = $('dot_' + kind), empty = $('empty_' + kind);
    var fxKey = kind === 'banner' ? 'bannerFocalX' : 'focalX';
    var fyKey = kind === 'banner' ? 'bannerFocalY' : 'focalY';
    var dragging = false;

    function apply(x, y) {
      x = Math.max(0, Math.min(100, Math.round(x)));
      y = Math.max(0, Math.min(100, Math.round(y)));
      a[fxKey] = x; a[fyKey] = y; dirty = true;
      img.style.objectPosition = x + '% ' + y + '%';
      dot.style.left = x + '%'; dot.style.top = y + '%';
    }
    function fromEvent(e) {
      if (!(a.photo || a.banner || fresh[a.slug + '|' + kind])) return;
      var r = stage.getBoundingClientRect();
      var p = e.touches ? e.touches[0] : e;
      apply(((p.clientX - r.left) / r.width) * 100, ((p.clientY - r.top) / r.height) * 100);
    }
    stage.addEventListener('mousedown', function (e) { dragging = true; fromEvent(e); e.preventDefault(); });
    window.addEventListener('mousemove', function (e) { if (dragging) fromEvent(e); });
    window.addEventListener('mouseup', function () { dragging = false; });
    stage.addEventListener('touchstart', function (e) { dragging = true; fromEvent(e); }, { passive: true });
    stage.addEventListener('touchmove', function (e) { if (dragging) fromEvent(e); }, { passive: true });
    stage.addEventListener('touchend', function () { dragging = false; });

    $('reset_' + kind).addEventListener('click', function () { apply(50, 50); });
    var clearBtn = $('clear_' + kind);
    if (clearBtn) clearBtn.addEventListener('click', function () {
      a.banner = ''; delete fresh[a.slug + '|banner']; dirty = true; renderEditor();
    });

    $('file_' + kind).addEventListener('change', function (e) {
      var file = e.target.files[0]; if (!file) return;
      setStatus('Uploading image…');
      resize(file, kind === 'banner' ? 1800 : 1400, function (dataUrl) {
        if (!dataUrl) { setStatus('Could not read image', 'err'); return; }
        fresh[a.slug + '|' + kind] = dataUrl;
        if (img) { img.src = dataUrl; img.style.objectPosition = '50% 50%'; }
        if (empty) empty.style.display = 'none';
        if (dot) { dot.style.display = 'block'; dot.style.left = '50%'; dot.style.top = '50%'; }
        a[fxKey] = 50; a[fyKey] = 50;
        // upload to git
        fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'upload', password: pw(), slug: a.slug, kind: kind, filename: file.name, dataUrl: dataUrl }) })
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (!d.success) throw new Error(d.error || 'upload failed');
            if (kind === 'banner') a.banner = d.path; else a.photo = d.path;
            dirty = true;
            setStatus('Image uploaded — click Save changes to publish', 'ok');
            renderListNameOnly();
          })
          .catch(function (err) { setStatus('Upload failed: ' + err.message, 'err'); });
      });
      e.target.value = '';
    });
  }

  function resize(file, maxDim, cb) {
    var reader = new FileReader();
    reader.onload = function (ev) {
      var im = new Image();
      im.onload = function () {
        var w = im.width, h = im.height;
        if (w > maxDim || h > maxDim) { var s = Math.min(maxDim / w, maxDim / h); w = Math.round(w * s); h = Math.round(h * s); }
        var c = document.createElement('canvas'); c.width = w; c.height = h;
        c.getContext('2d').drawImage(im, 0, 0, w, h);
        try { cb(c.toDataURL('image/jpeg', 0.85)); } catch (e) { cb(null); }
      };
      im.onerror = function () { cb(null); };
      im.src = ev.target.result;
    };
    reader.onerror = function () { cb(null); };
    reader.readAsDataURL(file);
  }

  function move(dir) {
    var j = current + dir;
    if (j < 0 || j >= artists.length) return;
    var t = artists[current]; artists[current] = artists[j]; artists[j] = t;
    current = j; dirty = true; renderList(); renderEditor();
  }

  function bind(id, fn) {
    var el = $(id); if (!el) return;
    el.addEventListener('input', function () { fn(el.value); dirty = true; });
  }
  function renderListNameOnly() { renderList(); }

  /* ---------- save ---------- */
  function save() {
    setStatus('Saving…');
    $('saveBtn').disabled = true;
    // normalize empty link objects
    artists.forEach(function (a) {
      if (a.links) Object.keys(a.links).forEach(function (k) { if (!a.links[k]) delete a.links[k]; });
    });
    fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'save', password: pw(), artists: artists }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        $('saveBtn').disabled = false;
        if (!res.ok || !res.d.success) {
          if (res.d && /password/i.test(res.d.error || '')) { sessionStorage.removeItem('mk_admin_ok'); location.reload(); return; }
          throw new Error((res.d && res.d.error) || 'save failed');
        }
        dirty = false; fresh = {};
        setStatus('✓ Saved & published (' + res.d.count + ' artists). Live in ~1 min.', 'ok');
      })
      .catch(function (e) { $('saveBtn').disabled = false; setStatus('Save failed: ' + e.message, 'err'); });
  }

  window.addEventListener('beforeunload', function (e) { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  $('saveBtn').addEventListener('click', save);
  initGate();
})();
