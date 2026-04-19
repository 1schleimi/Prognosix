import { useState, useEffect } from 'react'
import { LiveDot } from './ui.jsx'

const TICKERS = [
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','AMD','NFLX','JPM',
  'V','BRKB','WMT','LLY','UNH','XOM','AVGO','ORCL','MA','JNJ',
  'PG','HD','COST','BAC','MRK','ABBV','CVX','KO','PEP','ADBE',
  'CRM','INTC','CSCO','DIS','QCOM','TXN','IBM','GE','BA','CAT',
]

export default function TickerTape() {
  const [quotes, setQuotes] = useState({})

  useEffect(() => {
    TICKERS.forEach(ticker => {
      fetch(`/quote/${ticker}`)
        .then(r => r.ok ? r.json() : null)
        .catch(() => null)
        .then(data => {
          if (data) setQuotes(prev => ({ ...prev, [ticker]: data }))
        })
    })
  }, [])

  const items = TICKERS.map(ticker => {
    const q = quotes[ticker]
    const up = q?.change_pct != null && q.change_pct >= 0
    return { ticker, price: q?.price, change: q?.change_pct, up }
  })

  const doubled = [...items, ...items]

  return (
    <div style={{
      width: '100%',
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-sunken)',
      overflow: 'hidden',
      height: 36,
      display: 'flex',
      alignItems: 'center',
    }}>
      {/* Live badge — fixed left, doesn't scroll */}
      <div style={{
        flexShrink: 0, padding: '0 16px',
        borderRight: '1px solid var(--border)',
        height: 36, display: 'flex', alignItems: 'center',
        background: 'var(--bg-sunken)', zIndex: 1,
      }}>
        <LiveDot label="LIVE" />
      </div>
      <div style={{ overflow: 'hidden', flex: 1, display: 'flex', alignItems: 'center' }}>
      <div style={{
        display: 'flex',
        gap: 0,
        animation: `ticker-scroll ${TICKERS.length * 3}s linear infinite`,
        whiteSpace: 'nowrap',
        willChange: 'transform',
      }}>
        {doubled.map((item, i) => (
          <span
            key={i}
            className="mono"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 24px',
              fontSize: 12,
              borderRight: '1px solid var(--border)',
              height: 36,
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--text)' }}>{item.ticker}</span>
            {item.price != null ? (
              <>
                <span key={item.price} style={{ color: 'var(--text-dim)', animation: 'flip-in 300ms ease', display: 'inline-block' }}>
                  ${item.price.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
                <span key={item.change} style={{ color: item.up ? 'var(--up)' : 'var(--down)', fontWeight: 600, animation: 'flip-in 300ms ease', display: 'inline-block' }}>
                  {item.up ? '▲' : '▼'} {Math.abs(item.change).toFixed(2)}%
                </span>
              </>
            ) : (
              <span style={{ color: 'var(--text-muted)' }}>···</span>
            )}
          </span>
        ))}
      </div>
      </div>
    </div>
  )
}
