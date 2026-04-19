import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode, LineStyle } from 'lightweight-charts'

const RANGES = ['1w', '1m', '3m', '1y', '5y']
const RANGE_LABELS = { '1w': '1W', '1m': '1M', '3m': '3M', '1y': '1Y', '5y': '5Y' }

function calcSMA(data, period) {
  const result = []
  for (let i = period - 1; i < data.length; i++) {
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b.close, 0)
    result.push({ time: data[i].time, value: parseFloat((sum / period).toFixed(4)) })
  }
  return result
}

function nextTradingDay(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const d = new Date(dateStr + 'T12:00:00Z')
  if (isNaN(d.getTime())) return null
  d.setDate(d.getDate() + 1)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

// Add calendar days to a YYYY-MM-DD string
function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setDate(d.getDate() + n)
  return d.toISOString().split('T')[0]
}

// Determine fan-chart color palette from prob_up
function fanColors(probUp) {
  if (probUp == null) return { outer: 'rgba(100,100,120,0.18)', inner: 'rgba(100,100,120,0.32)', median: 'rgba(160,160,180,0.9)' }
  if (probUp > 0.55)  return { outer: 'rgba(57,255,20,0.12)',   inner: 'rgba(57,255,20,0.25)',   median: 'rgba(57,255,20,0.85)' }
  if (probUp < 0.45)  return { outer: 'rgba(255,7,58,0.12)',    inner: 'rgba(255,7,58,0.25)',    median: 'rgba(255,7,58,0.85)' }
  return { outer: 'rgba(100,100,120,0.18)', inner: 'rgba(100,100,120,0.32)', median: 'rgba(160,160,180,0.9)' }
}

