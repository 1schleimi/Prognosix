// ============================================================
//  Detail screen — single stock with forecast + features + news
// ============================================================

const HORIZONS = [
  { key: 'day',   label: 'Tag',   sub: 'nächster Handelstag' },
  { key: 'month', label: 'Monat', sub: '~21 Handelstage' },
  { key: 'year',  label: 'Jahr',  sub: '~252 Handelstage' },
];

function Detail({ setPage, ticker, user, tweaks }) {
  const stock = STOCKS[ticker] || STOCKS.NVDA;
  const [horizon, setHorizon] = useState('month');
  const [inWatch, setInWatch] = useState(true);
  const [tab, setTab] = useState('forecast');

  const f = stock.forecasts[horizon];
  const up = f.pct >= 0;
  const hInfo = HORIZONS.find(h => h.key === horizon);

  return (
    <div className="fadeIn" style={{ padding: '8px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Back */}
      <Button variant="ghost" size="sm" icon={<Icon.ArrowBack />} onClick={() => setPage({ name: user ? 'dashboard' : 'landing' })}>
        Zurück
      </Button>

      {/* Header row */}
      <div style={{
        marginTop: 24,
        display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <StockLogo ticker={stock.ticker} size={72} radius={20} />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 className="display mono" style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.01em' }}>
                {stock.ticker}
              </h1>
              <Pill tone="neutral" size="sm">{stock.sector}</Pill>
            </div>
            <div style={{ fontSize: 15, color: 'var(--text-dim)', marginTop: 2 }}>{stock.name}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {user && (
            <Button
              variant={inWatch ? 'soft' : 'secondary'}
              size="md"
              icon={inWatch ? <Icon.Star /> : <Icon.StarOutline />}
              onClick={() => setInWatch(!inWatch)}
            >
              {inWatch ? 'In Watchlist' : 'Zur Watchlist'}
            </Button>
          )}
          <Button variant="secondary" size="md" icon={<Icon.Settings />}>
            Modell-Info
          </Button>
        </div>
      </div>

      {/* Price hero */}
      <div style={{
        marginTop: 28,
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(280px, 380px)',
        gap: 20,
      }}>
        {/* Left — current price + forecast summary */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: 28,
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 20, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Aktueller Kurs
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 6 }}>
                <span className="mono display" style={{ fontSize: 56, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {formatCurrency(stock.price)}
                </span>
                <Pill tone={stock.changePct >= 0 ? 'up' : 'down'} size="md" icon={stock.changePct >= 0 ? <Icon.TrendUp /> : <Icon.TrendDown />}>
                  {formatPct(stock.changePct)}
                </Pill>
              </div>
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
                {stock.change >= 0 ? '+' : ''}${stock.change.toFixed(2)} heute · Vol. {stock.volume}
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 200, paddingLeft: 24, borderLeft: '1px solid var(--border)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
                Prognose · {hInfo.label}
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6 }}>
                <span className="mono display" style={{ fontSize: 40, fontWeight: 700, color: up ? 'var(--mint)' : 'var(--coral)', letterSpacing: '-0.02em' }}>
                  {formatPct(f.pct)}
                </span>
                <span className="mono" style={{ fontSize: 14, color: 'var(--text-dim)' }}>
                  → {formatCurrency(f.price)}
                </span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
                {hInfo.sub}
              </div>
            </div>
          </div>

          {/* Horizon pills */}
          <div style={{
            marginTop: 24,
            display: 'flex', gap: 4,
            padding: 4,
            background: 'var(--bg-sunken)',
            borderRadius: 999,
            width: 'fit-content',
          }}>
            {HORIZONS.map(h => (
              <button
                key={h.key}
                onClick={() => setHorizon(h.key)}
                style={{
                  padding: '10px 20px', borderRadius: 999,
                  background: horizon === h.key ? 'var(--bg-elev)' : 'transparent',
                  color: horizon === h.key ? 'var(--text)' : 'var(--text-muted)',
                  fontSize: 13, fontWeight: 600,
                  boxShadow: horizon === h.key ? 'var(--shadow-sm)' : 'none',
                  transition: 'all 180ms',
                }}
              >
                {h.label}
              </button>
            ))}
          </div>
        </div>

        {/* Right — confidence card */}
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)',
          padding: 28,
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', gap: 16,
          position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', top: -40, left: -40,
            width: 160, height: 160, borderRadius: '50%',
            background: 'var(--accent-soft)', filter: 'blur(40px)',
          }} />
          <div style={{ position: 'relative', width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 16 }}>
              Modell-Konfidenz
            </div>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <ConfidenceWidget value={f.confidence} style={tweaks.confidenceStyle} />
            </div>
            <div style={{
              marginTop: 20, padding: '10px 14px',
              background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)',
              display: 'flex', alignItems: 'center', gap: 8,
              fontSize: 12, color: 'var(--text-dim)', justifyContent: 'center',
            }}>
              <Icon.Info style={{ color: 'var(--text-muted)' }} />
              Basierend auf ATR, RSI &amp; Momentum
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{
        marginTop: 32, display: 'flex', gap: 4,
        borderBottom: '1px solid var(--border)',
      }}>
        {[
          { k: 'forecast', l: 'Prognose & Chart' },
          { k: 'features', l: 'Feature-Wichtigkeit' },
          { k: 'news',     l: 'News & Sentiment' },
          { k: 'stats',    l: 'Kennzahlen' },
        ].map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            style={{
              padding: '14px 20px',
              color: tab === t.k ? 'var(--text)' : 'var(--text-muted)',
              fontWeight: 600, fontSize: 14,
              borderBottom: '2px solid',
              borderColor: tab === t.k ? 'var(--accent)' : 'transparent',
              marginBottom: -1,
            }}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ marginTop: 24 }}>
        {tab === 'forecast' && (
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-xl)', padding: 28,
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>
                  Kursverlauf &amp; Prognose
                </h2>
                <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4 }}>
                  Durchgezogen: historisch · Gestrichelt: Prognose · Band: 1σ-Unsicherheit
                </p>
              </div>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
                <LegendDot color="var(--accent)" label="Historisch" />
                <LegendDot color={up ? 'var(--mint)' : 'var(--coral)'} label="Prognose" dashed />
              </div>
            </div>
            <ForecastChart stock={stock} horizon={horizon} height={360} />
          </div>
        )}

        {tab === 'features' && <FeaturesPanel stock={stock} />}
        {tab === 'news' && <NewsPanel stock={stock} />}
        {tab === 'stats' && <StatsPanel stock={stock} />}
      </div>

      {/* Disclaimer */}
      <div style={{
        marginTop: 32, padding: '14px 20px',
        background: 'var(--peach-soft)', borderRadius: 'var(--radius-md)',
        display: 'flex', alignItems: 'center', gap: 10,
        fontSize: 12, color: 'var(--text-dim)',
      }}>
        <Icon.Info style={{ color: 'var(--peach)' }} />
        DSAI-Studentenprojekt · Nur zu Bildungszwecken · Keine Anlageberatung.
      </div>
    </div>
  );
}

