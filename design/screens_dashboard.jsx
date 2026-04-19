// ============================================================
//  Dashboard screen — Watchlist, market overview
// ============================================================

function Dashboard({ setPage, user, tweaks }) {
  const [watchlist, setWatchlist] = useState(['NVDA', 'MSFT', 'SAP', 'TSLA']);
  const [query, setQuery] = useState('');

  const watched = watchlist.map(t => STOCKS[t]).filter(Boolean);
  const avgPct = watched.length
    ? watched.reduce((a, s) => a + s.changePct, 0) / watched.length
    : 0;
  const ups = watched.filter(s => s.changePct >= 0).length;

  const remove = (t) => setWatchlist(watchlist.filter(x => x !== t));

  const filtered = query
    ? Object.values(STOCKS).filter(s =>
        s.ticker.toLowerCase().includes(query.toLowerCase()) ||
        s.name.toLowerCase().includes(query.toLowerCase())
      )
    : [];

  return (
    <div className="fadeIn" style={{ padding: '24px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Greeting */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32 }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
            {new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
          <h1 className="display" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>
            Hallo, {user?.name || 'Trader'} 👋
          </h1>
        </div>

        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 999, padding: '8px 16px',
          minWidth: 320, position: 'relative',
        }}>
          <Icon.Search style={{ color: 'var(--text-muted)' }} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Aktie suchen…"
            style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', fontSize: 14 }}
          />
          {filtered.length > 0 && (
            <div style={{
              position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
              background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-lg)', zIndex: 5,
              overflow: 'hidden',
            }}>
              {filtered.map(s => (
                <button key={s.ticker}
                  onClick={() => { setPage({ name: 'detail', ticker: s.ticker }); setQuery(''); }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: 12, width: '100%', textAlign: 'left',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <StockLogo ticker={s.ticker} size={32} />
                  <div style={{ flex: 1 }}>
                    <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{s.ticker}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{s.name}</div>
                  </div>
                  <span className="mono" style={{ fontSize: 13 }}>{formatCurrency(s.price)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16, marginBottom: 32,
      }}>
        <StatCard tone="accent" label="Watchlist" value={watched.length} sub="Aktien beobachtet" />
        <StatCard
          tone={avgPct >= 0 ? 'up' : 'down'}
          label="Ø Change heute"
          value={formatPct(avgPct)}
          sub="über alle Positionen"
        />
        <StatCard tone="peach" label="Trend" value={`${ups}↑ · ${watched.length - ups}↓`} sub="im Plus / Minus" />
        <StatCard tone="sky" label="Modell" value="LSTM v3" sub="letztes Training vor 2h" />
      </div>

      {/* Watchlist */}
      <div style={{ marginBottom: 40 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Meine Watchlist</h2>
          <Button variant="soft" size="sm" icon={<Icon.Plus />}>
            Aktie hinzufügen
          </Button>
        </div>

        <div style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', overflow: 'hidden',
        }}>
          {/* Header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1.8fr 1fr 1fr 1.2fr 1.4fr 0.5fr',
            padding: '14px 20px',
            fontSize: 11, fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.06em',
            borderBottom: '1px solid var(--border)',
          }}>
            <span>Titel</span>
            <span style={{ textAlign: 'right' }}>Kurs</span>
            <span style={{ textAlign: 'right' }}>Heute</span>
            <span style={{ textAlign: 'right' }}>Prognose (1M)</span>
            <span style={{ textAlign: 'center' }}>Konfidenz</span>
            <span />
          </div>

          {watched.map(s => <WatchRow key={s.ticker} stock={s} onOpen={() => setPage({ name: 'detail', ticker: s.ticker })} onRemove={() => remove(s.ticker)} tweaks={tweaks} />)}
          {watched.length === 0 && (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>
              Deine Watchlist ist leer. Füge eine Aktie hinzu, um loszulegen.
            </div>
          )}
        </div>
      </div>

      {/* Explore row */}
      <div>
        <h2 className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Entdecken</h2>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
          gap: 16,
        }}>
          {Object.values(STOCKS).filter(s => !watchlist.includes(s.ticker)).map(s => (
            <ExploreCard key={s.ticker} stock={s}
              onAdd={() => setWatchlist([...watchlist, s.ticker])}
              onOpen={() => setPage({ name: 'detail', ticker: s.ticker })}
            />
          ))}
          {Object.values(STOCKS).filter(s => !watchlist.includes(s.ticker)).length === 0 && (
            <div style={{ padding: 20, color: 'var(--text-muted)', fontSize: 13 }}>
              Du beobachtest bereits alle verfügbaren Demo-Ticker.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ tone, label, value, sub }) {
  const tones = {
    accent: 'var(--accent)',
    up:     'var(--up)',
    down:   'var(--down)',
    peach:  'var(--peach)',
    sky:    'var(--sky)',
  };
  const softs = {
    accent: 'var(--accent-soft)',
    up:     'var(--up-soft)',
    down:   'var(--down-soft)',
    peach:  'var(--peach-soft)',
    sky:    'var(--sky-soft)',
  };
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: 20,
      position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: -20, right: -20,
        width: 80, height: 80, borderRadius: '50%',
        background: softs[tone], filter: 'blur(20px)',
      }} />
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </div>
      <div className="display" style={{ fontSize: 30, fontWeight: 600, marginTop: 8, color: tones[tone], letterSpacing: '-0.01em' }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 4 }}>{sub}</div>
    </div>
  );
}

function WatchRow({ stock, onOpen, onRemove, tweaks }) {
  const [hover, setHover] = useState(false);
  const up = stock.changePct >= 0;
  const fc = stock.forecasts.month;
  const fcUp = fc.pct >= 0;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.8fr 1fr 1fr 1.2fr 1.4fr 0.5fr',
        padding: '16px 20px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        background: hover ? 'var(--bg-elev)' : 'transparent',
        cursor: 'pointer',
        transition: 'background 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StockLogo ticker={stock.ticker} size={40} />
        <div>
          <div className="mono" style={{ fontWeight: 600 }}>{stock.ticker}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stock.name}</div>
        </div>
      </div>
      <div className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>{formatCurrency(stock.price)}</div>
      <div style={{ textAlign: 'right' }}>
        <Pill tone={up ? 'up' : 'down'} size="sm" icon={up ? <Icon.TrendUp /> : <Icon.TrendDown />}>
          {formatPct(stock.changePct)}
        </Pill>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: fcUp ? 'var(--mint)' : 'var(--coral)' }}>
          {formatPct(fc.pct)}
        </div>
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          → {formatCurrency(fc.price)}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <MiniConfidence value={fc.confidence} style={tweaks.confidenceStyle} />
      </div>
      <div style={{ textAlign: 'right' }}>
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          style={{
            width: 32, height: 32, borderRadius: 999,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
            background: hover ? 'var(--bg-sunken)' : 'transparent',
          }}
          title="Von Watchlist entfernen"
        >
          <Icon.X />
        </button>
      </div>
    </div>
  );
}

