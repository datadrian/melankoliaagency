/**
 * Melankolia Tour Planner — Maps Config
 * Serves the Maps JS API key to the frontend securely.
 * The key is only loaded at runtime from env, never in source code.
 */

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store'
  };

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ key: process.env.GOOGLE_MAPS_API_KEY })
  };
};
