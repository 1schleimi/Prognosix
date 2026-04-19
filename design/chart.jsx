// ============================================================
//  ForecastChart — main chart with historical + forecast + band
// ============================================================

function ForecastChart({ stock, horizon, height = 320 }) {
  const [hover, setHover] = useState(null);
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(800);

  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const { histLen, forecastDays, forecast } = useMemo(() => {
    const histLen = horizon === 'day' ? 30 : horizon === 'month' ? 90 : 90;
    const forecastDays = horizon === 'day' ? 1 : horizon === 'month' ? 21 : 252;
    const f = stock.forecasts[horizon];
    const fc = genForecast(stock.price, forecastDays, f.pct, f.confidence, stock.seed * 10 + forecastDays);
    return { histLen, forecastDays, forecast: fc };
  }, [stock, horizon]);

  const history = stock.history90.slice(-histLen);
  const allPoints = [
    ...history.map(x => ({ t: x.t, c: x.c, type: 'hist' })),
    ...forecast.map(x => ({ t: x.t, c: x.c, upper: x.upper, lower: x.lower, type: 'forecast' })),
  ];

  const padL = 16, padR = 60, padT = 20, padB = 28;
  const chartW = Math.max(100, width - padL - padR);
  const chartH = height - padT - padB;

  const allY = [
    ...history.map(x => x.c),
    ...forecast.map(x => x.upper),
    ...forecast.map(x => x.lower),
  ];
  const yMin = Math.min(...allY) * 0.995;
  const yMax = Math.max(...allY) * 1.005;
  const yRange = yMax - yMin || 1;

  const xOf = (i) => padL + (i / (allPoints.length - 1)) * chartW;
  const yOf = (v) => padT + chartH - ((v - yMin) / yRange) * chartH;

  const histPath = history.map((p, i) => {
    const x = xOf(i);
    const y = yOf(p.c);
    return (i === 0 ? 'M' : 'L') + ` ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  const forecastStart = history.length - 1;
  const forecastPath = forecast.map((p, i) => {
    const x = xOf(forecastStart + i + 1);
    const y = yOf(p.c);
    return (i === 0 ? `M ${xOf(forecastStart).toFixed(2)} ${yOf(history[history.length-1].c).toFixed(2)} L` : 'L') + ` ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');

  const bandUpper = forecast.map((p, i) => `L ${xOf(forecastStart + i + 1).toFixed(2)} ${yOf(p.upper).toFixed(2)}`).join(' ');
  const bandLower = forecast.slice().reverse().map((p, i) => {
    const idx = forecast.length - 1 - i;
    return `L ${xOf(forecastStart + idx + 1).toFixed(2)} ${yOf(p.lower).toFixed(2)}`;
  }).join(' ');
  const bandPath = `M ${xOf(forecastStart).toFixed(2)} ${yOf(history[history.length-1].c).toFixed(2)} ${bandUpper} ${bandLower} Z`;

  const up = stock.forecasts[horizon].pct >= 0;
  const forecastColor = up ? 'var(--mint)' : 'var(--coral)';

  // gridlines
  const yTicks = 4;
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => yMin + (yRange * i) / yTicks);

  const hoveredPoint = hover != null ? allPoints[hover] : null;

  const onMove = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const idx = Math.round(((x - padL) / chartW) * (allPoints.length - 1));
    if (idx >= 0 && idx < allPoints.length) setHover(idx);
  };

  return (
    <div ref={wrapRef} style={{ width: '100%', position: 'relative' }}>
      <svg width={width} height={height} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {/* gridlines */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line
              x1={padL} x2={padL + chartW}
              y1={yOf(v)} y2={yOf(v)}
              stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4"
            />
            <text
              x={padL + chartW + 8} y={yOf(v) + 4}
              fill="var(--text-muted)" fontSize="11"
              fontFamily="var(--font-mono)"
            >
              ${v.toFixed(v > 100 ? 0 : 1)}
            </text>
          </g>
        ))}

        {/* vertical divider between history and forecast */}
        <line
          x1={xOf(forecastStart)} x2={xOf(forecastStart)}
          y1={padT} y2={padT + chartH}
          stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" opacity="0.45"
        />
        <text
          x={xOf(forecastStart) + 6} y={padT + 14}
          fill="var(--accent)" fontSize="10" fontWeight="600" letterSpacing="0.05em"
        >
          JETZT
        </text>

        {/* confidence band */}
        <path d={bandPath} fill={forecastColor} fillOpacity="0.12" />

        {/* history line (smooth area) */}
        <defs>
          <linearGradient id="histGrad" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          d={`${histPath} L ${xOf(history.length - 1).toFixed(2)} ${padT + chartH} L ${padL} ${padT + chartH} Z`}
          fill="url(#histGrad)"
        />
        <path d={histPath} fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

        {/* forecast line (dashed) */}
        <path
          d={forecastPath}
          fill="none"
          stroke={forecastColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="5 4"
        />

        {/* forecast end marker */}
        {forecast.length > 0 && (
          <>
            <circle
              cx={xOf(allPoints.length - 1)}
              cy={yOf(forecast[forecast.length - 1].c)}
              r="6" fill={forecastColor}
            />
            <circle
              cx={xOf(allPoints.length - 1)}
              cy={yOf(forecast[forecast.length - 1].c)}
              r="10" fill={forecastColor} opacity="0.3"
            />
          </>
        )}

        {/* hover marker */}
        {hoveredPoint && (
          <>
            <line
              x1={xOf(hover)} x2={xOf(hover)}
              y1={padT} y2={padT + chartH}
              stroke="var(--text-dim)" strokeWidth="1" strokeDasharray="2 3"
            />
            <circle
              cx={xOf(hover)} cy={yOf(hoveredPoint.c)}
              r="5" fill={hoveredPoint.type === 'forecast' ? forecastColor : 'var(--accent)'}
              stroke="var(--bg)" strokeWidth="2"
            />
          </>
        )}
      </svg>

      {/* hover tooltip */}
      {hoveredPoint && (
        <div style={{
          position: 'absolute',
          top: 4,
          left: Math.min(width - 180, Math.max(4, xOf(hover) - 80)),
          background: 'var(--bg-elev)',
          border: '1px solid var(--border-strong)',
          borderRadius: 10,
          padding: '8px 12px',
          fontSize: 12,
          pointerEvents: 'none',
          boxShadow: 'var(--shadow-md)',
          minWidth: 160,
        }}>
          <div style={{ color: 'var(--text-muted)', fontSize: 10, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
            {new Date(hoveredPoint.t).toLocaleDateString('de-DE', { day: '2-digit', month: 'short', year: 'numeric' })}
            {hoveredPoint.type === 'forecast' && ' · Prognose'}
          </div>
          <div className="mono" style={{ fontSize: 16, fontWeight: 600, marginTop: 2 }}>
            {formatCurrency(hoveredPoint.c)}
          </div>
          {hoveredPoint.type === 'forecast' && hoveredPoint.upper && (
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
              Band: {formatCurrency(hoveredPoint.lower)} – {formatCurrency(hoveredPoint.upper)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.ForecastChart = ForecastChart;
