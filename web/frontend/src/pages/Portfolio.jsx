import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { supabase } from '../lib/supabase.js'
import AuthModal from '../components/AuthModal.jsx'
import TopNav from '../components/TopNav.jsx'
import {
  Button, StockLogo, SignalBadge, Skeleton, useCountUp,
  formatCurrency,
} from '../components/ui.jsx'

// ── Forecast chart ────────────────────────────────────────────

function ForecastChart({ lastClose, horizons, height = 200 }) {
  const lineRef = useRef(null)
  const [pathLen, setPathLen] = useState(null)
  const [drawn, setDrawn]     = useState(false)

  useEffect(() => {
    setDrawn(false)
    setPathLen(null)
    if (lineRef.current) {
      const len = lineRef.current.getTotalLength()
      setPathLen(len)
      requestAnimationFrame(() => requestAnimationFrame(() => setDrawn(true)))
    }
  }, [horizons])

  if (!horizons?.length) return (
    <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, color: 'var(--text-muted)', fontSize: 13 }}>
      <Skeleton width={180} height={14} />
    </div>
  )

  const points = [
    { day: 0, price: lastClose },
    ...horizons.map(h => ({ day: h.days, price: h.p50_price })),
  ]

  const prices = points.map(p => p.price)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const padding = (maxP - minP) * 0.15 || lastClose * 0.005
  const lo = minP - padding
  const hi = maxP + padding
  const range = hi - lo

  const W = 800
  const H = height
  const pad = { t: 20, r: 20, b: 32, l: 70 }
  const innerW = W - pad.l - pad.r
  const innerH = H - pad.t - pad.b

  const maxDay = points[points.length - 1].day
  const toX = d => pad.l + (d / maxDay) * innerW
  const toY = v => pad.t + innerH - ((v - lo) / range) * innerH

  const up = points[points.length - 1].price >= lastClose
  const lineColor = up ? 'var(--up)' : 'var(--down)'
  const fillId = `grad-${up ? 'up' : 'dn'}`

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${toX(p.day).toFixed(1)},${toY(p.price).toFixed(1)}`).join(' ')
  const areaPath = linePath
    + ` L${toX(maxDay).toFixed(1)},${(pad.t + innerH).toFixed(1)}`
    + ` L${toX(0).toFixed(1)},${(pad.t + innerH).toFixed(1)} Z`

  const yTicks = 4
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => lo + (range / yTicks) * i)
  const xLabels = [
    { day: 0, label: 'Heute' },
    { day: horizons[0]?.days, label: '1T' },
    { day: horizons[1]?.days, label: '1W' },
    { day: horizons[2]?.days, label: '1M' },
  ].filter(x => x.day != null)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }}>
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {ticks.map((v, i) => (
        <g key={i}>
          <line x1={pad.l} y1={toY(v)} x2={W - pad.r} y2={toY(v)} stroke="var(--border)" strokeWidth="0.8" />
          <text x={pad.l - 6} y={toY(v) + 4} textAnchor="end" fontSize="10" fill="var(--text-muted)">
            {v >= 1000 ? v.toFixed(0) : v.toFixed(2)}
          </text>
        </g>
      ))}

      <path d={areaPath} fill={`url(#${fillId})`}
        style={{ opacity: drawn ? 1 : 0, transition: 'opacity 600ms 800ms' }}
      />

      {/* Draw-on animated line */}
      <path
        ref={lineRef}
        d={linePath}
        fill="none"
        stroke={lineColor}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeDasharray={pathLen ?? 'none'}
        strokeDashoffset={drawn ? 0 : (pathLen ?? 0)}
        style={{ transition: pathLen ? 'stroke-dashoffset 1.1s cubic-bezier(0.16, 1, 0.3, 1)' : 'none' }}
      />

      {points.map((p, i) => (
        <g key={i} style={{ opacity: drawn ? 1 : 0, transition: `opacity 300ms ${300 + i * 180}ms` }}>
          <circle cx={toX(p.day)} cy={toY(p.price)} r={i === 0 ? 3.5 : 4.5}
            fill={i === 0 ? 'var(--text-muted)' : lineColor}
            stroke="var(--bg-card)" strokeWidth="2"
          />
          {i > 0 && (
            <text x={toX(p.day)} y={toY(p.price) - 10} textAnchor="middle" fontSize="10" fontWeight="600"
              fill={lineColor} fontFamily="var(--font-mono)">
              {formatCurrency(p.price)}
            </text>
          )}
        </g>
      ))}

      {xLabels.map(({ day, label }) => (
        <text key={day} x={toX(day)} y={H - 4} textAnchor="middle" fontSize="11" fill="var(--text-muted)">
          {label}
        </text>
      ))}
    </svg>
  )
}

// ── Single stock card ─────────────────────────────────────────

