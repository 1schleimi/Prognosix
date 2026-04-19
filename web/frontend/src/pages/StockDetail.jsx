import { useEffect, useRef, useState, useCallback, Component } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import CandlestickChart from '../components/CandlestickChart.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import TopNav from '../components/TopNav.jsx'
import AuthModal from '../components/AuthModal.jsx'
import {
  Pill, Button, StockLogo, ConfidenceBar,
  Icon, formatCurrency,
} from '../components/ui.jsx'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { error: null } }
  static getDerivedStateFromError(e) { return { error: e } }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          padding: 32, color: 'var(--coral)', fontFamily: 'var(--font-mono)',
          background: 'var(--bg)', minHeight: '100vh',
        }}>
          <div style={{ fontSize: 11, letterSpacing: '0.1em', color: 'var(--text-muted)', marginBottom: 8 }}>
            RENDER ERROR
          </div>
          <pre style={{ fontSize: 13, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {this.state.error.message}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

const TABS = [
  { k: 'forecast', l: 'Prognose & Chart' },
  { k: 'stats',    l: 'Kennzahlen' },
]

// Convert log-return to percentage change string, e.g. 0.0031 → "+0.31%"
function fmtRet(logRet) {
  const pct = (Math.exp(logRet) - 1) * 100
  return (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%'
}
function retPct(logRet) { return (Math.exp(logRet) - 1) * 100 }

// HorizonCard: one of 3 forecast cards (1d, 5d, 20d)
function HorizonCard({ h, lastClose, active, onClick }) {
  const up   = h.p50_ret >= 0
  const prob = h.direction_prob   // 0–1

  // Band width as share of price range for visual bar
  const bandWidth = h.p90_price - h.p10_price
  const p50pos    = lastClose > 0
    ? Math.max(0, Math.min(1, (h.p50_price - h.p10_price) / (bandWidth || 1)))
    : 0.5

  return (
    <div
      onClick={onClick}
      style={{
        flex: 1, minWidth: 220,
        background: active ? 'var(--bg-elev)' : 'var(--bg-card)',
        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-xl)',
        padding: '20px 22px',
        cursor: 'pointer',
        transition: 'border-color 150ms, background 150ms',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {/* glow accent for active */}
      {active && (
        <div style={{
          position: 'absolute', top: -30, right: -30,
          width: 120, height: 120, borderRadius: '50%',
          background: up ? 'var(--mint-soft)' : 'var(--down-soft)',
          filter: 'blur(32px)', pointerEvents: 'none',
        }} />
      )}

      {/* header: label + direction pill */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
            {h.label}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-dim)', marginTop: 1 }}>
            {h.days === 1 ? 'Nächster Tag' : h.days === 5 ? '~1 Woche' : '~1 Monat'}
          </div>
        </div>
        <Pill tone={up ? 'up' : 'down'} size="sm" icon={up ? <Icon.TrendUp /> : <Icon.TrendDown />}>
          {up ? 'Long' : 'Short'}
        </Pill>
      </div>

      {/* P50 return: big number */}
      <div style={{
        fontSize: 34, fontWeight: 800, letterSpacing: '-0.02em', lineHeight: 1,
        color: up ? 'var(--mint)' : 'var(--coral)',
        fontFamily: 'var(--font-mono)',
      }}>
        {fmtRet(h.p50_ret)}
      </div>

      {/* P50 price */}
      <div style={{ fontSize: 13, color: 'var(--text-dim)', marginTop: 4, fontFamily: 'var(--font-mono)' }}>
        → {formatCurrency(h.p50_price)}
      </div>

      {/* P10–P90 band */}
      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>
          P10 – P90 Konfidenzband
        </div>
        <div style={{ position: 'relative', height: 6, background: 'var(--bg-sunken)', borderRadius: 99 }}>
          <div style={{
            position: 'absolute', inset: 0, borderRadius: 99,
            background: up
              ? 'linear-gradient(90deg, rgba(74,222,128,0.15), rgba(74,222,128,0.45))'
              : 'linear-gradient(90deg, rgba(248,113,113,0.15), rgba(248,113,113,0.45))',
          }} />
          {/* P50 marker */}
          <div style={{
            position: 'absolute', top: -2, width: 10, height: 10,
            borderRadius: '50%',
            background: up ? 'var(--mint)' : 'var(--coral)',
            border: '2px solid var(--bg-elev)',
            left: `calc(${p50pos * 100}% - 5px)`,
          }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {fmtRet(h.p10_ret)} ({formatCurrency(h.p10_price)})
          </span>
          <span className="mono" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {fmtRet(h.p90_ret)} ({formatCurrency(h.p90_price)})
          </span>
        </div>
      </div>

      {/* Direction probability bar */}
      <div style={{ marginTop: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {up ? 'Up' : 'Down'}-Wahrscheinlichkeit
          </span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 700, color: up ? 'var(--mint)' : 'var(--coral)' }}>
            {(up ? prob : 1 - prob < 0.5 ? 1 - prob : prob) >= 0
              ? Math.round(Math.max(prob, 1 - prob) * 100) + '%'
              : '—'}
          </span>
        </div>
        <ConfidenceBar value={Math.round(Math.max(prob, 1 - prob) * 100)} />
      </div>
    </div>
  )
}

export default function StockDetail({ theme, toggleTheme }) {
  const { ticker }  = useParams()
  const navigate    = useNavigate()
  const { user }    = useAuth()

  // pred: { ticker, last_close, horizons: [{label, days, p10_ret, p50_ret, ...}], model_count }
  const [pred, setPred]               = useState(null)
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const [range, setRange]             = useState('1m')
  const [hovered, setHovered]         = useState(null)
  const [activeHorizon, setActive]    = useState(0)   // index into pred.horizons
  const [tab, setTab]                 = useState('forecast')
  const [inWatchlist, setInWatchlist] = useState(false)
  const [wlBusy, setWlBusy]           = useState(false)
  const [quote, setQuote]             = useState(null)
  const [showAuth, setShowAuth]       = useState(false)
  const quoteRef = useRef(null)

  const fetchQuote = useCallback(() => {
    fetch(`/quote/${ticker}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setQuote(d); quoteRef.current = d } })
      .catch(() => {})
  }, [ticker])

  const runPredict = useCallback(() => {
    setLoading(true); setError(null); setPred(null)
    fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    })
      .then(r => { if (!r.ok) throw new Error(`Server-Fehler (${r.status})`); return r.json() })
      .then(d => { if (d.detail) throw new Error(d.detail); setPred(d); setActive(0) })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [ticker])

  useEffect(() => { runPredict() }, [ticker])

  useEffect(() => {
    fetchQuote()
    const id = setInterval(() => {
      if (quoteRef.current?.market_state === 'REGULAR') fetchQuote()
    }, 30_000)
    return () => clearInterval(id)
  }, [fetchQuote])

  useEffect(() => {
    if (!user) { setInWatchlist(false); return }
    supabase.from('watchlist').select('ticker').eq('ticker', ticker).maybeSingle()
      .then(({ data }) => setInWatchlist(!!data))
  }, [user, ticker])

  const toggleWatchlist = async () => {
    if (!user) { setShowAuth(true); return }
    setWlBusy(true)
    if (inWatchlist) {
      await supabase.from('watchlist').delete().eq('ticker', ticker)
      setInWatchlist(false)
    } else {
      await supabase.from('watchlist').insert({ ticker, user_id: user.id })
      setInWatchlist(true)
    }
    setWlBusy(false)
  }

  const quoteUp  = quote ? (quote.change ?? 0) >= 0 : null
  const activeH  = pred?.horizons?.[activeHorizon] ?? null
  const lastClose = pred?.last_close ?? quote?.price ?? null

  return (
    <ErrorBoundary>
    <div className="fadeIn" style={{ minHeight: '100vh' }}>
      <TopNav theme={theme} toggleTheme={toggleTheme} onLogin={() => setShowAuth(true)} />

      <div style={{ padding: '8px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>

        {/* Back */}
        <Button variant="ghost" size="sm" icon={<Icon.ArrowBack />} onClick={() => navigate(-1)}>
          Zurück
        </Button>

        {/* Stock header */}
        <div style={{
          marginTop: 24,
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          flexWrap: 'wrap', gap: 24,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <StockLogo ticker={ticker} size={72} radius={20} />
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <h1 className="display mono" style={{ fontSize: 42, fontWeight: 700, letterSpacing: '-0.01em' }}>
                  {ticker}
                </h1>
                {quote?.market_state && (
                  <Pill tone={quote.market_state === 'REGULAR' ? 'up' : 'neutral'} size="sm">
                    {quote.market_state === 'REGULAR' ? '● LIVE'
                      : quote.market_state === 'PRE' ? '◐ PRE'
                      : quote.market_state === 'POST' ? '◑ POST'
                      : '○ CLOSED'}
                  </Pill>
                )}
              </div>
              <div style={{ fontSize: 15, color: 'var(--text-dim)', marginTop: 2 }}>
                Multi-Horizont Ensemble-Prognose
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {pred && (
              <div style={{
                padding: '6px 12px', borderRadius: 'var(--radius-md)',
                background: 'var(--bg-sunken)', border: '1px solid var(--border)',
                fontSize: 11, color: 'var(--text-muted)',
              }}>
                {pred.model_count} Modelle im Ensemble
              </div>
            )}
            <Button
              variant={inWatchlist ? 'soft' : 'secondary'}
              size="md"
              icon={inWatchlist ? <Icon.Star /> : <Icon.StarOutline />}
              onClick={toggleWatchlist}
              disabled={wlBusy}
            >
              {inWatchlist ? 'In Watchlist' : 'Zur Watchlist'}
            </Button>
          </div>
        </div>

        {/* Live price hero */}
        <div style={{
          marginTop: 24,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', padding: '20px 28px',
          display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
              Aktueller Kurs
            </div>
            {quote?.price != null ? (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 4 }}>
                <span className="mono display" style={{ fontSize: 48, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1 }}>
                  {formatCurrency(quote.price)}
                </span>
                <Pill tone={quoteUp ? 'up' : 'down'} size="md" icon={quoteUp ? <Icon.TrendUp /> : <Icon.TrendDown />}>
                  {quoteUp ? '+' : ''}{(quote.change_pct ?? 0).toFixed(2)}%
                </Pill>
              </div>
            ) : (
              <div style={{ fontSize: 36, color: 'var(--text-muted)', marginTop: 4 }}>—</div>
            )}
            {quote && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'var(--font-mono)' }}>
                {(quote.change ?? 0) >= 0 ? '+' : ''}${Math.abs(quote.change ?? 0).toFixed(2)} heute
                {quote.prev_close != null && ` · Vortag ${formatCurrency(quote.prev_close)}`}
              </div>
            )}
          </div>

          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 13 }}>
              <span style={{
                width: 16, height: 16, borderRadius: 999,
                border: '2px solid var(--border-strong)', borderTopColor: 'var(--accent)',
                animation: 'spin 0.8s linear infinite', display: 'block',
              }} />
              Berechne Ensemble-Prognose…
            </div>
          )}
        </div>

        {/* ── 3 Horizon Cards ── */}
        <div style={{ marginTop: 20, display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          {pred?.horizons?.map((h, i) => (
            <HorizonCard
              key={h.days}
              h={h}
              lastClose={lastClose}
              active={activeHorizon === i}
              onClick={() => setActive(i)}
            />
          ))}
          {!pred && !loading && (
            <div style={{
              flex: 1, minHeight: 200,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', fontSize: 13,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xl)',
            }}>
              {error ? `Fehler: ${error}` : 'Prognose wird geladen…'}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div style={{ marginTop: 32, display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
          {TABS.map(t => (
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

        {/* Tab: Prognose & Chart */}
        {tab === 'forecast' && (
          <div style={{ marginTop: 24 }}>
            {error && (
              <div style={{
                padding: '14px 20px', background: 'var(--down-soft)',
                border: '1px solid var(--down)', borderRadius: 'var(--radius-md)',
                color: 'var(--down)', fontSize: 13, marginBottom: 16,
              }}>
                Fehler: {error}
              </div>
            )}

            {/* OHLC hover bar */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 16,
              padding: '10px 20px', marginBottom: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
            }}>
              <span className="mono" style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)', minWidth: 60 }}>
                {ticker}
              </span>
              {hovered ? (
                <span style={{ display: 'flex', flexWrap: 'wrap', gap: '0 20px' }}>
                  {[
                    { label: 'Open',  val: hovered.open,  color: 'var(--text-dim)' },
                    { label: 'High',  val: hovered.high,  color: 'var(--mint)' },
                    { label: 'Low',   val: hovered.low,   color: 'var(--coral)' },
                    { label: 'Close', val: hovered.close, color: 'var(--text)' },
                  ].map(({ label, val, color }) => (
                    <span key={label} style={{ display: 'inline-flex', gap: 5, alignItems: 'baseline' }}>
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, letterSpacing: '0.06em' }}>{label}</span>
                      <span className="mono" style={{ color, fontWeight: 600, fontSize: 13 }}>
                        ${val?.toFixed(2)}
                      </span>
                    </span>
                  ))}
                </span>
              ) : (
                <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                  Über den Chart hovern für OHLC-Werte
                </span>
              )}
            </div>

            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xl)', padding: 20,
            }}>
              <CandlestickChart
                ticker={ticker}
                range={range}
                onRangeChange={setRange}
                onHover={setHovered}
                currentPrice={quote?.price ?? null}
                liveBar={quote?.live_candle ?? null}
                predictedPrice={activeH?.p50_price ?? null}
                forecast={pred ? { horizons: pred.horizons, last_close: pred.last_close } : null}
              />
            </div>
          </div>
        )}

        {/* Tab: Kennzahlen */}
        {tab === 'stats' && (
          <div style={{ marginTop: 24 }}>
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-xl)', padding: 28,
            }}>
              <h2 className="display" style={{ fontSize: 22, fontWeight: 600, marginBottom: 20 }}>Kennzahlen</h2>

              {pred ? (
                <>
                  {/* Per-horizon table */}
                  <div style={{ overflowX: 'auto', marginBottom: 28 }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border)' }}>
                          {['Horizont', 'P10 Rendite', 'P50 Rendite', 'P90 Rendite', 'P10 Kurs', 'P50 Kurs', 'P90 Kurs', 'Richtung', 'Prob'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 600, textAlign: 'left', fontSize: 11, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pred.horizons.map((h, i) => {
                          const up = h.p50_ret >= 0
                          return (
                            <tr
                              key={h.days}
                              onClick={() => setActive(i)}
                              style={{
                                borderBottom: '1px solid var(--border)',
                                background: activeHorizon === i ? 'var(--bg-elev)' : 'transparent',
                                cursor: 'pointer',
                              }}
                            >
                              <td style={{ padding: '10px 12px', fontWeight: 700 }} className="mono">{h.label}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }} className="mono">{fmtRet(h.p10_ret)}</td>
                              <td style={{ padding: '10px 12px', color: up ? 'var(--mint)' : 'var(--coral)', fontWeight: 700 }} className="mono">{fmtRet(h.p50_ret)}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }} className="mono">{fmtRet(h.p90_ret)}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }} className="mono">{formatCurrency(h.p10_price)}</td>
                              <td style={{ padding: '10px 12px', fontWeight: 700 }} className="mono">{formatCurrency(h.p50_price)}</td>
                              <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }} className="mono">{formatCurrency(h.p90_price)}</td>
                              <td style={{ padding: '10px 12px' }}>
                                <Pill tone={up ? 'up' : 'down'} size="sm">{up ? '▲ Long' : '▼ Short'}</Pill>
                              </td>
                              <td style={{ padding: '10px 12px', fontWeight: 600 }} className="mono">
                                {Math.round(Math.max(h.direction_prob, 1 - h.direction_prob) * 100)}%
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>

                  {/* Model info */}
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                    {[
                      { label: 'Ticker',         value: ticker },
                      { label: 'Letzter Kurs',   value: formatCurrency(pred.last_close) },
                      { label: 'Ensemble-Modelle', value: pred.model_count + 'x' },
                      { label: 'Architekturen',  value: 'LSTM-v2 + PatchTST' },
                      ...(quote ? [
                        { label: 'Live-Kurs',    value: formatCurrency(quote.price) },
                        { label: 'Markt-Status', value: quote.market_state ?? '—' },
                      ] : []),
                    ].map(s => (
                      <div key={s.label} style={{
                        padding: 14, background: 'var(--bg-sunken)',
                        borderRadius: 'var(--radius-md)',
                      }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                          {s.label}
                        </div>
                        <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 4 }}>
                          {s.value}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : loading ? (
                <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Daten werden geladen…</div>
              ) : (
                <div style={{ color: 'var(--text-muted)', padding: '20px 0' }}>Keine Daten verfügbar.</div>
              )}
            </div>
          </div>
        )}

        {/* Disclaimer */}
        <div style={{
          marginTop: 32, padding: '14px 20px',
          background: 'var(--peach-soft)', borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', gap: 10,
          fontSize: 12, color: 'var(--text-dim)',
        }}>
          <Icon.Info style={{ color: 'var(--peach)', flexShrink: 0 }} />
          DSAI-Studentenprojekt · Nur zu Bildungszwecken · Keine Anlageberatung.
          Prognosen basieren auf historischen Daten und sind kein Garant zukünftiger Kursverläufe.
        </div>
      </div>
    </div>

    {showAuth && <AuthModal initialMode="login" onClose={() => setShowAuth(false)} />}
    </ErrorBoundary>
  )
}
