require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;
const DUFFEL_BASE_URL = 'https://api.duffel.com';
const DUFFEL_VERSION = 'v2';
const DUFFEL_TOKEN = process.env.DUFFEL_API_TOKEN;

function isConfigured() {
  return !!(DUFFEL_TOKEN && DUFFEL_TOKEN.startsWith('duffel_') && !DUFFEL_TOKEN.includes('your_token_here'));
}

function duffelHeaders() {
  return {
    'Content-Type': 'application/json',
    'Duffel-Version': DUFFEL_VERSION,
    Authorization: `Bearer ${DUFFEL_TOKEN}`,
  };
}

async function duffelPost(path, body) {
  const res = await fetch(`${DUFFEL_BASE_URL}${path}`, {
    method: 'POST',
    headers: duffelHeaders(),
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) {
    const err = new Error('DUFFEL_ERROR');
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data;
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: isConfigured(), provider: 'duffel' });
});

// GET /api/flights/search?origin=RUH&destination=DXB&date=2026-08-01&returnDate=2026-08-05&adults=1
app.get('/api/flights/search', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'server_not_configured', message: 'Add DUFFEL_API_TOKEN to server/.env' });
  }
  const { origin, destination, date, returnDate, adults } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination and date are required' });
  }

  const slices = [{ origin, destination, departure_date: date }];
  if (returnDate) slices.push({ origin: destination, destination: origin, departure_date: returnDate });
  const passengers = Array.from({ length: Number(adults) || 1 }, () => ({ type: 'adult' }));

  try {
    const data = await duffelPost('/air/offer_requests?return_offers=true', {
      data: { cabin_class: 'economy', slices, passengers },
    });
    res.json(data);
  } catch (err) {
    handleDuffelError(err, res);
  }
});

// GET /api/hotels/search?cityCode=RUH&checkIn=2026-08-01&checkOut=2026-08-05&adults=2
app.get('/api/hotels/search', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'server_not_configured', message: 'Add DUFFEL_API_TOKEN to server/.env' });
  }
  const { cityCode, checkIn, checkOut, adults } = req.query;
  if (!cityCode || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'cityCode, checkIn and checkOut are required' });
  }
  const coords = CITY_COORDS[cityCode];
  if (!coords) {
    // no coordinates on file for this city yet -> tell the frontend to fall back to demo data
    return res.status(404).json({ error: 'city_not_supported', message: `No coordinates on file for ${cityCode} yet` });
  }

  const guests = Array.from({ length: Number(adults) || 1 }, () => ({ type: 'adult' }));

  try {
    const data = await duffelPost('/stays/search', {
      data: {
        rooms: 1,
        check_in_date: checkIn,
        check_out_date: checkOut,
        guests,
        location: { geographic_coordinates: coords, radius: 8 },
      },
    });
    res.json(data);
  } catch (err) {
    handleDuffelError(err, res);
  }
});

function handleDuffelError(err, res) {
  console.error(err.message, err.details || '');
  res.status(err.status || 500).json({ error: 'duffel_request_failed', details: err.details || String(err.message) });
}

// Approximate city-centre coordinates for our curated destinations. Extend this
// as needed -- any city missing here just falls back to demo hotel data.
const CITY_COORDS = {
  RUH: { latitude: 24.7136, longitude: 46.6753 },
  JED: { latitude: 21.5433, longitude: 39.1728 },
  DMM: { latitude: 26.4207, longitude: 50.0888 },
  MED: { latitude: 24.5247, longitude: 39.5692 },
  DXB: { latitude: 25.2048, longitude: 55.2708 },
  AUH: { latitude: 24.4539, longitude: 54.3773 },
  DOH: { latitude: 25.2854, longitude: 51.5310 },
  KWI: { latitude: 29.3759, longitude: 47.9774 },
  MCT: { latitude: 23.5880, longitude: 58.3829 },
  CAI: { latitude: 30.0444, longitude: 31.2357 },
  IST: { latitude: 41.0082, longitude: 28.9784 },
  LHR: { latitude: 51.5072, longitude: -0.1276 },
  CDG: { latitude: 48.8566, longitude: 2.3522 },
  FRA: { latitude: 50.1109, longitude: 8.6821 },
  AMS: { latitude: 52.3676, longitude: 4.9041 },
  FCO: { latitude: 41.9028, longitude: 12.4964 },
  MAD: { latitude: 40.4168, longitude: -3.7038 },
  BCN: { latitude: 41.3874, longitude: 2.1686 },
  ICN: { latitude: 37.5665, longitude: 126.9780 },
  HND: { latitude: 35.6762, longitude: 139.6503 },
  BKK: { latitude: 13.7563, longitude: 100.5018 },
  KUL: { latitude: 3.1390, longitude: 101.6869 },
  SIN: { latitude: 1.3521, longitude: 103.8198 },
  JFK: { latitude: 40.7128, longitude: -74.0060 },
  LAX: { latitude: 34.0522, longitude: -118.2437 },
  SYD: { latitude: -33.8688, longitude: 151.2093 },
};

app.listen(PORT, () => {
  console.log(`FlyB backend (Duffel) running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
