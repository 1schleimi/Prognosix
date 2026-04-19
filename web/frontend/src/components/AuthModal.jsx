import { useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { Logo, Button, Icon } from './ui.jsx'

function Field({ label, type = 'text', value, onChange, placeholder, required, minLength }) {
  const [focus, setFocus] = useState(false)
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-dim)', letterSpacing: '0.02em' }}>
        {label}
      </span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
        style={{
          padding: '14px 16px',
          background: 'var(--bg-sunken)',
          border: '1.5px solid',
          borderColor: focus ? 'var(--accent)' : 'var(--border)',
          borderRadius: 'var(--radius-md)',
          fontSize: 15, outline: 'none',
          transition: 'border-color 180ms',
          color: 'var(--text)',
        }}
      />
    </label>
  )
}

export default function AuthModal({ onClose, initialMode = 'login' }) {
  const { signIn, signUp } = useAuth()
  const [mode, setMode]   = useState(initialMode)
  const [email, setEmail] = useState('')
  const [pass, setPass]   = useState('')
  const [name, setName]   = useState('')
  const [err, setErr]     = useState('')
  const [busy, setBusy]   = useState(false)
  const [done, setDone]   = useState(false)

  const switchMode = (m) => { setMode(m); setErr('') }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)

    if (mode === 'login') {
      const { error } = await signIn(email, pass)
      if (error) setErr(error.message)
      else onClose()
    } else {
      const { error } = await signUp(email, pass)
      if (error) setErr(error.message)
      else setDone(true)
    }
    setBusy(false)
  }

  return (
    <div
      onClick={e => e.target === e.currentTarget && onClose()}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'oklch(0.05 0 0 / 0.7)',
        backdropFilter: 'blur(8px)',
        display: 'grid', placeItems: 'center',
        padding: '24px',
        animation: 'fadeIn 200ms ease both',
      }}
    >
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 40,
        boxShadow: 'var(--shadow-lg)',
        animation: 'fadeInUp 250ms cubic-bezier(0.16, 1, 0.3, 1) both',
        position: 'relative',
      }}>
        {/* Close button */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: 16, right: 16,
            width: 32, height: 32, borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'var(--text-muted)',
            background: 'var(--bg-elev)',
            border: '1px solid var(--border)',
          }}
        >
          <Icon.X />
        </button>

        {done ? (
          /* ── Confirmation ── */
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, paddingTop: 8, textAlign: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 999,
              background: 'var(--up-soft)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--up)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <h2 className="display" style={{ fontSize: 22, fontWeight: 600 }}>Registrierung erfolgreich!</h2>
            <p style={{ fontSize: 14, color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Bestätige deine E-Mail-Adresse und melde dich dann an.
            </p>
            <Button variant="primary" size="lg" fullWidth onClick={() => { setDone(false); switchMode('login') }}>
              Zum Anmelden
            </Button>
          </div>
        ) : (
          <>
            {/* Logo */}
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
              <Logo size={48} />
            </div>

            <h1 className="display" style={{ fontSize: 28, fontWeight: 600, textAlign: 'center', letterSpacing: '-0.02em' }}>
              {mode === 'login' ? 'Willkommen zurück' : 'Jetzt starten'}
            </h1>
            <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: 8, fontSize: 14 }}>
              {mode === 'login'
                ? 'Melde dich an, um deine Watchlist zu sehen.'
                : 'Erstelle ein kostenloses Konto — keine Kreditkarte nötig.'}
            </p>

            {/* Tab toggle */}
            <div style={{
              margin: '28px 0 24px', display: 'flex', gap: 4,
              padding: 4, background: 'var(--bg-sunken)', borderRadius: 999,
            }}>
              {[
                { key: 'login',  label: 'Anmelden' },
                { key: 'signup', label: 'Registrieren' },
              ].map(m => (
                <button
                  key={m.key}
                  onClick={() => switchMode(m.key)}
                  style={{
                    flex: 1, padding: '10px 16px', borderRadius: 999,
                    background: mode === m.key ? 'var(--bg-elev)' : 'transparent',
                    color: mode === m.key ? 'var(--text)' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: 600,
                    boxShadow: mode === m.key ? 'var(--shadow-sm)' : 'none',
                    transition: 'all 180ms',
                  }}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {mode === 'signup' && (
                <Field label="Name" value={name} onChange={setName} placeholder="Max Mustermann" />
              )}
              <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="max@example.com" required />
              <Field
                label="Passwort" type="password" value={pass} onChange={setPass}
                placeholder={mode === 'signup' ? 'Mindestens 6 Zeichen' : '••••••••'}
                required minLength={6}
              />

              {err && (
                <p style={{ fontSize: 13, color: 'var(--coral)', marginTop: -4 }}>{err}</p>
              )}

              <Button variant="primary" size="lg" type="submit" disabled={busy} fullWidth iconRight={busy ? null : <Icon.Arrow />}>
                {busy ? 'Einen Moment…' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  )
}
