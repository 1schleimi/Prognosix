import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import AuthModal from '../components/AuthModal.jsx'
import TopNav from '../components/TopNav.jsx'
import {
  Pill, Button, StockLogo, SignalBadge,
  Icon, formatCurrency, formatPct, ToastContainer,
} from '../components/ui.jsx'

// NOTE: signal_alerts Supabase table (user_id, ticker, old_signal, new_signal, created_at)
// is intentionally not implemented here to avoid complexity — signal changes are surfaced
// via Desktop Notifications and in-app Toasts only.

const EXPLORE_TICKERS = ['AAPL', 'GOOGL', 'META', 'AMZN', 'AMD', 'TSLA', 'NFLX']
const REFRESH_INTERVAL_MS = 15 * 60 * 1000

let _toastId = 0
function makeToast(message, tone = 'neutral') {
  return { id: ++_toastId, message, tone }
}

function StatCard({ tone, label, value, sub }) {
  const tones = {
    accent: 'var(--accent)', up: 'var(--up)', down: 'var(--down)',
    peach: 'var(--peach)', sky: 'var(--sky)',
  }
  const softs = {
    accent: 'var(--accent-soft)', up: 'var(--up-soft)', down: 'var(--down-soft)',
    peach: 'var(--peach-soft)', sky: 'var(--sky-soft)',
  }
  return (
    <div style={{
      background: 'var(--bg-card)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)', padding: 20,
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
  )
}

function WatchRow({ ticker, priceData, onOpen, onRemove }) {
  const [hover, setHover] = useState(false)
  const p = priceData
  const up = p?.change != null && p.change >= 0
  const predUp = p?.predChange != null && p.predChange >= 0

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        display: 'grid',
        gridTemplateColumns: '1.8fr 1fr 1fr 1.2fr 1.2fr 0.5fr',
        padding: '16px 20px', alignItems: 'center',
        borderBottom: '1px solid var(--border)',
        background: hover ? 'var(--bg-elev)' : 'transparent',
        cursor: 'pointer', transition: 'background 150ms',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <StockLogo ticker={ticker} size={40} />
        <div>
          <div className="mono" style={{ fontWeight: 600 }}>{ticker}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aktie</div>
        </div>
      </div>

      <div className="mono" style={{ textAlign: 'right', fontWeight: 600 }}>
        {p?.price != null ? formatCurrency(p.price) : <span style={{ color: 'var(--text-muted)' }}>···</span>}
      </div>

      <div style={{ textAlign: 'right' }}>
        {p?.change != null ? (
          <Pill tone={up ? 'up' : 'down'} size="sm" icon={up ? <Icon.TrendUp /> : <Icon.TrendDown />}>
            {(up ? '+' : '') + p.change.toFixed(2) + '%'}
          </Pill>
        ) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>···</span>}
      </div>

      <div style={{ textAlign: 'right' }}>
        {p?.predicted != null ? (
          <>
            <div className="mono" style={{ fontSize: 14, fontWeight: 600, color: predUp ? 'var(--mint)' : 'var(--coral)' }}>
              {(predUp ? '+' : '') + p.predChange.toFixed(2) + '%'}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              → {formatCurrency(p.predicted)}
            </div>
          </>
        ) : <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>···</span>}
      </div>

      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <SignalBadge signal={p?.signal ?? null} probUp={p?.probUp ?? null} />
      </div>

      <div style={{ textAlign: 'right' }}>
        <button
          onClick={e => { e.stopPropagation(); onRemove() }}
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
  )
}

export default function Dashboard({ theme, toggleTheme }) {
  const navigate = useNavigate()
  const { user }  = useAuth()

  const [watchlist, setWatchlist]     = useState([])
  const [prices, setPrices]           = useState({})
  const [loading, setLoading]         = useState(true)
  const [query, setQuery]             = useState('')
  const [showAuth, setShowAuth]       = useState(false)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [toasts, setToasts]           = useState([])

  const prevSignals = useRef({})

  const addToast = useCallback((message, tone = 'neutral') => {
    setToasts(ts => [...ts, makeToast(message, tone)])
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(ts => ts.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    if (!user) setShowAuth(true)
  }, [user])

  const fetchPrices = useCallback((tickers) => {
    tickers.forEach(ticker => {
      Promise.all([
        fetch(`/quote/${ticker}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/predict', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticker }),
        }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]).then(([qt, pred]) => {
        const h1 = pred?.horizons?.[0] ?? null
        const predChange = h1 ? (Math.exp(h1.p50_ret) - 1) * 100 : null
        const newSignal = pred?.signal ?? null

        const oldSignal = prevSignals.current[ticker]
        if (oldSignal && newSignal && oldSignal !== newSignal) {
          const msg = `${ticker}: ${oldSignal.toUpperCase()} → ${newSignal.toUpperCase()}`
          const tone = newSignal === 'long' ? 'up' : newSignal === 'short' ? 'down' : 'neutral'
          addToast(msg, tone)
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification('Signal-Änderung', { body: msg, icon: '/favicon.ico' })
          }
        }
        prevSignals.current[ticker] = newSignal

        setPrices(prev => ({
          ...prev,
          [ticker]: {
            price:      qt?.price ?? null,
            change:     qt?.change_pct ?? null,
            predicted:  h1?.p50_price ?? null,
            predChange,
            signal:     newSignal,
            probUp:     h1?.direction_prob ?? null,
          },
        }))
      })
    })
    setLastUpdated(new Date())
  }, [addToast])

  useEffect(() => {
    if (!user) return
    supabase
      .from('watchlist')
      .select('ticker, added_at')
      .order('added_at', { ascending: false })
      .then(({ data }) => {
        const tickers = (data || []).map(r => r.ticker)
        setWatchlist(tickers)
        setLoading(false)
        fetchPrices(tickers)
      })
  }, [user, fetchPrices])

  // Auto-refresh every 15 minutes
  useEffect(() => {
    if (!user || watchlist.length === 0) return
    const id = setInterval(() => fetchPrices(watchlist), REFRESH_INTERVAL_MS)
    return () => clearInterval(id)
  }, [user, watchlist, fetchPrices])

  const removeFromWatchlist = async (ticker) => {
    await supabase.from('watchlist').delete().eq('ticker', ticker)
    setWatchlist(prev => prev.filter(t => t !== ticker))
    setPrices(prev => { const n = { ...prev }; delete n[ticker]; return n })
  }

  const addToWatchlist = async (ticker) => {
    if (!user || watchlist.includes(ticker)) return
    await supabase.from('watchlist').insert({ ticker, user_id: user.id })
    setWatchlist(prev => [...prev, ticker])
    fetchPrices([ticker])
  }

  const watchedPrices = watchlist.map(t => prices[t]).filter(Boolean)
  const changes = watchedPrices.filter(p => p.change != null).map(p => p.change)
  const avgPct = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0
  const ups = changes.filter(c => c >= 0).length

  const filtered = query
    ? [...new Set([...watchlist, ...EXPLORE_TICKERS])].filter(t =>
        t.toLowerCase().includes(query.toLowerCase())
      ).slice(0, 6)
    : []

  const exploreTickers = EXPLORE_TICKERS.filter(t => !watchlist.includes(t))
  const displayName = user?.email?.split('@')[0] ?? 'Trader'

  const formattedTime = lastUpdated
    ? lastUpdated.toLocaleTimeString('de-AT', { hour: '2-digit', minute: '2-digit' })
    : null

  return (
    <div className="fadeIn" style={{ minHeight: '100vh' }}>
      <TopNav theme={theme} toggleTheme={toggleTheme} onLogin={() => setShowAuth(true)} />

      <div style={{ padding: '24px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 32, flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {new Date().toLocaleDateString('de-AT', { weekday: 'long', day: 'numeric', month: 'long' })}
            </div>
            <h1 className="display" style={{ fontSize: 42, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 4 }}>
              Hallo, {displayName} 👋
            </h1>
          </div>

          <div style={{
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 999, padding: '8px 16px',
            minWidth: 300, position: 'relative',
          }}>
            <Icon.Search style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            <input
              value={query}
              onChange={e => setQuery(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && query && navigate(`/stock/${query.trim()}`)}
              placeholder="Aktie suchen…"
              style={{ flex: 1, border: 0, background: 'transparent', outline: 'none', fontSize: 14 }}
            />
            {filtered.length > 0 && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 6,
                background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                zIndex: 10, overflow: 'hidden',
              }}>
                {filtered.map(t => (
                  <button key={t}
                    onClick={() => { navigate(`/stock/${t}`); setQuery('') }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: 12, width: '100%', textAlign: 'left',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <StockLogo ticker={t} size={32} />
                    <span className="mono" style={{ fontWeight: 600 }}>{t}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 32 }}>
          <StatCard tone="accent" label="Watchlist"    value={watchlist.length}                      sub="Aktien beobachtet" />
          <StatCard tone={avgPct >= 0 ? 'up' : 'down'} label="Ø Change heute" value={changes.length ? formatPct(avgPct) : '—'} sub="über alle Positionen" />
          <StatCard tone="peach"  label="Trend"        value={changes.length ? `${ups}↑ · ${changes.length - ups}↓` : '—'} sub="im Plus / Minus" />
          <StatCard tone="sky"    label="Modell"       value="LSTM v3"                               sub="aktiv" />
        </div>

        <div style={{ marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Meine Watchlist</h2>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {formattedTime && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Zuletzt aktualisiert: {formattedTime}
                </span>
              )}
              <button
                onClick={() => fetchPrices(watchlist)}
                disabled={watchlist.length === 0}
                title="Jetzt aktualisieren"
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  padding: '6px 12px', borderRadius: 999,
                  background: 'var(--bg-elev)', color: 'var(--text-dim)',
                  border: '1px solid var(--border)', fontSize: 12, cursor: 'pointer',
                  opacity: watchlist.length === 0 ? 0.4 : 1,
                }}
              >
                <Icon.Refresh />
                Aktualisieren
              </button>
            </div>
          </div>

          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1.8fr 1fr 1fr 1.2fr 1.2fr 0.5fr',
              padding: '14px 20px',
              fontSize: 11, fontWeight: 600, color: 'var(--text-muted)',
              textTransform: 'uppercase', letterSpacing: '0.06em',
              borderBottom: '1px solid var(--border)',
            }}>
              <span>Titel</span>
              <span style={{ textAlign: 'right' }}>Kurs</span>
              <span style={{ textAlign: 'right' }}>Heute</span>
              <span style={{ textAlign: 'right' }}>Prognose (1T)</span>
              <span style={{ textAlign: 'center' }}>Signal</span>
              <span />
            </div>

            {loading ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Laden…</div>
            ) : watchlist.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', lineHeight: 1.7 }}>
                Deine Watchlist ist leer.<br />
                <span style={{ fontSize: 13 }}>Füge unten eine Aktie hinzu oder suche nach einem Ticker.</span>
              </div>
            ) : (
              watchlist.map(ticker => (
                <WatchRow
                  key={ticker}
                  ticker={ticker}
                  priceData={prices[ticker]}
                  onOpen={() => navigate(`/stock/${ticker}`)}
                  onRemove={() => removeFromWatchlist(ticker)}
                />
              ))
            )}
          </div>
        </div>

        {exploreTickers.length > 0 && (
          <div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 16 }}>Entdecken</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
              {exploreTickers.map(ticker => (
                <div key={ticker} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-lg)', padding: 18,
                  display: 'flex', flexDirection: 'column', gap: 14,
                }}>
                  <div
                    onClick={() => navigate(`/stock/${ticker}`)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 }}
                  >
                    <StockLogo ticker={ticker} size={40} />
                    <div>
                      <div className="mono" style={{ fontWeight: 600 }}>{ticker}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Aktie</div>
                    </div>
                  </div>
                  <Button
                    variant="soft" size="sm" fullWidth
                    icon={<Icon.Plus />}
                    onClick={() => addToWatchlist(ticker)}
                  >
                    Zur Watchlist
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ToastContainer toasts={toasts} onClose={removeToast} />

      {showAuth && (
        <AuthModal
          initialMode="login"
          onClose={() => {
            setShowAuth(false)
            if (!user) navigate('/')
          }}
        />
      )}
    </div>
  )
}
