// ============================================================
//  Shared UI components — Prognosix design system
// ============================================================
import { useState, useMemo, useEffect } from 'react'

// ── useCountUp hook ───────────────────────────────────────────
export function useCountUp(target, duration = 1100) {
  const [val, setVal] = useState(0)
  useEffect(() => {
    setVal(0)
    const start = Date.now()
    const tick = () => {
      const t = Math.min((Date.now() - start) / duration, 1)
      const eased = 1 - Math.pow(1 - t, 3)
      setVal(target * eased)
      if (t < 1) requestAnimationFrame(tick)
      else setVal(target)
    }
    requestAnimationFrame(tick)
  }, [target, duration])
  return val
}

// ── Skeleton ──────────────────────────────────────────────────
export function Skeleton({ width, height, radius = 10, style }) {
  return (
    <div style={{
      width, height, borderRadius: radius,
      background: 'linear-gradient(90deg, var(--bg-elev) 25%, var(--bg-card) 50%, var(--bg-elev) 75%)',
      backgroundSize: '200% 100%',
      animation: 'skeleton-wave 1.4s ease-in-out infinite',
      ...style,
    }} />
  )
}

// ── LiveDot ───────────────────────────────────────────────────
export function LiveDot({ label = 'LIVE', color = 'var(--up)' }) {
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        width: 7, height: 7, borderRadius: 999,
        background: color, flexShrink: 0,
        animation: 'pulse-ring 2s infinite',
        display: 'inline-block',
      }} />
      <span className="mono" style={{ fontSize: 11, fontWeight: 700, color, letterSpacing: '0.06em' }}>
        {label}
      </span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────
export function formatCurrency(v) {
  if (v == null) return '—'
  return '$' + v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function formatPct(v) {
  const sign = v >= 0 ? '+' : ''
  return sign + v.toFixed(2) + '%'
}

// ── Logo ─────────────────────────────────────────────────────
export function Logo({ size = 28 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-label="Prognosix">
      <rect x="2" y="2" width="36" height="36" rx="12" fill="var(--accent)" />
      <path
        d="M8 28 L15 22 L22 25 L32 12"
        stroke="var(--bg)" strokeWidth="3.2"
        strokeLinecap="round" strokeLinejoin="round" fill="none"
      />
      <circle cx="32" cy="12" r="3.2" fill="var(--bg)" />
    </svg>
  )
}

export function WordMark({ size = 22 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <Logo size={size + 8} />
      <span className="display" style={{ fontSize: size, fontWeight: 600, letterSpacing: '-0.02em' }}>
        prognosix
      </span>
    </div>
  )
}

// ── StockLogo ────────────────────────────────────────────────

// Ordered list of logo URL templates to try (per ticker, no API key needed)
function logoSources(ticker) {
  const t = ticker.toUpperCase()
  return [
    // Parqet asset CDN — very broad ticker coverage
    `https://assets.parqet.com/logos/symbol/${t}?format=jpg`,
    // Financial Modeling Prep — good US stock coverage
    `https://financialmodelingprep.com/image-stock/${t}.png`,
  ]
}

// Fallback avatar colors (used when all image sources fail)
const TICKER_COLORS = {
  NVDA:  { bg: 'oklch(0.55 0.18 145)' },
  TSLA:  { bg: 'oklch(0.55 0.22 25)'  },
  MSFT:  { bg: 'oklch(0.60 0.18 55)'  },
  AAPL:  { bg: 'oklch(0.35 0.01 270)' },
  GOOGL: { bg: 'oklch(0.60 0.18 195)' },
  META:  { bg: 'oklch(0.55 0.18 265)' },
  AMZN:  { bg: 'oklch(0.60 0.18 70)'  },
  NFLX:  { bg: 'oklch(0.48 0.22 20)'  },
  AMD:   { bg: 'oklch(0.48 0.18 25)'  },
}

export function StockLogo({ ticker, size = 40, radius }) {
  // sourceIdx: which URL we're currently trying; -1 = all failed → show avatar
  const [sourceIdx, setSourceIdx] = useState(0)
  const sources = useMemo(() => logoSources(ticker ?? ''), [ticker])
  const currentSrc = sourceIdx < sources.length ? sources[sourceIdx] : null

  const c = TICKER_COLORS[ticker?.toUpperCase()] ?? {
    bg: 'oklch(0.60 0.12 ' + ((ticker?.charCodeAt(0) ?? 65) * 7 % 360) + ')',
  }
  const letters = ticker ? ticker.slice(0, ticker.length >= 4 ? 3 : 2) : '?'
  const br = radius ?? size * 0.3

  return (
    <div style={{
      width: size, height: size,
      borderRadius: br,
      background: currentSrc ? 'white' : c.bg,
      border: currentSrc ? '1px solid var(--border)' : 'none',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {currentSrc ? (
        <img
          key={currentSrc}
          src={currentSrc}
          alt={ticker}
          onError={() => setSourceIdx(i => i + 1)}
          style={{ width: '72%', height: '72%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <span style={{
          color: 'white',
          fontFamily: 'var(--font-display)',
          fontWeight: 700,
          fontSize: size * 0.34,
          letterSpacing: '-0.02em',
        }}>
          {letters}
        </span>
      )}
    </div>
  )
}

// ── Pill ─────────────────────────────────────────────────────
export function Pill({ children, tone = 'neutral', size = 'md', icon }) {
  const tones = {
    neutral: { bg: 'var(--bg-elev)',    color: 'var(--text-dim)' },
    up:      { bg: 'var(--up-soft)',    color: 'var(--up)' },
    down:    { bg: 'var(--down-soft)',  color: 'var(--down)' },
    accent:  { bg: 'var(--accent-soft)', color: 'var(--accent)' },
    peach:   { bg: 'var(--peach-soft)', color: 'var(--peach)' },
    sky:     { bg: 'var(--sky-soft)',   color: 'var(--sky)' },
  }
  const s = tones[tone] || tones.neutral
  const sizes = {
    sm: { padding: '3px 10px', fontSize: 11, radius: 999 },
    md: { padding: '5px 12px', fontSize: 12, radius: 999 },
    lg: { padding: '7px 16px', fontSize: 13, radius: 999 },
  }
  const sz = sizes[size]
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      background: s.bg, color: s.color,
      padding: sz.padding, borderRadius: sz.radius,
      fontSize: sz.fontSize, fontWeight: 600,
      lineHeight: 1.2, whiteSpace: 'nowrap',
    }}>
      {icon}{children}
    </span>
  )
}

