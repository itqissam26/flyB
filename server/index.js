require('dotenv').config();
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 8787;
const TP_TOKEN = process.env.TRAVELPAYOUTS_API_TOKEN;

function isConfigured() {
  return !!(TP_TOKEN && !TP_TOKEN.includes('your_token_here'));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, configured: isConfigured(), provider: 'travelpayouts' });
});

// GET /api/prices/flights?origin=RUH&destination=DXB&date=2026-08-01&returnDate=2026-08-05
// Proxies the free Travelpayouts Data API (cached fares, not live GDS pricing)
// and returns just the cheapest fare found, so the frontend can anchor its
// demo-generated flight list to a real number.
app.get('/api/prices/flights', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'server_not_configured', message: 'Add TRAVELPAYOUTS_API_TOKEN to server/.env' });
  }
  const { origin, destination, date, returnDate } = req.query;
  if (!origin || !destination || !date) {
    return res.status(400).json({ error: 'origin, destination and date are required' });
  }

  const params = new URLSearchParams({ origin, destination, depart_date: date, currency: 'usd' });
  if (returnDate) params.set('return_date', returnDate);

  try {
    const r = await fetch(`https://api.travelpayouts.com/v1/prices/cheap?${params}`, {
      headers: { 'X-Access-Token': TP_TOKEN },
    });
    const json = await r.json();
    const routes = (json && json.data && json.data[destination]) || {};
    const prices = Object.values(routes).map(o => o.price).filter(p => typeof p === 'number');
    if (!prices.length) return res.status(404).json({ error: 'no_price_data' });
    res.json({ price: Math.min(...prices), currency: 'usd' });
  } catch (err) {
    res.status(500).json({ error: 'travelpayouts_request_failed', details: String(err.message) });
  }
});

// GET /api/prices/hotels?location=RUH&checkIn=2026-08-01&checkOut=2026-08-05
// Proxies the Hotellook cache API (also part of Travelpayouts) for a cheapest
// per-night price estimate.
app.get('/api/prices/hotels', async (req, res) => {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'server_not_configured', message: 'Add TRAVELPAYOUTS_API_TOKEN to server/.env' });
  }
  const { location, checkIn, checkOut } = req.query;
  if (!location || !checkIn || !checkOut) {
    return res.status(400).json({ error: 'location, checkIn and checkOut are required' });
  }

  const params = new URLSearchParams({
    location, checkIn, checkOut, currency: 'usd', limit: '5', token: TP_TOKEN,
  });

  try {
    const r = await fetch(`https://engine.hotellook.com/api/v2/cache.json?${params}`);
    const json = await r.json();
    const prices = Array.isArray(json)
      ? json.map(h => h.priceFrom).filter(p => typeof p === 'number')
      : [];
    if (!prices.length) return res.status(404).json({ error: 'no_price_data' });
    res.json({ pricePerNight: Math.min(...prices), currency: 'usd' });
  } catch (err) {
    res.status(500).json({ error: 'travelpayouts_request_failed', details: String(err.message) });
  }
});

app.listen(PORT, () => {
  console.log(`FlyB backend (Travelpayouts) running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
