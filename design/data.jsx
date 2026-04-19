// ============================================================
//  Mock data + helpers for Prognosix demo
// ============================================================

// Deterministic pseudo-random walk
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

function genHistory(startPrice, days, volatility, drift, seed) {
  const rand = seeded(seed);
  const out = [];
  let p = startPrice;
  const now = Date.now();
  for (let i = days - 1; i >= 0; i--) {
    const noise = (rand() - 0.5) * 2 * volatility;
    p = p * (1 + drift + noise);
    out.push({
      t: now - i * 86400000,
      o: p * (1 - (rand() - 0.5) * 0.01),
      h: p * (1 + rand() * 0.012),
      l: p * (1 - rand() * 0.012),
      c: p,
    });
  }
  return out;
}

function genForecast(lastPrice, days, expectedChangePct, confidence, seed) {
  const rand = seeded(seed);
  const out = [];
  let p = lastPrice;
  const dailyDrift = Math.pow(1 + expectedChangePct / 100, 1 / days) - 1;
  const uncertainty = (100 - confidence) / 100 * 0.02;
  for (let i = 1; i <= days; i++) {
    const noise = (rand() - 0.5) * 0.8 * uncertainty;
    p = p * (1 + dailyDrift + noise);
    const spread = p * uncertainty * Math.sqrt(i);
    out.push({
      t: Date.now() + i * 86400000,
      c: p,
      upper: p + spread,
      lower: p - spread,
    });
  }
  return out;
}

