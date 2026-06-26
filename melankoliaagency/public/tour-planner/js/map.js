/**
 * Melankolia Tour Planner — Map Controller
 * Handles Google Maps rendering, markers, route polylines
 */

const MapController = (() => {
  let map = null;
  let markers = [];
  let polylines = [];
  let infoWindow = null;
  let currentBounds = null;

  // Dark map style matching Melankolia aesthetic
  const DARK_STYLE = [
    { elementType: 'geometry', stylers: [{ color: '#0a0a0a' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#555' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#050505' }] },
    { featureType: 'administrative', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
    { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#666' }] },
    { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#888' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1a1a1a' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#111' }] },
    { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#444' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#252525' }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#1a1a1a' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#555' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#020202' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#1a1a1a' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#080808' }] }
  ];

  function init() {
    const mapEl = document.getElementById('map');
    if (!mapEl) return;

    map = new google.maps.Map(mapEl, {
      center: { lat: 40.7, lng: -30 }, // Atlantic — neutral start between USA and Europe
      zoom: 3,
      styles: DARK_STYLE,
      disableDefaultUI: false,
      zoomControl: true,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: true,
      zoomControlOptions: {
        position: google.maps.ControlPosition.RIGHT_CENTER
      }
    });

    infoWindow = new google.maps.InfoWindow();
  }

  function clear() {
    markers.forEach(m => m.setMap(null));
    polylines.forEach(p => p.setMap(null));
    markers = [];
    polylines = [];
    if (infoWindow) infoWindow.close();
  }

  function fitAll() {
    if (!map || markers.length === 0) return;
    const bounds = new google.maps.LatLngBounds();
    markers.forEach(m => bounds.extend(m.getPosition()));
    map.fitBounds(bounds);
  }

  function addMarker({ lat, lng, label, title, isAnchor, isDayOff, day, info }) {
    if (!map) return null;

    const color = isDayOff ? '#333' : isAnchor ? '#c8a96e' : '#666';
    const size = isAnchor ? 14 : 10;

    const marker = new google.maps.Marker({
      position: { lat, lng },
      map,
      title,
      label: {
        text: String(day || ''),
        color: isDayOff ? '#555' : isAnchor ? '#000' : '#ccc',
        fontSize: '9px',
        fontWeight: '700'
      },
      icon: {
        path: google.maps.SymbolPath.CIRCLE,
        fillColor: color,
        fillOpacity: isDayOff ? 0.4 : 1,
        strokeColor: isAnchor ? '#e0c080' : '#222',
        strokeWeight: isAnchor ? 2 : 1,
        scale: size
      },
      zIndex: isAnchor ? 10 : isDayOff ? 1 : 5
    });

    if (info) {
      marker.addListener('click', () => {
        infoWindow.setContent(`
          <div style="background:#111;color:#ddd;padding:10px 14px;border:1px solid #222;font-family:inherit;min-width:180px;">
            <div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:${isAnchor ? '#c8a96e' : '#aaa'};margin-bottom:6px;">${isAnchor ? '★ ANCHOR SHOW' : isDayOff ? '— DAY OFF' : '◈ SHOW'}</div>
            <div style="font-size:13px;font-weight:600;margin-bottom:4px;">${title}</div>
            <div style="font-size:11px;color:#666;">${info}</div>
          </div>
        `);
        infoWindow.open(map, marker);
      });
    }

    markers.push(marker);
    return marker;
  }

  function drawRoute(coords, color = '#c8a96e', opacity = 0.7, dashed = false) {
    if (!map || coords.length < 2) return;

    const strokeStyle = dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '16px' }] : [];

    const poly = new google.maps.Polyline({
      path: coords,
      geodesic: true,
      strokeColor: color,
      strokeOpacity: dashed ? 0 : opacity,
      strokeWeight: 2,
      icons: strokeStyle
    });

    poly.setMap(map);
    polylines.push(poly);
    return poly;
  }

  async function renderTourLegs(legs) {
    clear();
    if (!legs || !legs.length) return;

    const bounds = new google.maps.LatLngBounds();
    const coords = [];
    const geocodedLegs = [];

    // Geocode all cities
    for (const leg of legs) {
      const query = `${leg.city}, ${leg.country || ''}`;
      try {
        const loc = await API.geocode(query);
        if (loc) {
          geocodedLegs.push({ ...leg, lat: loc.lat, lng: loc.lng });
          coords.push({ lat: loc.lat, lng: loc.lng });
          bounds.extend(loc);
        }
      } catch (e) {
        console.warn('Could not geocode:', query);
      }
    }

    // Draw route line
    drawRoute(coords, '#c8a96e', 0.5);

    // Add markers
    geocodedLegs.forEach((leg, i) => {
      addMarker({
        lat: leg.lat,
        lng: leg.lng,
        title: leg.city,
        day: leg.day,
        isAnchor: leg.is_anchor_show,
        isDayOff: leg.day_off,
        info: `Day ${leg.day} — ${leg.date || ''}${leg.drive_from_previous_km ? ` · ${leg.drive_from_previous_km}km from prev` : ''}${leg.notes ? `<br><small>${leg.notes}</small>` : ''}`
      });
    });

    map.fitBounds(bounds);
  }

  async function renderVenueMarkers(venues, city) {
    clear();
    if (!venues?.length) return;

    const cityLoc = await API.geocode(city);
    if (cityLoc) {
      map.setCenter(cityLoc);
      map.setZoom(12);
    }

    for (const v of venues) {
      if (v.lat && v.lng) {
        addMarker({
          lat: v.lat,
          lng: v.lng,
          title: v.name,
          isAnchor: false,
          isDayOff: false,
          info: `${v.address || ''}<br><small>${v.notes || ''}</small>`
        });
      }
    }
  }

  function panTo(lat, lng, zoom = 12) {
    if (!map) return;
    map.panTo({ lat, lng });
    map.setZoom(zoom);
  }

  return { init, clear, fitAll, addMarker, drawRoute, renderTourLegs, renderVenueMarkers, panTo };
})();

// Called by Google Maps script callback
function initMap() {
  MapController.init();

  document.getElementById('clearMapBtn')?.addEventListener('click', () => {
    MapController.clear();
    document.getElementById('resultsArea').innerHTML = `
      <div class="results-empty">
        <div class="results-empty-icon">◈</div>
        <div>Build a tour to see the itinerary, route stats, and AI recommendations here.</div>
      </div>`;
  });

  document.getElementById('fitMapBtn')?.addEventListener('click', () => MapController.fitAll());
}
