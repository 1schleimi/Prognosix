// ============================================================
//  Screens: Landing, Login, Dashboard, Detail
// ============================================================

// ---------- NAV ----------
function TopNav({ page, setPage, user, onLogin, onLogout, tweaks, setTweaks }) {
  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '20px 32px',
      maxWidth: 1280, margin: '0 auto', width: '100%',
    }}>
      <button onClick={() => setPage({ name: 'landing' })} style={{ background: 'none' }}>
        <WordMark size={20} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {user && (
          <button
            onClick={() => setPage({ name: 'dashboard' })}
            style={{
              padding: '8px 16px', borderRadius: 999,
              color: page.name === 'dashboard' ? 'var(--text)' : 'var(--text-dim)',
              background: page.name === 'dashboard' ? 'var(--bg-elev)' : 'transparent',
              fontSize: 14, fontWeight: 500,
            }}
          >
            Dashboard
          </button>
        )}
        <button
          onClick={() => setPage({ name: 'landing' })}
          style={{
            padding: '8px 16px', borderRadius: 999,
            color: 'var(--text-dim)', fontSize: 14, fontWeight: 500,
          }}
        >
          Über das Modell
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <button
          onClick={() => setTweaks({ ...tweaks, theme: tweaks.theme === 'dark' ? 'light' : 'dark' })}
          style={{
            width: 38, height: 38, borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elev)', color: 'var(--text-dim)',
            border: '1px solid var(--border)',
          }}
          title="Theme wechseln"
        >
          {tweaks.theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
        </button>
        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 999,
              background: 'var(--accent)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14,
              fontFamily: 'var(--font-display)',
            }}>
              {user.name[0].toUpperCase()}
            </div>
            <Button variant="ghost" size="sm" onClick={onLogout} icon={<Icon.Logout />}>
              Abmelden
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="md" onClick={() => setPage({ name: 'login', mode: 'login' })}>
              Anmelden
            </Button>
            <Button variant="primary" size="md" onClick={() => setPage({ name: 'login', mode: 'signup' })}>
              Konto erstellen
            </Button>
          </>
        )}
      </div>
    </nav>
  );
}

