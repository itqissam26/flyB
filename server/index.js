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

  // The v1/prices/cheap endpoint only recognizes month-level dates (YYYY-MM);
  // a full YYYY-MM-DD silently returns no data.
  const params = new URLSearchParams({ origin, destination, depart_date: date.slice(0, 7), currency: 'usd' });
  if (returnDate) params.set('return_date', returnDate.slice(0, 7));

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
// The old Hotellook cache API (engine.hotellook.com) this used to proxy has
// been decommissioned (every path on that host now 404s, confirmed manually).
// Left as a stub returning 404 so the frontend's existing fallback-to-demo
// logic kicks in cleanly -- revisit if Travelpayouts ships a replacement.
app.get('/api/prices/hotels', async (req, res) => {
  res.status(404).json({ error: 'hotel_price_api_unavailable' });
});

app.listen(PORT, () => {
  console.log(`FlyB backend (Travelpayouts) running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});