// ── Button ───────────────────────────────────────────────────
export function Button({ children, variant = 'primary', size = 'md', icon, iconRight, onClick, type, disabled, fullWidth }) {
  const [hover, setHover] = useState(false)
  const variants = {
    primary: {
      bg: 'var(--accent)', color: 'var(--bg)',
      hoverBg: 'color-mix(in oklch, var(--accent) 88%, black)',
    },
    secondary: {
      bg: 'var(--bg-elev)', color: 'var(--text)',
      hoverBg: 'var(--bg-card)',
      border: '1px solid var(--border)',
    },
    ghost: {
      bg: 'transparent', color: 'var(--text-dim)',
      hoverBg: 'var(--bg-soft)',
    },
    soft: {
      bg: 'var(--accent-soft)', color: 'var(--accent)',
      hoverBg: 'color-mix(in oklch, var(--accent) 25%, transparent)',
    },
  }
  const v = variants[variant] || variants.primary
  const sizes = {
    sm: { padding: '8px 14px',  fontSize: 13, radius: 12 },
    md: { padding: '12px 20px', fontSize: 14, radius: 14 },
    lg: { padding: '16px 28px', fontSize: 15, radius: 16 },
  }
  const sz = sizes[size]
  return (
    <button
      type={type || 'button'}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        background: hover && !disabled ? v.hoverBg : v.bg,
        color: v.color,
        border: v.border || 'none',
        padding: sz.padding, borderRadius: sz.radius,
        fontSize: sz.fontSize, fontWeight: 600, lineHeight: 1.2,
        transition: 'background 180ms, transform 180ms',
        transform: hover && !disabled ? 'translateY(-1px)' : 'none',
        boxShadow: variant === 'primary' && hover && !disabled ? 'var(--shadow-md)' : 'none',
        width: fullWidth ? '100%' : 'auto',
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {icon}{children}{iconRight}
    </button>
  )
}