function StockForecastCard({ ticker, pred, onOpen }) {
  const [hover, setHover] = useState(false)
  const horizons  = pred?.horizons ?? []
  const signal    = pred?.signal ?? null
  const lastClose = pred?.last_close ?? null
  const h1        = horizons[0]
  const hLast     = horizons[horizons.length - 1]
  const monthPct  = hLast ? (Math.exp(hLast.p50_ret) - 1) * 100 : null
  const up        = monthPct != null && monthPct >= 0

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onOpen}
      style={{
        background: hover ? 'var(--bg-elev)' : 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '20px 24px',
        cursor: 'pointer',
        transition: 'background 150ms',
      }}
    >
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <StockLogo ticker={ticker} size={40} />
          <div>
            <div className="mono" style={{ fontWeight: 700, fontSize: 15 }}>{ticker}</div>
            {lastClose != null && (
              <div className="mono" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {formatCurrency(lastClose)}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {monthPct != null && (
            <div style={{ textAlign: 'right' }}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 700, color: up ? 'var(--up)' : 'var(--down)' }}>
                {(up ? '+' : '') + monthPct.toFixed(1)}%
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>in 1 Monat (P50)</div>
            </div>
          )}
          <SignalBadge signal={signal} probUp={h1?.direction_prob ?? null} />
        </div>
      </div>

      {/* Chart */}
      <ForecastChart lastClose={lastClose} horizons={horizons} height={190} />

      {/* Horizon summary row */}
      {horizons.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 14 }}>
          {horizons.map((h, i) => {
            const pct = (Math.exp(h.p50_ret) - 1) * 100
            const u = pct >= 0
            const labels = ['1 Tag', '1 Woche', '1 Monat']
            return (
              <div key={h.label} style={{
                background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)',
                padding: '8px 12px', textAlign: 'center',
              }}>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 4 }}>
                  {labels[i]}
                </div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 700, color: u ? 'var(--up)' : 'var(--down)' }}>
                  {(u ? '+' : '') + pct.toFixed(1)}%
                </div>
                <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                  {(h.direction_prob * 100).toFixed(0)}% {u ? '↑' : '↓'}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── Summary card with count-up ────────────────────────────────

function SummaryCard({ label, value, color }) {
  const animated = useCountUp(value, 900)
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600, marginBottom: 6 }}>{label}</div>
      <div className="mono" style={{ fontSize: 28, fontWeight: 700, color }}>{Math.round(animated)}</div>
    </div>
  )
}

// ── Market Heatmap ────────────────────────────────────────────