function MiniConfidence({ value, style }) {
  const tone = value >= 70 ? 'var(--mint)' : value >= 50 ? 'var(--peach)' : 'var(--coral)';
  if (style === 'number') {
    return (
      <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: tone }}>
        {Math.round(value)}<span style={{ color: 'var(--text-muted)', fontSize: 11, fontWeight: 400 }}>/100</span>
      </span>
    );
  }
  if (style === 'bar') {
    return (
      <div style={{ width: 120, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
          <span style={{ color: 'var(--text-muted)' }}>Konfidenz</span>
          <span className="mono" style={{ color: tone, fontWeight: 600 }}>{Math.round(value)}%</span>
        </div>
        <div style={{ height: 6, background: 'var(--bg-sunken)', borderRadius: 999 }}>
          <div style={{ width: `${value}%`, height: '100%', background: tone, borderRadius: 999 }} />
        </div>
      </div>
    );
  }
  // ring (default)
  const r = 16, c = 2 * Math.PI * r;
  return (
    <div style={{ position: 'relative', width: 44, height: 44 }}>
      <svg width="44" height="44" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="22" cy="22" r={r} fill="none" stroke="var(--bg-sunken)" strokeWidth="4" />
        <circle cx="22" cy="22" r={r} fill="none" stroke={tone} strokeWidth="4"
          strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)} strokeLinecap="round" />
      </svg>
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 700, color: tone, fontFamily: 'var(--font-mono)',
      }}>
        {Math.round(value)}
      </div>
    </div>
  );
}

function ExploreCard({ stock, onAdd, onOpen }) {
  const [hover, setHover] = useState(false);
  const up = stock.changePct >= 0;
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 18,
        transition: 'border-color 180ms, transform 180ms',
        borderColor: hover ? 'var(--border-strong)' : 'var(--border)',
        transform: hover ? 'translateY(-2px)' : 'none',
      }}
    >
      <div onClick={onOpen} style={{ cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <StockLogo ticker={stock.ticker} size={36} />
          <div style={{ flex: 1 }}>
            <div className="mono" style={{ fontWeight: 600 }}>{stock.ticker}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stock.sector}</div>
          </div>
          <Pill tone={up ? 'up' : 'down'} size="sm">{formatPct(stock.changePct)}</Pill>
        </div>

        <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{formatCurrency(stock.price)}</div>

        <div style={{ margin: '12px 0' }}>
          <Sparkline data={stock.spark} width={220} height={40} color={up ? 'var(--mint)' : 'var(--coral)'} />
        </div>
      </div>

      <Button variant="soft" size="sm" fullWidth icon={<Icon.Plus />} onClick={onAdd}>
        Zur Watchlist
      </Button>
    </div>
  );
}

window.Dashboard = Dashboard;