export default function CandlestickChart({
  ticker, range, onRangeChange, onHover,
  currentPrice, liveBar, predictedPrice, forecast,
}) {
  const containerRef  = useRef(null)
  const chartRef      = useRef(null)
  const seriesRef     = useRef(null)
  const volumeRef     = useRef(null)
  const sma20Ref      = useRef(null)
  const sma50Ref      = useRef(null)
  const predRef       = useRef(null)
  const priceLineRef  = useRef(null)
  const lastBarRef    = useRef(null)
  const liveBarRef    = useRef(liveBar)
  const predPriceRef  = useRef(predictedPrice)
  const dataLoadedRef = useRef(false)
  // Fan-chart series refs (created/destroyed per forecast)
  const fanOuterRef   = useRef(null)
  const fanInnerRef   = useRef(null)
  const fanMedianRef  = useRef(null)

  useEffect(() => { liveBarRef.current   = liveBar       }, [liveBar])
  useEffect(() => { predPriceRef.current = predictedPrice }, [predictedPrice])

  /* ── create chart once ── */
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      width:  containerRef.current.clientWidth,
      height: 400,
      layout: { background: { color: '#060606' }, textColor: '#444' },
      grid: {
        vertLines: { color: '#0f0f0f' },
        horzLines: { color: '#111' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#2a2a2a', labelBackgroundColor: '#111' },
        horzLine: { color: '#2a2a2a', labelBackgroundColor: '#111' },
      },
      rightPriceScale: {
        borderColor: '#1a1a1a',
        scaleMargins: { top: 0.06, bottom: 0.24 },
      },
      timeScale: {
        borderColor: '#1a1a1a',
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
    })

    /* candlestick */
    const series = chart.addCandlestickSeries({
      upColor:         '#39ff14',
      downColor:       '#ff073a',
      borderUpColor:   '#39ff14',
      borderDownColor: '#ff073a',
      wickUpColor:     '#1a7a00',
      wickDownColor:   '#7a0018',
    })

    /* volume histogram on separate scale */
    const volume = chart.addHistogramSeries({
      priceFormat:  { type: 'volume' },
      priceScaleId: 'vol',
    })
    volume.priceScale().applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 },
    })

    /* SMA-20 */
    const sma20 = chart.addLineSeries({
      color:                  'rgba(59,130,246,0.75)',
      lineWidth:              1,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    })

    /* SMA-50 */
    const sma50 = chart.addLineSeries({
      color:                  'rgba(245,158,11,0.75)',
      lineWidth:              1,
      priceLineVisible:       false,
      lastValueVisible:       false,
      crosshairMarkerVisible: false,
    })

    /* prediction line */
    const pred = chart.addLineSeries({
      color:                  '#ff9500',
      lineWidth:              2,
      lineStyle:              LineStyle.Dashed,
      priceLineVisible:       false,
      lastValueVisible:       true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  5,
    })

    chart.subscribeCrosshairMove(param => {
      if (!param.time || !param.seriesData.size) { onHover?.(null); return }
      const bar = param.seriesData.get(series)
      if (bar) onHover?.(bar)
    })

    const ro = new ResizeObserver(() => {
      if (containerRef.current)
        chart.applyOptions({ width: containerRef.current.clientWidth })
    })
    ro.observe(containerRef.current)

    chartRef.current  = chart
    seriesRef.current = series
    volumeRef.current = volume
    sma20Ref.current  = sma20
    sma50Ref.current  = sma50
    predRef.current   = pred

    return () => { ro.disconnect(); chart.remove() }
  }, [])

  /* ── helper: apply prediction line ── */
  function applyPredLine(pp) {
    if (!predRef.current || !lastBarRef.current || !pp) return
    const last     = lastBarRef.current
    if (!last.time || typeof last.time !== 'string') return
    const nextDate = nextTradingDay(last.time)
    if (!nextDate) return
    predRef.current.setData([
      { time: last.time, value: last.close },
      { time: nextDate,  value: pp },
    ])
  }

  /* ── load data on ticker/range change ── */
  useEffect(() => {
    if (!seriesRef.current || !ticker) return
    dataLoadedRef.current = false
    fetch(`/history/${ticker}?range=${range}`)
      .then(r => r.json())
      .then(({ data }) => {
        if (!data?.length) return

        seriesRef.current.setData(data)

        /* re-apply live candle */
        if (liveBarRef.current) seriesRef.current.update(liveBarRef.current)

        /* store last bar */
        const last = liveBarRef.current ?? data[data.length - 1]
        lastBarRef.current = last
        dataLoadedRef.current = true

        /* volume */
        volumeRef.current.setData(data.map(b => ({
          time:  b.time,
          value: b.volume,
          color: b.close >= b.open ? 'rgba(57,255,20,0.25)' : 'rgba(255,7,58,0.25)',
        })))

        /* SMAs */
        sma20Ref.current.setData(calcSMA(data, 20))
        sma50Ref.current.setData(calcSMA(data, 50))

        /* prediction line */
        applyPredLine(predPriceRef.current)

        chartRef.current.timeScale().fitContent()
      })
      .catch(() => {})
  }, [ticker, range])

  /* ── live candle ── */
  useEffect(() => {
    if (!seriesRef.current || !liveBar || !dataLoadedRef.current) return
    seriesRef.current.update(liveBar)
    lastBarRef.current = liveBar
    applyPredLine(predPriceRef.current)
  }, [liveBar])

  /* ── predicted price line ── */
  useEffect(() => {
    applyPredLine(predictedPrice)
  }, [predictedPrice])

  /* ── live price line (dashed green) ── */
  useEffect(() => {
    if (!seriesRef.current || !currentPrice) return
    if (priceLineRef.current) {
      try { seriesRef.current.removePriceLine(priceLineRef.current) } catch {}
    }
    priceLineRef.current = seriesRef.current.createPriceLine({
      price:            currentPrice,
      color:            '#39ff14',
      lineWidth:        1,
      lineStyle:        LineStyle.Dashed,
      axisLabelVisible: true,
      title:            'LIVE',
    })
  }, [currentPrice])

  /* ── fan chart overlay ── */
  useEffect(() => {
    const chart = chartRef.current
    if (!chart) return

    // Remove previous fan series
    if (fanOuterRef.current)  { try { chart.removeSeries(fanOuterRef.current)  } catch {} ; fanOuterRef.current  = null }
    if (fanInnerRef.current)  { try { chart.removeSeries(fanInnerRef.current)  } catch {} ; fanInnerRef.current  = null }
    if (fanMedianRef.current) { try { chart.removeSeries(fanMedianRef.current) } catch {} ; fanMedianRef.current = null }

    if (!forecast?.horizons?.length || !forecast.last_close || !lastBarRef.current?.time) return

    const lastClose = forecast.last_close
    const lastTime  = lastBarRef.current.time
    const probUp    = forecast.horizons[0]?.prob_up ?? null
    const colors    = fanColors(probUp)

    // Build data points: anchor at last close, then each horizon
    const anchorPoint = { time: lastTime, value: lastClose }

    const outerP10 = [anchorPoint, ...forecast.horizons.map(h => ({ time: addDays(lastTime, h.days), value: h.p10_price }))]
    const outerP90 = [anchorPoint, ...forecast.horizons.map(h => ({ time: addDays(lastTime, h.days), value: h.p90_price }))]

    // Inner band: midpoint between P10/P50 and P50/P90
    const innerLow  = [anchorPoint, ...forecast.horizons.map(h => ({ time: addDays(lastTime, h.days), value: (h.p10_price + h.p50_price) / 2 }))]
    const innerHigh = [anchorPoint, ...forecast.horizons.map(h => ({ time: addDays(lastTime, h.days), value: (h.p50_price + h.p90_price) / 2 }))]

    const medianData = [anchorPoint, ...forecast.horizons.map(h => ({ time: addDays(lastTime, h.days), value: h.p50_price }))]

    // Outer band: P10 as baseline area up to P90
    const fanOuter = chart.addAreaSeries({
      topColor:             colors.outer,
      bottomColor:          colors.outer,
      lineColor:            'transparent',
      lineWidth:            1,
      priceLineVisible:     false,
      lastValueVisible:     false,
      crosshairMarkerVisible: false,
    })
    fanOuter.setData(outerP90)

    // We use a second area for P10 to visually "subtract" — set its fill to bg color
    const fanBaseline = chart.addAreaSeries({
      topColor:             'rgba(6,6,6,0.92)',
      bottomColor:          'rgba(6,6,6,0.92)',
      lineColor:            'transparent',
      lineWidth:            1,
      priceLineVisible:     false,
      lastValueVisible:     false,
      crosshairMarkerVisible: false,
    })
    fanBaseline.setData(outerP10)

    // Inner band
    const fanInner = chart.addAreaSeries({
      topColor:             colors.inner,
      bottomColor:          colors.inner,
      lineColor:            'transparent',
      lineWidth:            1,
      priceLineVisible:     false,
      lastValueVisible:     false,
      crosshairMarkerVisible: false,
    })
    fanInner.setData(innerHigh)

    const fanInnerBase = chart.addAreaSeries({
      topColor:             'rgba(6,6,6,0.92)',
      bottomColor:          'rgba(6,6,6,0.92)',
      lineColor:            'transparent',
      lineWidth:            1,
      priceLineVisible:     false,
      lastValueVisible:     false,
      crosshairMarkerVisible: false,
    })
    fanInnerBase.setData(innerLow)

    // P50 median line
    const fanMedian = chart.addLineSeries({
      color:                  colors.median,
      lineWidth:              2,
      lineStyle:              LineStyle.Dashed,
      priceLineVisible:       false,
      lastValueVisible:       true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius:  4,
    })
    fanMedian.setData(medianData)

    // Store refs for cleanup (store all 5 series)
    fanOuterRef.current  = fanOuter
    fanInnerRef.current  = fanInner
    fanMedianRef.current = fanMedian

    // Also store the two "mask" series so we can clean them up
    // We reuse inner/outer refs to arrays
    fanOuterRef.current._mask  = fanBaseline
    fanInnerRef.current._mask  = fanInnerBase

    return () => {
      if (!chartRef.current) return
      try { chartRef.current.removeSeries(fanOuter) }     catch {}
      try { chartRef.current.removeSeries(fanBaseline) }  catch {}
      try { chartRef.current.removeSeries(fanInner) }     catch {}
      try { chartRef.current.removeSeries(fanInnerBase) } catch {}
      try { chartRef.current.removeSeries(fanMedian) }    catch {}
      fanOuterRef.current  = null
      fanInnerRef.current  = null
      fanMedianRef.current = null
    }
  }, [forecast])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      {/* legend + range selector */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
          <LegendDot color="rgba(59,130,246,0.75)" label="SMA 20" />
          <LegendDot color="rgba(245,158,11,0.75)"  label="SMA 50" />
          <LegendDot color="#ff9500" label="PROG" dashed />
          {forecast?.horizons?.length > 0 && (
            <LegendDot color={fanColors(forecast.horizons[0]?.prob_up ?? null).median} label="FAN P50" dashed />
          )}
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {RANGES.map(r => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              style={{
                padding: '5px 14px',
                borderRadius: '3px',
                border: `1px solid ${r === range ? '#39ff14' : '#1a1a1a'}`,
                background: r === range ? '#39ff14' : 'transparent',
                color: r === range ? '#000' : '#444',
                fontFamily: 'var(--font-mono)',
                fontSize: '0.75rem',
                letterSpacing: '0.08em',
                cursor: 'pointer',
                fontWeight: r === range ? '700' : '400',
                transition: 'all 0.15s',
              }}
            >
              {RANGE_LABELS[r]}
            </button>
          ))}
        </div>
      </div>
      <div ref={containerRef} />
    </div>
  )
}

function LegendDot({ color, label, dashed }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px' }}>
      <span style={{
        display: 'inline-block',
        width: '18px', height: '2px',
        background: dashed ? 'transparent' : color,
        borderTop: dashed ? `2px dashed ${color}` : 'none',
      }} />
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.6rem', color: '#333', letterSpacing: '0.1em' }}>
        {label}
      </span>
    </span>
  )
}