// ── Sparkline ────────────────────────────────────────────────
export function Sparkline({ data, width = 100, height = 32, color = 'var(--accent)', fill = true }) {
  const gradId = useMemo(() => 'spark-' + Math.random().toString(36).slice(2, 8), [])
  if (!data || data.length < 2) return <div style={{ width, height }} />
  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const points = data.map((v, i) => [
    (i / (data.length - 1)) * width,
    height - ((v - min) / range) * (height - 4) - 2,
  ])
  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`).join(' ')
  const areaPath = `${path} L ${width} ${height} L 0 ${height} Z`
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      {fill && (
        <>
          <defs>
            <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradId})`} />
        </>
      )}
      <path d={path} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ── Confidence widgets ────────────────────────────────────────
export function ConfidenceRing({ value, size = 96 }) {
  const radius = size * 0.42
  const c = 2 * Math.PI * radius
  const offset = c * (1 - value / 100)
  const tone = value >= 70 ? 'var(--mint)' : value >= 50 ? 'var(--peach)' : 'var(--coral)'
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--bg-sunken)" strokeWidth="8" />
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={tone} strokeWidth="8"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 800ms cubic-bezier(0.16, 1, 0.3, 1)' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      }}>
        <span className="mono" style={{ fontSize: size * 0.26, fontWeight: 700, color: tone }}>
          {Math.round(value)}
        </span>
        <span style={{ fontSize: size * 0.11, color: 'var(--text-muted)', marginTop: 2 }}>/100</span>
      </div>
    </div>
  )
}

export function ConfidenceBar({ value, width = 180 }) {
  const tone = value >= 70 ? 'var(--mint)' : value >= 50 ? 'var(--peach)' : 'var(--coral)'
  return (
    <div style={{ width, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <span className="mono" style={{ fontSize: 28, fontWeight: 700, color: tone }}>
          {Math.round(value)}<span style={{ fontSize: 16, color: 'var(--text-muted)' }}>%</span>
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Konfidenz
        </span>
      </div>
      <div style={{ height: 10, background: 'var(--bg-sunken)', borderRadius: 999, overflow: 'hidden' }}>
        <div style={{
          width: `${value}%`, height: '100%',
          background: tone, borderRadius: 999,
          transition: 'width 800ms cubic-bezier(0.16, 1, 0.3, 1)',
        }} />
      </div>
    </div>
  )
}

export function ConfidenceNumber({ value }) {
  const tone = value >= 70 ? 'var(--mint)' : value >= 50 ? 'var(--peach)' : 'var(--coral)'
  const label = value >= 75 ? 'hoch' : value >= 55 ? 'mittel' : 'gering'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-start' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        KI-Konfidenz
      </span>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="mono" style={{ fontSize: 44, fontWeight: 700, color: tone, lineHeight: 1 }}>
          {Math.round(value)}
        </span>
        <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>/100</span>
        <Pill tone={value >= 70 ? 'up' : value >= 50 ? 'peach' : 'down'} size="sm">{label}</Pill>
      </div>
    </div>
  )
}

export function ConfidenceWidget({ value, style }) {
  if (style === 'bar')    return <ConfidenceBar value={value} />
  if (style === 'number') return <ConfidenceNumber value={value} />
  return <ConfidenceRing value={value} />
}

// ── MiniConfidence (for table rows) ──────────────────────────
export function MiniConfidence({ value }) {
  const tone = value >= 70 ? 'var(--mint)' : value >= 50 ? 'var(--peach)' : 'var(--coral)'
  const r = 16, c = 2 * Math.PI * r
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
  )
}

