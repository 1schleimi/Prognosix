import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { WordMark, Button, Icon } from './ui.jsx'

function NotificationToggle() {
  const perm = typeof Notification !== 'undefined' ? Notification.permission : 'denied'

  if (perm === 'granted') return null

  if (perm === 'denied') {
    return (
      <span
        title="Desktop-Benachrichtigungen blockiert. In den Browser-Einstellungen freigeben."
        style={{ color: 'var(--coral)', display: 'flex', alignItems: 'center', cursor: 'help' }}
      >
        <Icon.BellOff />
      </span>
    )
  }

  return (
    <button
      onClick={() => Notification.requestPermission()}
      title="Benachrichtigungen aktivieren"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '6px 12px', borderRadius: 999,
        background: 'var(--accent-soft)', color: 'var(--accent)',
        fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
      }}
    >
      <Icon.Bell />
      Benachrichtigungen aktivieren
    </button>
  )
}

export default function TopNav({ theme, toggleTheme, onLogin, onSignup }) {
  const navigate  = useNavigate()
  const location  = useLocation()
  const { user, signOut } = useAuth()

  const isActive = (path) => location.pathname === path

  return (
    <nav style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '20px 32px',
      maxWidth: 1280, margin: '0 auto', width: '100%',
    }}>
      <button onClick={() => navigate('/')} style={{ background: 'none' }}>
        <WordMark size={20} />
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {user && (
          <button
            onClick={() => navigate('/dashboard')}
            style={{
              padding: '8px 16px', borderRadius: 999,
              color: isActive('/dashboard') ? 'var(--text)' : 'var(--text-dim)',
              background: isActive('/dashboard') ? 'var(--bg-elev)' : 'transparent',
              fontSize: 14, fontWeight: 500,
            }}
          >
            Dashboard
          </button>
        )}
        {user && (
          <button
            onClick={() => navigate('/portfolio')}
            style={{
              padding: '8px 16px', borderRadius: 999,
              display: 'flex', alignItems: 'center', gap: 6,
              color: isActive('/portfolio') ? 'var(--text)' : 'var(--text-dim)',
              background: isActive('/portfolio') ? 'var(--bg-elev)' : 'transparent',
              fontSize: 14, fontWeight: 500,
            }}
          >
            <Icon.BarChart />
            Portfolio
          </button>
        )}
        <button
          onClick={() => navigate('/')}
          style={{
            padding: '8px 16px', borderRadius: 999,
            color: isActive('/') ? 'var(--text)' : 'var(--text-dim)',
            background: isActive('/') ? 'var(--bg-elev)' : 'transparent',
            fontSize: 14, fontWeight: 500,
          }}
        >
          Über das Modell
        </button>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {user && <NotificationToggle />}

        <button
          onClick={toggleTheme}
          style={{
            width: 38, height: 38, borderRadius: 999,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--bg-elev)', color: 'var(--text-dim)',
            border: '1px solid var(--border)',
          }}
          title="Theme wechseln"
        >
          {theme === 'dark' ? <Icon.Sun /> : <Icon.Moon />}
        </button>

        {user ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 999,
              background: 'var(--accent)', color: 'var(--bg)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontWeight: 700, fontSize: 14, fontFamily: 'var(--font-display)',
            }}>
              {(user.email?.[0] ?? '?').toUpperCase()}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} icon={<Icon.Logout />}>
              Abmelden
            </Button>
          </div>
        ) : (
          <>
            <Button variant="ghost" size="md" onClick={onLogin}>Anmelden</Button>
            <Button variant="primary" size="md" onClick={onSignup}>Konto erstellen</Button>
          </>
        )}
      </div>
    </nav>
  )
}
