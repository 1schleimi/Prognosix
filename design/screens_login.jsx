// ============================================================
//  Login / Signup screen
// ============================================================

function Login({ setPage, onLogin, initialMode }) {
  const [mode, setMode] = useState(initialMode || 'login');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = (e) => {
    e.preventDefault();
    setBusy(true);
    setTimeout(() => {
      onLogin({ email, name: name || email.split('@')[0] });
      setBusy(false);
      setPage({ name: 'dashboard' });
    }, 700);
  };

  return (
    <div className="fadeIn" style={{
      minHeight: 'calc(100vh - 80px)',
      display: 'grid', placeItems: 'center',
      padding: '40px 32px',
    }}>
      <div style={{
        width: '100%', maxWidth: 440,
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-xl)',
        padding: 40,
        boxShadow: 'var(--shadow-lg)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}>
          <Logo size={48} />
        </div>

        <h1 className="display" style={{ fontSize: 30, fontWeight: 600, textAlign: 'center', letterSpacing: '-0.02em' }}>
          {mode === 'login' ? 'Willkommen zurück' : 'Jetzt starten'}
        </h1>
        <p style={{ textAlign: 'center', color: 'var(--text-dim)', marginTop: 8, fontSize: 14 }}>
          {mode === 'login'
            ? 'Melde dich an, um deine Watchlist zu sehen.'
            : 'Erstelle ein kostenloses Konto — kein Kreditkarte nötig.'}
        </p>

        {/* Tab toggle */}
        <div style={{
          margin: '28px 0 24px',
          display: 'flex', gap: 4,
          padding: 4,
          background: 'var(--bg-sunken)',
          borderRadius: 999,
        }}>
          {['login', 'signup'].map(m => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: '10px 16px',
                borderRadius: 999,
                background: mode === m ? 'var(--bg-elev)' : 'transparent',
                color: mode === m ? 'var(--text)' : 'var(--text-muted)',
                fontSize: 13, fontWeight: 600,
                boxShadow: mode === m ? 'var(--shadow-sm)' : 'none',
                transition: 'all 180ms',
              }}
            >
              {m === 'login' ? 'Anmelden' : 'Registrieren'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mode === 'signup' && (
            <Field label="Name" value={name} onChange={setName} placeholder="Max Mustermann" />
          )}
          <Field label="E-Mail" type="email" value={email} onChange={setEmail} placeholder="max@example.com" required />
          <Field label="Passwort" type="password" value={pass} onChange={setPass} placeholder="Mindestens 8 Zeichen" required minLength={8} />

          <Button variant="primary" size="lg" type="submit" disabled={busy} fullWidth iconRight={busy ? null : <Icon.Arrow />}>
            {busy ? 'Einen Moment…' : mode === 'login' ? 'Anmelden' : 'Konto erstellen'}
          </Button>
        </form>

        <div style={{
          marginTop: 28, paddingTop: 20,
          borderTop: '1px solid var(--border)',
          textAlign: 'center', fontSize: 12, color: 'var(--text-muted)',
        }}>
          Demo-Konto ·{' '}
          <button
            type="button"
            onClick={() => { setEmail('demo@prognosix.ai'); setPass('demo1234'); }}
            style={{ color: 'var(--accent)', fontWeight: 600, textDecoration: 'underline', background: 'none' }}
          >
            auto-ausfüllen
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text', placeholder, required, minLength }) {
  const [focus, setFocus] = useState(false);
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
          fontSize: 15,
          outline: 'none',
          transition: 'border-color 180ms',
        }}
      />
    </label>
  );
}

window.Login = Login;
