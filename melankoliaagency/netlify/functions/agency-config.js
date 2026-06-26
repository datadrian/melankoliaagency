/**
 * Serves the agency admin token to the admin panel.
 * Only works from the melankoliaagency.com origin.
 */
exports.handler = async (event) => {
  const origin = event.headers['origin'] || event.headers['referer'] || '';
  const allowed = origin.includes('melankoliaagency.com') || origin.includes('localhost');

  if (!allowed) {
    return { statusCode: 403, body: JSON.stringify({ error: 'Forbidden' }) };
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://melankoliaagency.com',
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ token: process.env.AGENCY_ADMIN_TOKEN || '' })
  };
};
