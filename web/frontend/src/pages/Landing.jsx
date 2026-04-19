import { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import AuthModal from '../components/AuthModal.jsx'
import TopNav from '../components/TopNav.jsx'
import {
  Pill, Button, StockLogo, Sparkline, ConfidenceRing,
  Icon, formatPct,
} from '../components/ui.jsx'

// Static demo stocks for the landing page hero section
const DEMO_STOCKS = [
  {
    ticker: 'NVDA', name: 'Nvidia Corp.', changePct: 1.67, price: 142.87,
    spark: [130, 132, 128, 135, 138, 140, 136, 139, 141, 142, 140, 143, 142, 145, 143, 142, 144, 143, 141, 142],
  },
  {
    ticker: 'MSFT', name: 'Microsoft Corp.', changePct: 0.91, price: 431.12,
    spark: [415, 418, 422, 419, 425, 423, 428, 426, 430, 429, 431, 428, 432, 431, 433, 430, 432, 429, 430, 431],
  },
  {
    ticker: 'SAP', name: 'SAP SE', changePct: -0.62, price: 228.14,
    spark: [232, 230, 228, 229, 227, 230, 228, 225, 226, 228, 229, 227, 226, 228, 230, 228, 227, 229, 228, 228],
  },
]

function Typewriter({ text, delay = 0, speed = 52 }) {
  const [shown, setShown] = useState('')
  const [blink, setBlink] = useState(true)
  useEffect(() => {
    let i = 0
    setShown('')
    const start = setTimeout(() => {
      const iv = setInterval(() => {
        i++
        setShown(text.slice(0, i))
        if (i >= text.length) {
          clearInterval(iv)
          setTimeout(() => setBlink(false), 800)
        }
      }, speed)
      return () => clearInterval(iv)
    }, delay)
    return () => clearTimeout(start)
  }, [text, delay, speed])

  return (
    <>
      {shown}
      {blink && (
        <span style={{
          display: 'inline-block', width: '3px', height: '0.85em',
          background: 'var(--accent)', marginLeft: 3, verticalAlign: 'middle',
          animation: 'cursor-in 0.7s ease-in-out infinite alternate',
        }} />
      )}
    </>
  )
}

function ParticleCanvas() {
  const ref = useRef(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    let raf
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize()
    window.addEventListener('resize', resize)

    const N = 55
    const particles = Array.from({ length: N }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      r: Math.random() * 1.8 + 0.6,
      a: Math.random() * 0.5 + 0.15,
    }))

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy
        if (p.x < 0) p.x = canvas.width
        if (p.x > canvas.width) p.x = 0
        if (p.y < 0) p.y = canvas.height
        if (p.y > canvas.height) p.y = 0

        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `oklch(0.78 0.12 295 / ${p.a})`
        ctx.fill()
      }
      // Draw lines between nearby particles
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x
          const dy = particles[i].y - particles[j].y
          const dist = Math.sqrt(dx * dx + dy * dy)
          if (dist < 100) {
            ctx.beginPath()
            ctx.moveTo(particles[i].x, particles[i].y)
            ctx.lineTo(particles[j].x, particles[j].y)
            ctx.strokeStyle = `oklch(0.78 0.12 295 / ${0.12 * (1 - dist / 100)})`
            ctx.lineWidth = 0.6
            ctx.stroke()
          }
        }
      }
      raf = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <canvas ref={ref} style={{
      position: 'absolute', inset: 0, width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: 0,
    }} />
  )
}

