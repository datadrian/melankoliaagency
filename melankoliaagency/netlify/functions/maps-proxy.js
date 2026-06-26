/**
 * Melankolia Tour Planner — Maps Proxy
 * Proxies all Google Maps API calls server-side so the key is never exposed.
 * Supported actions: geocode, directions, distancematrix, places
 */

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const { action, params } = body;
  if (!action || !params) {
    return { statusCode: 400, body: 'Missing action or params' };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  try {
    let url;
    let fetchOptions = { method: 'GET' };

    switch (action) {

      case 'geocode': {
        const q = encodeURIComponent(params.address);
        url = `https://maps.googleapis.com/maps/api/geocode/json?address=${q}&key=${GOOGLE_MAPS_API_KEY}`;
        break;
      }

      case 'directions': {
        const origin = encodeURIComponent(params.origin);
        const destination = encodeURIComponent(params.destination);
        const waypoints = params.waypoints && params.waypoints.length
          ? 'optimize:true|' + params.waypoints.map(w => encodeURIComponent(w)).join('|')
          : null;
        url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}${waypoints ? '&waypoints=' + waypoints : ''}&key=${GOOGLE_MAPS_API_KEY}`;
        break;
      }

      case 'distancematrix': {
        const origins = params.origins.map(o => encodeURIComponent(o)).join('|');
        const destinations = params.destinations.map(d => encodeURIComponent(d)).join('|');
        url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${origins}&destinations=${destinations}&key=${GOOGLE_MAPS_API_KEY}`;
        break;
      }

      case 'places': {
        url = `https://places.googleapis.com/v1/places:searchText`;
        fetchOptions = {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': GOOGLE_MAPS_API_KEY,
            'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.types,places.location,places.rating,places.websiteUri,places.nationalPhoneNumber'
          },
          body: JSON.stringify({
            textQuery: params.query,
            maxResultCount: params.limit || 10
          })
        };
        break;
      }

      default:
        return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${action}` }), headers };
    }

    const response = await fetch(url, fetchOptions);
    const data = await response.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };

  } catch (err) {
    console.error('Maps proxy error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
