/* Melankolia page visibility control v1
 * Reads published page records and:
 *  - removes nav links for any page marked hidden (sitewide)
 *  - if the CURRENT page is hidden, redirects to home (blocks direct access)
 * Independent of per-page scripts so it works on every template.
 */
(function () {
  var PAGE_PATHS = {
    about: '/about',
    submission: '/submission',
    booking: '/booking',
    videos: '/videos'
    // 'home' is intentionally never hideable
  };

  function currentPageId() {
    var explicit = document.body && document.body.dataset ? document.body.dataset.pageId : '';
    if (explicit) return explicit;
    var path = location.pathname.replace(/\/+$/, '') || '/';
    var map = { '/about': 'about', '/submission': 'submission', '/booking': 'booking', '/videos': 'videos' };
    return map[path] || '';
  }

  function stripNavFor(id) {
    var path = PAGE_PATHS[id];
    if (!path) return;
    var links = document.querySelectorAll('.nav-links a, nav a');
    for (var i = 0; i < links.length; i++) {
      var href = (links[i].getAttribute('href') || '').replace(/\/+$/, '');
      if (href === path) {
        var li = links[i].closest ? links[i].closest('li') : null;
        (li || links[i]).remove();
      }
    }
  }

  fetch('/.netlify/functions/site-data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'getPages' })
  })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      var pages = (j && j.data && j.data.pages) || {};
      var here = currentPageId();
      if (here && pages[here] && pages[here].hidden) { location.replace('/'); return; }
      Object.keys(pages).forEach(function (id) {
        if (pages[id] && pages[id].hidden) stripNavFor(id);
      });
    })
    .catch(function () {});
})();