function LegendDot({ color, label, dashed }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-dim)' }}>
      <svg width="20" height="6">
        <line x1="0" y1="3" x2="20" y2="3" stroke={color} strokeWidth="2.2" strokeDasharray={dashed ? '4 3' : '0'} strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

function FeaturesPanel({ stock }) {
  const max = Math.max(...stock.features.map(f => Math.abs(f.impact)));
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)', padding: 28,
    }}>
      <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Feature-Wichtigkeit</h2>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 4, marginBottom: 24 }}>
        Welche Inputs treiben die aktuelle Prognose? Positive Werte unterstützen den prognostizierten Trend.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {stock.features.map(f => {
          const pct = (Math.abs(f.impact) / max) * 100;
          const pos = f.impact >= 0;
          return (
            <div key={f.name} style={{ display: 'grid', gridTemplateColumns: '180px 1fr 60px', gap: 16, alignItems: 'center' }}>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>{f.name}</span>
              <div style={{ position: 'relative', height: 10, background: 'var(--bg-sunken)', borderRadius: 999 }}>
                <div style={{
                  position: 'absolute', left: pos ? '50%' : `${50 - pct / 2}%`,
                  width: `${pct / 2}%`, height: '100%',
                  background: pos ? 'var(--mint)' : 'var(--coral)',
                  borderRadius: 999,
                  transition: 'width 600ms ease',
                }} />
                <div style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--border-strong)' }} />
              </div>
              <span className="mono" style={{
                fontSize: 13, fontWeight: 600, textAlign: 'right',
                color: pos ? 'var(--mint)' : 'var(--coral)',
              }}>
                {pos ? '+' : ''}{f.impact.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function NewsPanel({ stock }) {
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)', padding: 28,
    }}>
      <h2 className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>News & Sentiment</h2>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {stock.news.map((n, i) => {
          const pos = n.sent >= 0;
          return (
            <div key={i} style={{
              display: 'grid', gridTemplateColumns: '80px 1fr auto', gap: 16,
              padding: '14px 0', alignItems: 'center',
              borderBottom: i < stock.news.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                {n.t}
              </span>
              <span style={{ fontSize: 14, color: 'var(--text)' }}>{n.title}</span>
              <Pill tone={pos ? 'up' : 'down'} size="sm">
                {pos ? '+' : ''}{(n.sent * 100).toFixed(0)}
              </Pill>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatsPanel({ stock }) {
  const stats = [
    { label: 'Marktkapitalisierung', value: '$' + stock.marketCap },
    { label: 'KGV (P/E)', value: stock.pe.toFixed(1) },
    { label: 'Volumen (heute)', value: stock.volume },
    { label: 'Sektor', value: stock.sector },
    { label: 'Prognose 1 Tag', value: formatPct(stock.forecasts.day.pct) },
    { label: 'Prognose 1 Monat', value: formatPct(stock.forecasts.month.pct) },
    { label: 'Prognose 1 Jahr', value: formatPct(stock.forecasts.year.pct) },
    { label: 'Modell', value: 'LSTM-Ensemble v3' },
  ];
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-xl)', padding: 28,
    }}>
      <h2 className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>Kennzahlen</h2>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: 16,
      }}>
        {stats.map(s => (
          <div key={s.label} style={{
            padding: 16,
            background: 'var(--bg-sunken)',
            borderRadius: 'var(--radius-md)',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
              {s.label}
            </div>
            <div className="mono" style={{ fontSize: 18, fontWeight: 600, marginTop: 4 }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

window.Detail = Detail;
