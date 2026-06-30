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
      const origin = b.params?.origin || b.origin;
      const destination = b.params?.destination || b.destination;
      const mode = String(b.params?.mode || b.mode || 'DRIVE').toUpperCase();
      const travelMode = mode.includes('WALK') ? 'WALK' : (mode.includes('BICYCLE') || mode.includes('BIKE') ? 'BICYCLE' : 'DRIVE');
      const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method:'POST', headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline'},
        body:JSON.stringify({origin:{address:origin},destination:{address:destination},travelMode})
      });
      return json(200, await r.json());
    }
    return json(400,{success:false,error:'Unknown maps action'});
  } catch(err) { return json(500,{success:false,error:err.message}); }
};