// ── SignalBadge ──────────────────────────────────────────────
export function SignalBadge({ signal, probUp }) {
  if (!signal) {
    return (
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        padding: '4px 10px', borderRadius: 999,
        background: 'var(--bg-elev)', color: 'var(--text-muted)',
        fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
      }}>
        —
      </span>
    )
  }

  const configs = {
    long: {
      bg: 'var(--up-soft)', color: 'var(--up)',
      label: `LONG ${probUp != null ? `${(probUp * 100) | 0}%` : ''}`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" />
        </svg>
      ),
    },
    short: {
      bg: 'var(--down-soft)', color: 'var(--down)',
      label: `SHORT ${probUp != null ? `${((1 - probUp) * 100) | 0}%` : ''}`,
      icon: (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" />
        </svg>
      ),
    },
    flat: {
      bg: 'var(--bg-elev)', color: 'var(--text-dim)',
      label: 'FLAT',
      icon: (
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      ),
    },
  }

  const c = configs[signal] ?? configs.flat
  const glowAnim = signal === 'long' || signal === 'short'
    ? { animation: 'pulse-glow 2.2s ease-in-out infinite' }
    : {}
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 5,
      padding: '4px 10px', borderRadius: 999,
      background: c.bg, color: c.color,
      fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
      letterSpacing: '0.04em',
      ...glowAnim,
    }}>
      {c.icon}{c.label}
    </span>
  )
}

// ── Toast ─────────────────────────────────────────────────────
export function Toast({ message, tone = 'neutral', onClose }) {
  useEffect(() => {
    const t = setTimeout(onClose, 5000)
    return () => clearTimeout(t)
  }, [onClose])

  const tones = {
    neutral: { bg: 'var(--bg-elev)',   color: 'var(--text)',  border: 'var(--border-strong)' },
    up:      { bg: 'var(--up-soft)',   color: 'var(--up)',    border: 'var(--up)' },
    down:    { bg: 'var(--down-soft)', color: 'var(--down)',  border: 'var(--down)' },
    accent:  { bg: 'var(--accent-soft)', color: 'var(--accent)', border: 'var(--accent)' },
  }
  const s = tones[tone] ?? tones.neutral
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      background: s.bg, color: s.color,
      border: `1px solid ${s.border}`,
      borderRadius: 'var(--radius-md)', padding: '12px 16px',
      boxShadow: 'var(--shadow-md)', fontSize: 13, fontWeight: 500,
      minWidth: 260, maxWidth: 380,
      animation: 'fadeIn 200ms ease',
    }}>
      <span>{message}</span>
      <button onClick={onClose} style={{ background: 'none', color: 'inherit', opacity: 0.6, flexShrink: 0 }}>
        <Icon.X />
      </button>
    </div>
  )
}

export function ToastContainer({ toasts, onClose }) {
  if (!toasts.length) return null
  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24,
      display: 'flex', flexDirection: 'column', gap: 8,
      zIndex: 9999,
    }}>
      {toasts.map(t => (
        <Toast key={t.id} message={t.message} tone={t.tone} onClose={() => onClose(t.id)} />
      ))}
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────
export const Icon = {
  Search: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="7" /><line x1="16.5" y1="16.5" x2="21" y2="21" />
    </svg>
  ),
  Arrow: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
    </svg>
  ),
  ArrowBack: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
    </svg>
  ),
  Plus: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  Star: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  StarOutline: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" {...p}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  TrendUp: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  TrendDown: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" /><polyline points="17 18 23 18 23 12" />
    </svg>
  ),
  Sun: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  ),
  Moon: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  ),
  Logout: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  ),
  Settings: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  Sparkle: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" {...p}>
      <path d="M12 2l1.8 5.5L19 9.3l-5.2 1.8L12 16.6l-1.8-5.5L5 9.3l5.2-1.8L12 2zM20 14l.9 2.7L23.6 17.6l-2.7.9L20 21.2l-.9-2.7L16.4 17.6l2.7-.9L20 14zM6 16l.6 1.9L8.5 18.5l-1.9.6L6 21l-.6-1.9L3.5 18.5l1.9-.6L6 16z" />
    </svg>
  ),
  X: (p) => (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  Info: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" /><line x1="12" y1="16" x2="12" y2="12" />
      <circle cx="12" cy="8.5" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  ),
  Bell: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  BellOff: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ),
  Refresh: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 4 23 10 17 10" />
      <polyline points="1 20 1 14 7 14" />
      <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
    </svg>
  ),
  BarChart: (p) => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  ),
}
