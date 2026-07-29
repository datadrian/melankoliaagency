const { json } = require('./_firebase');
exports.handler = async e => {
  if (e.httpMethod === 'OPTIONS') return json(204, {});
  if (e.httpMethod !== 'POST') return json(405, { success:false, error:'POST only' });
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return json(500, { success:false, error:'Maps key missing' });
  let b={}; try { b=JSON.parse(e.body||'{}'); } catch {}
  const action = b.action || b.type;
  try {
    if (action === 'geocode') {
      const address = b.params?.address || b.address || b.query || '';
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${key}`);
      return json(200, await r.json());
    }
    if (action === 'reverse_geocode') {
      const lat = b.lat ?? b.params?.lat, lng = b.lng ?? b.params?.lng;
      const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${encodeURIComponent(lat+','+lng)}&key=${key}`);
      return json(200, await r.json());
    }
    if (action === 'route') {
      const P = b.params || b;
      const mode = String(P.mode || 'DRIVE').toUpperCase();
      const travelMode = mode.includes('WALK') ? 'WALK' : (mode.includes('BICYCLE') || mode.includes('BIKE') ? 'BICYCLE' : (mode.includes('TRANSIT')||mode.includes('TRAIN')||mode.includes('RAIL') ? 'TRANSIT' : 'DRIVE'));
      // Accept either an address or a {lat,lng} for origin/destination
      const waypoint = (addr, ll) => {
        if (ll && (ll.lat!=null||ll.latitude!=null)) return { location:{ latLng:{ latitude:Number(ll.lat??ll.latitude), longitude:Number(ll.lng??ll.longitude) } } };
        return { address: String(addr||'') };
      };
      const origin = waypoint(P.origin, P.originLatLng || (typeof P.origin==='object'?P.origin:null));
      const destination = waypoint(P.destination, P.destLatLng || (typeof P.destination==='object'?P.destination:null));
      const payload = { origin, destination, travelMode };
      if (travelMode === 'DRIVE') payload.routingPreference = 'TRAFFIC_UNAWARE';
      const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method:'POST', headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'},
        body:JSON.stringify(payload)
      });
      const jr = await r.json();
      // Normalize a compact shape the frontend can rely on
      const route = (jr.routes||[])[0];
      if (route) {
        const secs = Number(String(route.duration||'0').replace('s','')) || 0;
        return json(200, { success:true, distanceMeters: route.distanceMeters||0, durationSeconds: secs, encodedPolyline: route.polyline?.encodedPolyline||'', travelMode, raw: jr });
      }
      return json(200, { success:false, error: jr.error?.message || 'No route found', raw: jr, travelMode });
    }
    return json(400,{success:false,error:'Unknown maps action'});
  } catch(err) { return json(500,{success:false,error:err.message}); }
};
