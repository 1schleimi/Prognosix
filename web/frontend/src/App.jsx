import { Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import Landing from './pages/Landing.jsx'
import StockDetail from './pages/StockDetail.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Portfolio from './pages/Portfolio.jsx'
import TickerTape from './components/TickerTape.jsx'


export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('pgx-theme') || 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('pgx-theme', theme)
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  return (
    <>
      <TickerTape />
      <Routes>
        <Route path="/"              element={<Landing      theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/dashboard"     element={<Dashboard    theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/stock/:ticker" element={<StockDetail  theme={theme} toggleTheme={toggleTheme} />} />
        <Route path="/portfolio"     element={<Portfolio    theme={theme} toggleTheme={toggleTheme} />} />
      </Routes>
    </>
  )
}
