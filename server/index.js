require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;
const AMADEUS_BASE_URL = process.env.AMADEUS_BASE_URL || 'https://test.api.amadeus.com';
const CLIENT_ID = process.env.AMADEUS_CLIENT_ID;
const CLIENT_SECRET = process.env.AMADEUS_CLIENT_SECRET;

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;

  if (!CLIENT_ID || !CLIENT_SECRET || CLIENT_ID === 'your_client_id_here') {
    throw new Error('MISSING_KEYS');
  }

  const res = await fetch(`${AMADEUS_BASE_URL}/v1/security/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`AUTH_FAILED: ${res.status} ${text}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  // refresh a little before it actually expires
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return cachedToken;
}

async function amadeusGet(path, params) {
  const token = await getAccessToken();
  const url = new URL(`${AMADEUS_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error('AMADEUS_ERROR');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

app.get('/api/health', (req, res) => {
  const configured = !!(CLIENT_ID && CLIENT_SECRET && CLIENT_ID !== 'your_client_id_here');
  res.json({ ok: true, configured, baseUrl: AMADEUS_BASE_URL });
});

// GET /api/flights/search?origin=RUH&destination=DXB&date=2026-08-01&returnDate=2026-08-05&adults=1
app.get('/api/flights/search', async (req, res) => {
  const { origin, destination, date, returnDate, adults } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination and date are required' });
  }
  try {
    const data = await amadeusGet('/v2/shopping/flight-offers', {
      originLocationCode: origin,
      destinationLocationCode: destination,
      departureDate: date,
      returnDate: returnDate || undefined,
      adults: adults || 1,
      currencyCode: 'SAR',
      max: 20,
    });
    res.json(data);
  } catch (err) {
    handleAmadeusError(err, res);
  }
});

// GET /api/hotels/search?cityCode=RUH&checkIn=2026-08-01&checkOut=2026-08-05&adults=2
app.get('/api/hotels/search', async (req, res) => {
  const { cityCode, checkIn, checkOut, adults } = req.query;
  if (!cityCode || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'cityCode, checkIn and checkOut are required' });
  }
  try {
    // Step 1: find hotel IDs in the city
    const list = await amadeusGet('/v1/reference-data/locations/hotels/by-city', { cityCode });
    const hotelIds = (list.data || []).slice(0, 20).map(h => h.hotelId).join(',');
    if (!hotelIds) return res.json({ data: [] });

    // Step 2: get live offers for those hotels
    const offers = await amadeusGet('/v3/shopping/hotel-offers', {
      hotelIds,
      checkInDate: checkIn,
      checkOutDate: checkOut,
      adults: adults || 1,
      currency: 'SAR',
    });
    res.json(offers);
  } catch (err) {
    handleAmadeusError(err, res);
  }
});

function handleAmadeusError(err, res) {
  if (err.message === 'MISSING_KEYS') {
    return res.status(503).json({ error: 'server_not_configured', message: 'Add AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET to server/.env' });
  }
  console.error(err.message, err.details || '');
  res.status(err.status || 500).json({ error: 'amadeus_request_failed', details: err.details || String(err.message) });
}

app.listen(PORT, () => {
  console.log(`FlyB backend running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