function HeatmapTile({ ticker, pred, onClick }) {
  const [rot, setRot] = useState({ x: 0, y: 0 })
  const [hover, setHover] = useState(false)
  const h1m = pred?.horizons?.[2]
  const pct = h1m ? (Math.exp(h1m.p50_ret) - 1) * 100 : null
  const signal = pred?.signal ?? null

  const intensity = pct != null ? Math.min(Math.abs(pct) / 8, 1) : 0
  const up = pct != null && pct >= 0

  let bg, border, textColor
  if (pct == null) {
    bg = 'var(--bg-elev)'; border = 'var(--border)'; textColor = 'var(--text-muted)'
  } else if (up) {
    bg = `oklch(from var(--up) l c h / ${0.08 + intensity * 0.28})`
    border = `oklch(from var(--up) l c h / ${0.2 + intensity * 0.5})`
    textColor = 'var(--up)'
  } else {
    bg = `oklch(from var(--down) l c h / ${0.08 + intensity * 0.28})`
    border = `oklch(from var(--down) l c h / ${0.2 + intensity * 0.5})`
    textColor = 'var(--down)'
  }

  const glowSize = hover ? 20 : 8
  const glowStyle = signal === 'long'
    ? { boxShadow: `0 0 ${glowSize}px oklch(from var(--up) l c h / 0.4)` }
    : signal === 'short'
    ? { boxShadow: `0 0 ${glowSize}px oklch(from var(--down) l c h / 0.4)` }
    : {}

  const handleMouseMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientY - r.top  - r.height / 2) / (r.height / 2)) * -10
    const y = ((e.clientX - r.left - r.width  / 2) / (r.width  / 2)) *  10
    setRot({ x, y })
  }

  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setRot({ x: 0, y: 0 }) }}
      onMouseMove={handleMouseMove}
      onClick={onClick}
      style={{
        background: bg,
        border: `1px solid ${border}`,
        borderRadius: 'var(--radius-md)',
        padding: '16px 14px',
        cursor: 'pointer',
        transform: `perspective(600px) rotateX(${rot.x}deg) rotateY(${rot.y}deg) scale(${hover ? 1.04 : 1})`,
        transition: hover ? 'transform 80ms, box-shadow 200ms' : 'transform 350ms, box-shadow 200ms',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 6, minHeight: 90,
        willChange: 'transform',
        ...glowStyle,
      }}
    >
      <div className="mono" style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{ticker}</div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 800, color: textColor, lineHeight: 1 }}>
        {pct != null ? `${up ? '+' : ''}${pct.toFixed(1)}%` : '···'}
      </div>
      <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        1 Monat
      </div>
      {signal && (
        <div style={{
          fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
          color: signal === 'long' ? 'var(--up)' : signal === 'short' ? 'var(--down)' : 'var(--text-muted)',
          background: signal === 'long' ? 'var(--up-soft)' : signal === 'short' ? 'var(--down-soft)' : 'var(--bg-sunken)',
          padding: '2px 8px', borderRadius: 999,
        }}>
          {signal}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────

export default function Portfolio({ theme, toggleTheme }) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [watchlist, setWatchlist] = useState([])
  const [preds, setPreds]         = useState({})
  const [loading, setLoading]     = useState(true)
  const [showAuth, setShowAuth]   = useState(false)

  useEffect(() => {
    if (!user) { setShowAuth(true); setLoading(false) }
  }, [user])

  const fetchPred = useCallback((ticker) => {
    fetch('/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticker }),
    })
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(data => { if (data) setPreds(prev => ({ ...prev, [ticker]: data })) })
  }, [])

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
        tickers.forEach(fetchPred)
      })
  }, [user, fetchPred])

  const bullish = watchlist.filter(t => preds[t]?.signal === 'long').length
  const bearish = watchlist.filter(t => preds[t]?.signal === 'short').length
  const neutral = watchlist.filter(t => preds[t]?.signal === 'flat').length

  return (
    <div className="fadeIn" style={{ minHeight: '100vh' }}>
      <TopNav theme={theme} toggleTheme={toggleTheme} onLogin={() => navigate('/')} />

      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      <div style={{ padding: '24px 32px 80px', maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ marginBottom: 32 }}>
          <h1 className="display" style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.02em' }}>
            Watchlist-Vorschau
          </h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 14 }}>
            Preis-Forecast für deine Watchlist — 1 Tag, 1 Woche, 1 Monat (P10 / P50 / P90).
          </p>
        </div>

        {!user && !loading && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>🔒</div>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Anmeldung erforderlich</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>
              Melde dich an, um Forecast-Graphen deiner Watchlist zu sehen.
            </p>
            <Button variant="primary" onClick={() => setShowAuth(true)}>Anmelden</Button>
          </div>
        )}

        {user && loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14 }}>
              {[0,1,2,3].map(i => (
                <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '16px 20px' }}>
                  <Skeleton width={60} height={11} radius={6} style={{ marginBottom: 10 }} />
                  <Skeleton width={40} height={28} radius={6} />
                </div>
              ))}
            </div>
            {[0,1,2].map(i => (
              <div key={i} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '20px 24px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <Skeleton width={40} height={40} radius={12} />
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <Skeleton width={80} height={14} />
                    <Skeleton width={60} height={11} />
                  </div>
                </div>
                <Skeleton width="100%" height={190} radius={12} />
              </div>
            ))}
          </div>
        )}

        {user && !loading && watchlist.length === 0 && (
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: 48, textAlign: 'center' }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>Watchlist ist leer</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: 14, marginBottom: 24 }}>Füge Aktien über das Dashboard hinzu.</p>
            <Button variant="primary" onClick={() => navigate('/dashboard')}>Zum Dashboard</Button>
          </div>
        )}

        {user && watchlist.length > 0 && (
          <>
            {/* Summary */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 14, marginBottom: 28 }}>
              {[
                { label: 'Aktien',   value: watchlist.length, color: 'var(--text)' },
                { label: 'Bullisch', value: bullish,           color: 'var(--up)' },
                { label: 'Bärisch',  value: bearish,           color: 'var(--down)' },
                { label: 'Neutral',  value: neutral,           color: 'var(--text-muted)' },
              ].map(({ label, value, color }) => (
                <SummaryCard key={label} label={label} value={value} color={color} />
              ))}
            </div>

            {/* Heatmap */}
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)', padding: '20px 24px', marginBottom: 28,
            }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 16 }}>
                Market Heatmap — 1-Monats-Forecast
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 10 }}>
                {watchlist.map(ticker => (
                  <HeatmapTile
                    key={ticker}
                    ticker={ticker}
                    pred={preds[ticker] ?? null}
                    onClick={() => navigate(`/stock/${ticker}`)}
                  />
                ))}
              </div>
            </div>

            {/* Cards with charts */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {watchlist.map(ticker => (
                <StockForecastCard
                  key={ticker}
                  ticker={ticker}
                  pred={preds[ticker] ?? null}
                  onOpen={() => navigate(`/stock/${ticker}`)}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
