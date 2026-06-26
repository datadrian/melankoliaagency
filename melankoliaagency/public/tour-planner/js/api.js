/**
 * Melankolia Tour Planner — API Layer
 * All calls go through Netlify functions — no keys in frontend
 */

const API = {
  async maps(action, params) {
    const res = await fetch('/.netlify/functions/maps-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, params })
    });
    if (!res.ok) throw new Error(`Maps API error: ${res.status}`);
    return res.json();
  },

  async ai(action, data) {
    const res = await fetch('/.netlify/functions/ai-tour', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, data })
    });
    if (!res.ok) throw new Error(`AI API error: ${res.status}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'AI request failed');
    return json.data;
  },

  async geocode(address) {
    const data = await this.maps('geocode', { address });
    if (data.status !== 'OK' || !data.results?.length) return null;
    return data.results[0].geometry.location;
  },

  async getDirections(origin, destination, waypoints = []) {
    return this.maps('directions', { origin, destination, waypoints });
  },

  async getDistanceMatrix(origins, destinations) {
    return this.maps('distancematrix', { origins, destinations });
  },

  async searchPlaces(query, limit = 10) {
    return this.maps('places', { query, limit });
  }
};