const STOCKS = {
  NVDA: {
    ticker: 'NVDA', name: 'Nvidia Corp.', sector: 'Halbleiter',
    price: 142.87, change: 2.34, changePct: 1.67,
    marketCap: '3.51T', pe: 64.2, volume: '218.4M',
    forecasts: {
      day:   { pct:  1.8,  price: 145.44, confidence: 71 },
      month: { pct:  4.8,  price: 149.72, confidence: 62 },
      year:  { pct: 18.2,  price: 168.87, confidence: 48 },
    },
    news: [
      { t: 'vor 2h',  title: 'Quartalszahlen übertreffen Analysten-Erwartungen',  sent:  0.72 },
      { t: 'vor 6h',  title: 'Neue KI-Chip-Generation angekündigt',               sent:  0.65 },
      { t: 'vor 1T',  title: 'Drei Analysten-Häuser erhöhen Kursziel',            sent:  0.58 },
      { t: 'vor 2T',  title: 'Regulatorische Prüfung in China läuft an',          sent: -0.32 },
    ],
    features: [
      { name: 'Momentum (14d)', impact:  0.82 },
      { name: 'Volumen-Trend',  impact:  0.64 },
      { name: 'RSI (neutral)',  impact:  0.12 },
      { name: 'Sektor-Korrel.', impact:  0.48 },
      { name: 'News-Sentiment', impact:  0.56 },
      { name: 'Makro (VIX)',    impact: -0.21 },
    ],
    seed: 1,
  },
  SAP: {
    ticker: 'SAP', name: 'SAP SE', sector: 'Software',
    price: 228.14, change: -1.42, changePct: -0.62,
    marketCap: '268.2B', pe: 48.6, volume: '2.8M',
    forecasts: {
      day:   { pct:  0.4,  price: 229.05, confidence: 68 },
      month: { pct:  2.1,  price: 232.93, confidence: 58 },
      year:  { pct:  9.4,  price: 249.58, confidence: 44 },
    },
    news: [
      { t: 'vor 3h',  title: 'Cloud-Umsatz wächst um 25%',                  sent:  0.68 },
      { t: 'vor 1T',  title: 'Neuer CFO ab Januar bestätigt',               sent:  0.18 },
      { t: 'vor 2T',  title: 'Analyst senkt Kursziel wegen Währungseffekt', sent: -0.42 },
    ],
    features: [
      { name: 'Momentum (14d)', impact:  0.12 },
      { name: 'Volumen-Trend',  impact: -0.18 },
      { name: 'RSI (54)',       impact:  0.08 },
      { name: 'Sektor-Korrel.', impact:  0.34 },
      { name: 'News-Sentiment', impact:  0.28 },
      { name: 'Makro (EUR/USD)',impact: -0.15 },
    ],
    seed: 2,
  },
  TSLA: {
    ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Automobil',
    price: 248.92, change: -8.14, changePct: -3.17,
    marketCap: '792.1B', pe: 72.8, volume: '98.2M',
    forecasts: {
      day:   { pct: -0.8,  price: 246.93, confidence: 52 },
      month: { pct:  3.2,  price: 256.88, confidence: 41 },
      year:  { pct: 12.0,  price: 278.79, confidence: 33 },
    },
    news: [
      { t: 'vor 1h',  title: 'Auslieferungszahlen Q4 unter Erwartung',      sent: -0.62 },
      { t: 'vor 8h',  title: 'FSD v13 Beta jetzt auch in Europa',           sent:  0.44 },
      { t: 'vor 1T',  title: 'Konkurrenz aus China: BYD-Modell startet',    sent: -0.38 },
    ],
    features: [
      { name: 'Momentum (14d)', impact: -0.58 },
      { name: 'Volumen-Trend',  impact:  0.22 },
      { name: 'RSI (38)',       impact: -0.28 },
      { name: 'Sektor-Korrel.', impact: -0.15 },
      { name: 'News-Sentiment', impact: -0.42 },
      { name: 'Makro (Öl)',     impact:  0.08 },
    ],
    seed: 3,
  },
  MSFT: {
    ticker: 'MSFT', name: 'Microsoft Corp.', sector: 'Software',
    price: 431.12, change: 3.88, changePct: 0.91,
    marketCap: '3.21T', pe: 36.4, volume: '22.8M',
    forecasts: {
      day:   { pct:  0.6,  price: 433.71, confidence: 76 },
      month: { pct:  3.4,  price: 445.78, confidence: 67 },
      year:  { pct: 14.8,  price: 494.93, confidence: 54 },
    },
    news: [
      { t: 'vor 4h',  title: 'Azure-Wachstum beschleunigt sich auf 33%',    sent:  0.74 },
      { t: 'vor 1T',  title: 'Copilot-Integration für alle Enterprise-Kunden',sent:  0.52 },
      { t: 'vor 3T',  title: 'EU-Kartellprüfung gegen Teams abgeschlossen', sent:  0.28 },
    ],
    features: [
      { name: 'Momentum (14d)', impact:  0.54 },
      { name: 'Volumen-Trend',  impact:  0.38 },
      { name: 'RSI (61)',       impact:  0.22 },
      { name: 'Sektor-Korrel.', impact:  0.68 },
      { name: 'News-Sentiment', impact:  0.62 },
      { name: 'Makro (Zinsen)', impact: -0.12 },
    ],
    seed: 4,
  },
};

// Populate history + forecast per stock
Object.values(STOCKS).forEach(s => {
  s.history90 = genHistory(s.price * 0.92, 90, 0.022, 0.0009, s.seed);
  // align last history close to current price
  s.history90[s.history90.length - 1].c = s.price;
  s.spark = s.history90.slice(-20).map(x => x.c);
});

function formatCurrency(v, short = false) {
  if (v == null) return '—';
  if (short) {
    if (Math.abs(v) >= 1e12) return '$' + (v / 1e12).toFixed(2) + 'T';
    if (Math.abs(v) >= 1e9)  return '$' + (v / 1e9).toFixed(2) + 'B';
    if (Math.abs(v) >= 1e6)  return '$' + (v / 1e6).toFixed(2) + 'M';
  }
  return '$' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPct(v) {
  const sign = v >= 0 ? '+' : '';
  return sign + v.toFixed(2) + '%';
}

Object.assign(window, { STOCKS, genHistory, genForecast, formatCurrency, formatPct });