// ============================================================
//  LANDING
// ============================================================
function Landing({ setPage, user }) {
  const featured = [STOCKS.NVDA, STOCKS.MSFT, STOCKS.SAP];
  const [query, setQuery] = useState('');

  const search = () => {
    const t = query.trim().toUpperCase();
    if (STOCKS[t]) setPage({ name: 'detail', ticker: t });
    else setPage({ name: 'detail', ticker: 'NVDA' });
  };

  return (
    <div className="fadeIn" style={{ padding: '40px 32px 80px', maxWidth: 1280, margin: '0 auto' }}>
      {/* Hero */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.1fr) minmax(0, 0.9fr)',
        gap: 64,
        alignItems: 'center',
        padding: '48px 0 80px',
      }}>
        <div>
          <Pill tone="accent" icon={<Icon.Sparkle />}>
            DSAI Projekt · LSTM-Ensemble
          </Pill>
          <h1 className="display" style={{
            fontSize: 'clamp(44px, 6vw, 84px)',
            fontWeight: 600,
            lineHeight: 1.02,
            letterSpacing: '-0.035em',
            marginTop: 24,
            textWrap: 'balance',
          }}>
            Aktienkurse verstehen —{' '}
            <span style={{
              background: 'linear-gradient(100deg, var(--accent), var(--peach) 55%, var(--mint))',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>bevor sie passieren.</span>
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
            marginTop: 40,
            display: 'flex', gap: 8,
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            padding: 8,
            borderRadius: 999,
            maxWidth: 520,
            boxShadow: 'var(--shadow-md)',
          }}>
            <div style={{
              flex: 1, display: 'flex', alignItems: 'center', gap: 12,
              padding: '0 16px',
            }}>
              <Icon.Search style={{ color: 'var(--text-muted)' }} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()}
                placeholder="Ticker eingeben — NVDA, SAP, TSLA, MSFT"
                style={{
                  flex: 1, border: 0, background: 'transparent',
                  fontSize: 15, outline: 'none',
                  textTransform: 'uppercase',
                }}
              />
            </div>
            <Button variant="primary" onClick={search} iconRight={<Icon.Arrow />}>
              Analysieren
            </Button>
          </div>

          <div style={{
            marginTop: 16, display: 'flex', gap: 8, alignItems: 'center',
            fontSize: 13, color: 'var(--text-muted)',
          }}>
            <span>Beliebt:</span>
            {['NVDA', 'SAP', 'TSLA', 'MSFT'].map(t => (
              <button
                key={t}
                onClick={() => setPage({ name: 'detail', ticker: t })}
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

        {/* Hero visual: floating prediction card */}
        <HeroCard />
      </section>

      {/* Live ticker strip */}
      <section style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 16,
        margin: '24px 0 80px',
      }}>
        {featured.map(s => <MiniStockCard key={s.ticker} stock={s} onClick={() => setPage({ name: 'detail', ticker: s.ticker })} />)}
      </section>

      {/* How it works */}
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
            { n: '01', tone: 'accent', title: 'Daten sammeln', text: 'Kurse, Volumen, RSI, MACD, Bollinger-Bänder und 5 weitere Indikatoren für den gewählten Ticker.' },
            { n: '02', tone: 'peach',  title: 'LSTM trainieren', text: 'Ein 4-schichtiges LSTM mit Attention-Mechanismus lernt Muster über 90-Tage-Sequenzen.' },
            { n: '03', tone: 'up',     title: 'Prognose + Konfidenz', text: 'Rekursiver Multi-Step-Forecast für Tag / Monat / Jahr mit Vertrauensintervall.' },
          ].map(step => (
            <div key={step.n} style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-lg)',
              padding: 28,
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

      {/* CTA */}
      <section style={{
        marginTop: 80,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 48,
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
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
            Watchlist anlegen, Prognosen vergleichen, Feature-Wichtigkeit einsehen.
          </p>
          <div style={{ marginTop: 32, display: 'flex', gap: 12, justifyContent: 'center' }}>
            {user ? (
              <Button variant="primary" size="lg" onClick={() => setPage({ name: 'dashboard' })} iconRight={<Icon.Arrow />}>
                Zum Dashboard
              </Button>
            ) : (
              <>
                <Button variant="primary" size="lg" onClick={() => setPage({ name: 'login', mode: 'signup' })} iconRight={<Icon.Arrow />}>
                  Kostenlos starten
                </Button>
                <Button variant="secondary" size="lg" onClick={() => setPage({ name: 'detail', ticker: 'NVDA' })}>
                  Demo ansehen
                </Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer style={{
        marginTop: 80, padding: '24px 0', borderTop: '1px solid var(--border)',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        color: 'var(--text-muted)', fontSize: 13,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Logo size={20} /> <span>Prognosix · DSAI Studentenprojekt</span>
        </div>
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Nicht als Anlageberatung zu verstehen.
        </div>
      </footer>
    </div>
  );
}

function HeroCard() {
  const stock = STOCKS.NVDA;
  return (
    <div style={{
      position: 'relative',
      animation: 'fadeInUp 700ms cubic-bezier(0.16, 1, 0.3, 1) both',
    }}>
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
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 28,
        boxShadow: 'var(--shadow-lg)',
        animation: 'floaty 6s ease-in-out infinite',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <StockLogo ticker="NVDA" size={44} />
            <div>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>{stock.name}</div>
              <div className="mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '0.02em' }}>NVDA</div>
            </div>
          </div>
          <Pill tone="up" size="sm" icon={<Icon.TrendUp />}>
            Prognose
          </Pill>
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <span className="mono" style={{ fontSize: 44, fontWeight: 700, letterSpacing: '-0.02em' }}>
            $142.87
          </span>
          <Pill tone="up" size="sm">+1.67%</Pill>
        </div>

        <div style={{ margin: '20px -8px -8px' }}>
          <Sparkline data={stock.spark} width={360} height={70} color="var(--accent)" />
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
              <span className="mono" style={{ fontSize: 24, fontWeight: 700, color: 'var(--mint)' }}>
                +4.8%
              </span>
              <span style={{ fontSize: 13, color: 'var(--text-dim)' }}>$149.72</span>
            </div>
          </div>
          <ConfidenceRing value={71} size={72} />
        </div>
      </div>

      {/* Floating badge */}
      <div style={{
        position: 'absolute', top: -16, right: 20,
        background: 'var(--bg-elev)',
        border: '1px solid var(--border-strong)',
        borderRadius: 999,
        padding: '8px 14px',
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
  );
}

function MiniStockCard({ stock, onClick }) {
  const [hover, setHover] = useState(false);
  const up = stock.changePct >= 0;
  return (
    <button
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onClick}
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: 20, textAlign: 'left',
        transition: 'transform 220ms, border-color 220ms',
        transform: hover ? 'translateY(-3px)' : 'none',
        borderColor: hover ? 'var(--border-strong)' : 'var(--border)',
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
        <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
          ${stock.price.toFixed(2)}
        </span>
        <Pill tone={up ? 'up' : 'down'} size="sm" icon={up ? <Icon.TrendUp /> : <Icon.TrendDown />}>
          {formatPct(stock.changePct)}
        </Pill>
      </div>
    </button>
  );
}

window.Landing = Landing;
window.TopNav = TopNav;