function HeroCard() {
  return (
    <div style={{ position: 'relative', animation: 'fadeInUp 700ms cubic-bezier(0.16, 1, 0.3, 1) both' }}>
      {/* Background blobs */}
      <div style={{
        position: 'absolute', top: '10%', right: '-10%',
        width: 180, height: 180, borderRadius: '50%',
        background: 'var(--peach-soft)', filter: 'blur(40px)',
      }} />
      <div style={{
        position: 'absolute', bottom: '-10%', left: '-10%',
        width: 200, height: 200, borderRadius: '50%',
        background: 'var(--mint-soft)', filter: 'blur(50px)',
      }} />

      {/* Main card */}
      <div style={{
        position: 'relative',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)', padding: 28,
        boxShadow: 'var(--shadow-lg)',
        animation: 'floaty 6s ease-in-out infinite',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StockLogo ticker="NVDA" size={44} />
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nvidia Corp.</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '0.02em' }}>NVDA</div>
            </div>
          </div>
          <Pill tone="up" size="sm" icon={<Icon.TrendUp />}>Prognose</Pill>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="mono" style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.02em' }}>$142.87</span>
          <Pill tone="up" size="sm">+1.67%</Pill>
        </div>

        <div style={{ margin: '20px -8px -8px' }}>
          <Sparkline
            data={DEMO_STOCKS[0].spark}
            width={360} height={70}
            color="var(--accent)"
          />
        </div>

        <div style={{
          marginTop: 12, padding: 16,
          background: 'var(--bg-sunken)', borderRadius: 'var(--radius-md)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              7-Tage-Prognose
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 4 }}>
              <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--mint)' }}>+4.8%</span>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>$149.72</span>
            </div>
          </div>
          <ConfidenceRing value={71} size={72} />
        </div>
      </div>

      {/* Floating badge */}
      <div style={{
        position: 'absolute', top: -16, right: 20,
        background: 'var(--bg-elev)', border: '1px solid var(--border-strong)',
        borderRadius: 999, padding: '8px 14px',
        fontSize: 12, fontWeight: 600,
        display: 'flex', alignItems: 'center', gap: 8,
        boxShadow: 'var(--shadow-md)',
      }}>
        <span style={{
          width: 8, height: 8, borderRadius: 999, background: 'var(--mint)',
          animation: 'pulse-ring 2s infinite',
        }} />
        <span className="mono" style={{ color: 'var(--text-dim)' }}>LSTM v3 · LIVE</span>
      </div>
    </div>
  )
}

function MiniStockCard({ stock, onClick }) {
  const [hover, setHover] = useState(false)
  const up = stock.changePct >= 0
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', padding: 20, textAlign: 'left',
        transition: 'transform 220ms, border-color 220ms',
        transform: hover ? 'translateY(-3px)' : 'none',
        borderColor: hover ? 'var(--border-strong)' : 'var(--border)',
        cursor: 'pointer',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <StockLogo ticker={stock.ticker} size={36} />
          <div>
            <div className="mono" style={{ fontWeight: 600, fontSize: 14 }}>{stock.ticker}</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{stock.name}</div>
          </div>
        </div>
        <Sparkline data={stock.spark} width={64} height={28} color={up ? 'var(--mint)' : 'var(--coral)'} />
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>${stock.price.toFixed(2)}</span>
        <Pill tone={up ? 'up' : 'down'} size="sm" icon={up ? <Icon.TrendUp /> : <Icon.TrendDown />}>
          {formatPct(stock.changePct)}
        </Pill>
      </div>
    </button>
  )
}

export default function Landing({ theme, toggleTheme }) {
  const navigate   = useNavigate()
  const { user }   = useAuth()
  const [query, setQuery]     = useState('')
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('login')

  const go = useCallback(() => {
    const t = query.trim().toUpperCase()
    if (t) navigate(`/stock/${t}`)
  }, [query, navigate])

  const openLogin  = () => { setAuthMode('login');  setShowAuth(true) }
  const openSignup = () => { setAuthMode('signup'); setShowAuth(true) }

  return (
    <div className="fadeIn" style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Nav */}
      <TopNav theme={theme} toggleTheme={toggleTheme} onLogin={openLogin} onSignup={openSignup} />

      {/* Page content */}
      <div style={{ flex: 1, padding: '0 32px 80px', maxWidth: 1280, margin: '0 auto', width: '100%' }}>

        {/* ── Hero ── */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
          gap: 64, alignItems: 'center',
          padding: '48px 0 80px',
          position: 'relative', overflow: 'hidden',
        }}>
          <ParticleCanvas />
          {/* animated mesh gradient blobs */}
          <div style={{ position: 'absolute', inset: 0, zIndex: 0, pointerEvents: 'none' }}>
            <div style={{
              position: 'absolute', top: '-20%', left: '10%',
              width: 500, height: 500, borderRadius: '50%',
              background: 'radial-gradient(circle, var(--accent-soft) 0%, transparent 70%)',
              animation: 'floaty 9s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', bottom: '-10%', right: '5%',
              width: 400, height: 400, borderRadius: '50%',
              background: 'radial-gradient(circle, var(--peach-soft) 0%, transparent 70%)',
              animation: 'floaty 11s ease-in-out infinite reverse',
            }} />
            <div style={{
              position: 'absolute', top: '30%', right: '25%',
              width: 300, height: 300, borderRadius: '50%',
              background: 'radial-gradient(circle, var(--mint-soft) 0%, transparent 70%)',
              animation: 'floaty 7s ease-in-out infinite 2s',
            }} />
          </div>
          <div style={{ position: 'relative', zIndex: 1 }}>
            <Pill tone="accent" icon={<Icon.Sparkle />}>DSAI Projekt · LSTM-Ensemble</Pill>

            <h1 className="display" style={{
              fontSize: 'clamp(44px, 6vw, 84px)',
              fontWeight: 600, lineHeight: 1.02,
              letterSpacing: '-0.035em',
              marginTop: 24, textWrap: 'balance',
            }}>
              Aktienkurse verstehen —{' '}
              <span style={{
                background: 'linear-gradient(100deg, var(--accent), var(--peach) 55%, var(--mint))',
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: 'transparent',
                backgroundClip: 'text',
              }}>
                <Typewriter text="bevor sie passieren." delay={400} speed={48} />
              </span>
            </h1>

            <p style={{
              fontSize: 19, lineHeight: 1.55, color: 'var(--text-dim)',
              marginTop: 24, maxWidth: 560, textWrap: 'pretty',
            }}>
              Prognosix trainiert ein rekurrentes neuronales Netz auf 9 Marktindikatoren und liefert
              Kursprognosen für Tag, Monat und Jahr — mit transparenter Konfidenz-Bewertung.
            </p>

            {/* Search bar */}
            <div style={{
              marginTop: 40, display: 'flex', gap: 8,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              padding: 8, borderRadius: 999, maxWidth: 520,
              boxShadow: 'var(--shadow-md)',
            }}>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 12, padding: '0 16px' }}>
                <Icon.Search style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                <input
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && go()}
                  placeholder="Ticker eingeben — NVDA, SAP, TSLA, MSFT"
                  style={{
                    flex: 1, border: 0, background: 'transparent',
                    fontSize: 15, outline: 'none', textTransform: 'uppercase',
                  }}
                />
              </div>
              <Button variant="primary" onClick={go} iconRight={<Icon.Arrow />}>
                Analysieren
              </Button>
            </div>

            <div style={{
              marginTop: 16, display: 'flex', gap: 8, alignItems: 'center',
              fontSize: 13, color: 'var(--text-muted)',
            }}>
              <span>Beliebt:</span>
              {['NVDA', 'SAP', 'TSLA', 'MSFT', 'AAPL'].map(t => (
                <button
                  key={t}
                  onClick={() => navigate(`/stock/${t}`)}
                  style={{
                    padding: '5px 12px', borderRadius: 999,
                    background: 'var(--bg-soft)',
                    fontSize: 12, fontWeight: 600, color: 'var(--text-dim)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <HeroCard />
        </section>

        {/* ── Live ticker strip ── */}
        <section style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 16, margin: '24px 0 80px',
        }}>
          {DEMO_STOCKS.map(s => (
            <MiniStockCard
              key={s.ticker}
              stock={s}
              onClick={() => navigate(`/stock/${s.ticker}`)}
            />
          ))}
        </section>

        {/* ── How it works ── */}
        <section style={{ margin: '40px 0' }}>
          <div style={{ textAlign: 'center', maxWidth: 640, margin: '0 auto 56px' }}>
            <Pill tone="peach">Wie es funktioniert</Pill>
            <h2 className="display" style={{
              fontSize: 'clamp(32px, 4vw, 48px)',
              fontWeight: 600, letterSpacing: '-0.02em',
              marginTop: 20, lineHeight: 1.1,
            }}>
              Drei Schritte zur Prognose.
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 20,
          }}>
            {[
              { n: '01', tone: 'accent', title: 'Daten sammeln',        text: 'Kurse, Volumen, RSI, MACD, Bollinger-Bänder und weitere Indikatoren für den gewählten Ticker werden automatisch abgerufen.' },
              { n: '02', tone: 'peach',  title: 'LSTM trainieren',      text: 'Ein 4-schichtiges LSTM mit Attention-Mechanismus lernt Muster über 90-Tage-Sequenzen auf historischen Daten.' },
              { n: '03', tone: 'up',     title: 'Prognose + Konfidenz', text: 'Rekursiver Multi-Step-Forecast für Tag / Monat / Jahr mit Vertrauensintervall und Konfidenz-Score.' },
            ].map(step => (
              <div key={step.n} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)', padding: 28,
              }}>
                <Pill tone={step.tone} size="sm">{step.n}</Pill>
                <h3 className="display" style={{ fontSize: 22, fontWeight: 600, marginTop: 16, letterSpacing: '-0.01em' }}>
                  {step.title}
                </h3>
                <p style={{ color: 'var(--text-dim)', marginTop: 8, fontSize: 14, lineHeight: 1.55 }}>
                  {step.text}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── CTA ── */}
        <section style={{
          marginTop: 80, background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-xl)', padding: 48,
          textAlign: 'center', position: 'relative', overflow: 'hidden',
        }}>
          <div style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(ellipse 600px 400px at 20% 20%, var(--lavender-soft), transparent 60%), radial-gradient(ellipse 500px 400px at 80% 80%, var(--mint-soft), transparent 60%)',
          }} />
          <div style={{ position: 'relative' }}>
            <h2 className="display" style={{ fontSize: 40, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
              Dein erstes Modell in 30&nbsp;Sekunden.
            </h2>
            <p style={{ color: 'var(--text-dim)', marginTop: 12, maxWidth: 480, margin: '12px auto 0' }}>
              Watchlist anlegen, Prognosen vergleichen, Kursentwicklung analysieren.
            </p>
            <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center' }}>
              {user ? (
                <Button variant="primary" size="lg" onClick={() => navigate('/dashboard')} iconRight={<Icon.Arrow />}>
                  Zum Dashboard
                </Button>
              ) : (
                <>
                  <Button variant="primary" size="lg" onClick={openSignup} iconRight={<Icon.Arrow />}>
                    Kostenlos starten
                  </Button>
                  <Button variant="secondary" size="lg" onClick={() => navigate('/stock/NVDA')}>
                    Demo ansehen
                  </Button>
                </>
              )}
            </div>
          </div>
        </section>

        {/* ── Footer ── */}
        <footer style={{
          marginTop: 80, padding: '24px 0',
          borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          color: 'var(--text-muted)', fontSize: 13,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}>Prognosix</span>
            <span>· DSAI Studentenprojekt</span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Nicht als Anlageberatung zu verstehen.
          </div>
        </footer>
      </div>

      {showAuth && (
        <AuthModal initialMode={authMode} onClose={() => setShowAuth(false)} />
      )}
    </div>
  )
}
