import { useEffect, useState } from 'react'
import { api, type Accuracy, type DayView, type Insights, type Meta } from './api'
import {
  CutoffChart, DailyErrorChart, DayChart, ErrorHistogram, HorizonChart, HourChart, MonthChart,
} from './components/charts'
import { Card, Kpi, Legend } from './components/ui'
import { fmtDate, fmtDayTime, fmtEnergy, fmtGW, fmtPct, fmtPower, fmtTime } from './format'
import { useApi } from './useApi'

type Tab = 'decision' | 'accuracy' | 'insights'

const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  adjusted: 'var(--series-adjusted)',
  band: 'var(--band)',
}

const CUTOFF_PRESETS = ['08:00', '10:00', '12:00', '16:00']

// Sequential blue ramp (light → dark) for the calendar heatmap.
const RAMP = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95']

function rampFor(value: number, min: number, max: number) {
  const i = Math.min(RAMP.length - 1, Math.floor(((value - min) / (max - min || 1)) * RAMP.length))
  return { bg: RAMP[i], fg: i >= 3 ? '#ffffff' : '#0b0b0b' }
}

// ------------------------------------------------------------------ calendar

function DayCalendar({ acc, days, selected, onSelect }: {
  acc: Accuracy | null
  days: string[]
  selected: string
  onSelect: (d: string) => void
}) {
  const mae = new Map(acc?.byDay.map((d) => [d.deliveryDay, d.mae ?? 0]))
  const values = [...mae.values()]
  const [min, max] = [Math.min(...values), Math.max(...values)]
  // Monday-first grid: pad before the first delivery day.
  const lead = (new Date(`${days[0]}T12:00:00Z`).getUTCDay() + 6) % 7
  const cells: (string | null)[] = [...Array(lead).fill(null), ...days]

  return (
    <div>
      <div className="cal">
        {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((w, i) => <div key={i} className="cal-head">{w}</div>)}
        {cells.map((d, i) => {
          if (!d) return <div key={`pad-${i}`} />
          const m = mae.get(d)
          const color = m != null && acc ? rampFor(m, min, max) : { bg: 'var(--grid)', fg: 'var(--ink)' }
          return (
            <button
              key={d}
              className={`cal-day ${d === selected ? 'selected' : ''}`}
              style={{ background: color.bg, color: color.fg }}
              onClick={() => onSelect(d)}
              title={`${fmtDate(d)} · daily MAE ${fmtPower(m)}`}
              aria-pressed={d === selected}
            >
              {Number(d.slice(8))}
              {d.slice(5, 7) === '02' && <small>Feb</small>}
            </button>
          )
        })}
      </div>
      <div className="cal-legend">
        <span>Daily error</span>
        <span>low</span>
        {RAMP.map((c) => <i key={c} style={{ background: c }} />)}
        <span>high</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ app

export default function App() {
  const meta = useApi<Meta>('meta', api.meta)
  const [tab, setTab] = useState<Tab>('decision')
  const [cutoff, setCutoff] = useState('10:00')
  const [day, setDay] = useState('2026-01-15')
  const [showAdjusted, setShowAdjusted] = useState(true)
  const [showTable, setShowTable] = useState(false)
  const [theme, setTheme] = useState<'light' | 'dark' | null>(null)

  useEffect(() => {
    if (theme) document.documentElement.dataset.theme = theme
  }, [theme])

  const validCutoff = /^\d{2}:\d{2}$/.test(cutoff) ? cutoff : null
  const dayView = useApi<DayView>(validCutoff && `${day}|${validCutoff}`, () => api.day(day, validCutoff!))
  const acc = useApi<Accuracy>(validCutoff, () => api.accuracy(validCutoff!))
  const insights = useApi<Insights>('insights', api.insights)

  if (meta.error) return <div className="state error">Could not reach the API: {meta.error}</div>
  if (!meta.data) return <div className="state">Loading January 2026 wind data…</div>

  const days = meta.data.deliveryDays
  const dayIdx = days.indexOf(day)
  const a = acc.data
  const d = dayView.data
  const improvement = a ? 1 - a.biasAdjustedSummary.mae / a.summary.mae : 0

  const openDay = (x: string) => { setDay(x); setTab('decision') }
  const toggleTheme = () => setTheme(
    (theme ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark' ? 'light' : 'dark')

  // Day energy figures (hours with a forecast only).
  const energy = d && {
    forecast: d.totals.forecastMWh,
    adjusted: d.forecast.reduce((s, f) => s + f.adjusted, 0),
    firm: d.forecast.reduce((s, f) => s + Math.max(f.low, 0), 0),
    actual: d.totals.actualMWh,
  }

  return (
    <div className="shell">
      {/* -------------------------------------------------------------- top bar */}
      <header className="topbar">
        <div className="topbar-inner">
          <div className="brand">
            <img src="/favicon.svg" alt="" />
            <div>
              <h1>WindSight</h1>
              <p>GB day-ahead wind · January 2026 pilot</p>
            </div>
          </div>
          <nav className="tabs" role="tablist">
            {([['decision', 'Day-ahead decision'], ['accuracy', 'Forecast accuracy'], ['insights', 'Insights']] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>
                {label}
              </button>
            ))}
          </nav>
          <div className="topbar-right">
            <div className="cutoff">
              <span>Decide at (D-1)</span>
              <div className="chips">
                {CUTOFF_PRESETS.map((c) => (
                  <button key={c} className={cutoff === c ? 'on' : ''} onClick={() => setCutoff(c)}>{c}</button>
                ))}
                <input type="time" value={cutoff} onChange={(e) => setCutoff(e.target.value)} aria-label="Custom cutoff" />
              </div>
            </div>
            <button className="icon-btn" onClick={toggleTheme} aria-label="Toggle theme" title="Toggle theme">◐</button>
          </div>
        </div>
      </header>

      <main className="main">
        {/* ============================================================ DECISION */}
        {tab === 'decision' && (
          <div className="decision">
            <aside className="side">
              <Card title="Delivery day" sub="Colour = how wrong the decision-time forecast was that day.">
                <DayCalendar acc={a} days={days} selected={day} onSelect={setDay} />
                <div className="side-nav">
                  <button className="btn" disabled={dayIdx <= 0} onClick={() => setDay(days[dayIdx - 1])}>‹ Prev</button>
                  <button className="btn" disabled={dayIdx >= days.length - 1} onClick={() => setDay(days[dayIdx + 1])}>Next ›</button>
                </div>
              </Card>
              <Card title="Display">
                <label className="toggle">
                  <input type="checkbox" checked={showAdjusted} onChange={(e) => setShowAdjusted(e.target.checked)} />
                  Bias-adjusted forecast
                </label>
                <p className="side-note">
                  Shows the forecast minus its average error over the previous 14 days, using only data known at the decision time.
                </p>
              </Card>
            </aside>

            <section className={`content ${dayView.loading ? 'loading' : ''}`}>
              {dayView.error && <div className="state error">{dayView.error}</div>}
              {d && energy && (
                <>
                  <div className="brief">
                    <div className="brief-head">
                      <div>
                        <div className="eyebrow">Procurement brief</div>
                        <h2>Delivery {fmtDate(d.deliveryDay)}</h2>
                        <p>
                          Decided {fmtDate(d.decisionDay)} at {d.cutoff} using the{' '}
                          <b>{d.forecastRuns.length ? fmtTime(d.forecastRuns[d.forecastRuns.length - 1]) : '–'} forecast run</b>
                          {d.forecast.length > 0 && <> · {Math.min(...d.forecast.map((f) => f.horizonH)).toFixed(1)}–{Math.max(...d.forecast.map((f) => f.horizonH)).toFixed(1)} h ahead</>}
                        </p>
                      </div>
                      {d.coverage.hours < d.coverage.expected && (
                        <span className="pill warn">Only {d.coverage.hours}/{d.coverage.expected} hours forecast</span>
                      )}
                    </div>
                    <div className="brief-figures">
                      <div>
                        <span className="dot" style={{ background: C.forecast }} />
                        <label>Forecast wind</label>
                        <strong>{fmtEnergy(energy.forecast)}</strong>
                        <small>As published</small>
                      </div>
                      <div>
                        <span className="dot" style={{ background: C.adjusted }} />
                        <label>Bias-adjusted</label>
                        <strong>{fmtEnergy(energy.adjusted)}</strong>
                        <small>Lowered by {fmtPower(d.trailingBias)} per hour</small>
                      </div>
                      <div className="firm">
                        <span className="dot" style={{ background: 'var(--ink-2)' }} />
                        <label>Firm wind (P90)</label>
                        <strong>{fmtEnergy(energy.firm)}</strong>
                        <small>Met or beaten in 9 of 10 hours historically</small>
                      </div>
                      <div className="after">
                        <span className="dot" style={{ background: C.actual }} />
                        <label>Actual outturn</label>
                        <strong>{fmtEnergy(energy.actual)}</strong>
                        <small>Known after delivery · forecast {energy.forecast >= energy.actual ? '+' : ''}{fmtPct(energy.forecast / energy.actual - 1)}</small>
                      </div>
                    </div>
                  </div>

                  <Card
                    title="Hourly wind: forecast at decision time vs actual"
                    sub="Shaded: likely range of actual output (P10–P90 of errors on other January days). Hover for detail."
                    actions={<button className="btn" onClick={() => setShowTable(!showTable)}>{showTable ? 'Chart' : 'Table'}</button>}
                  >
                    <Legend items={[
                      { label: 'Actual', color: C.actual },
                      { label: `Forecast (${d.cutoff} D-1)`, color: C.forecast },
                      ...(showAdjusted ? [{ label: 'Bias-adjusted', color: C.adjusted, kind: 'dashed' as const }] : []),
                      { label: 'Likely range', color: C.band, kind: 'area' as const },
                    ]} />
                    {showTable ? (
                      <div className="table-wrap" style={{ marginTop: 12 }}>
                        <table>
                          <thead>
                            <tr><th>Hour</th><th>Forecast</th><th>Bias-adj.</th><th>Firm (P90)</th><th>Actual</th><th>Error</th></tr>
                          </thead>
                          <tbody>
                            {d.forecast.map((f) => (
                              <tr key={f.t}>
                                <td>{fmtTime(f.t)}</td>
                                <td>{fmtPower(f.mw)}</td>
                                <td>{fmtPower(f.adjusted)}</td>
                                <td>{fmtPower(Math.max(f.low, 0))}</td>
                                <td>{fmtPower(f.actual)}</td>
                                <td>{f.actual == null ? '–' : fmtPower(f.mw - f.actual, true)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <DayChart day={d} showAdjusted={showAdjusted} />
                    )}
                  </Card>

                  <div className="grid grid-kpi" style={{ marginTop: 16 }}>
                    <Kpi label="Day MAE" value={fmtPower(d.metrics?.mae)} note={`${fmtPct(d.metrics?.nmae)} of mean output`} />
                    <Kpi label="Day bias" value={fmtPower(d.metrics?.bias, true)} note={(d.metrics?.bias ?? 0) > 0 ? 'Over-forecast: desk would be short' : 'Under-forecast: desk would be long'} />
                    <Kpi label="Bias-adjusted MAE" value={fmtPower(d.biasAdjustedMetrics?.mae)}
                      tone={d.biasAdjustedMetrics && d.metrics && d.biasAdjustedMetrics.mae < d.metrics.mae ? 'good' : undefined}
                      note={d.biasAdjustedMetrics && d.metrics ? `${fmtPct(1 - d.biasAdjustedMetrics.mae / d.metrics.mae)} lower than raw` : undefined} />
                  </div>
                </>
              )}
            </section>
          </div>
        )}

        {/* ============================================================ ACCURACY */}
        {tab === 'accuracy' && a && (
          <div className={acc.loading ? 'loading' : ''}>
            <div className="page-head">
              <h2>How accurate were the forecasts you decided on?</h2>
              <p>
                All {a.summary.n} delivery hours, {fmtDate(days[0])} – {fmtDate(days[days.length - 1])}, each scored with the forecast available at {cutoff} on D-1.
              </p>
            </div>
            {a.coverage.hours < a.coverage.expected && (
              <div className="callout" role="note">
                <span aria-hidden>ⓘ</span>
                <span>
                  <strong>Partial coverage.</strong> {a.coverage.hours} of {a.coverage.expected} delivery hours had a forecast
                  published by {cutoff}; metrics cover those hours only.
                </span>
              </div>
            )}
            <div className="headline">
              <div className="headline-main">
                <span>Typical miss</span>
                <strong>{fmtPower(a.summary.mae)}</strong>
                <small>{fmtPct(a.summary.nmae)} of mean output</small>
              </div>
              <p>
                Forecasts ran <b>{fmtPower(Math.abs(a.summary.bias))} too {a.summary.bias > 0 ? 'high' : 'low'}</b> on average. To be covered in 9 hours out of 10, plan for{' '}
                <b>{fmtPower(a.summary.shortfallBuffer90)} less wind</b> than forecast. A simple trailing bias correction cuts the error by{' '}
                <b className="good">{fmtPct(improvement)}</b>.
              </p>
            </div>
            <div className="grid grid-kpi">
              <Kpi label="MAE" value={fmtPower(a.summary.mae)} emphasis />
              <Kpi label="Bias" value={fmtPower(a.summary.bias, true)} note="Forecast − actual" />
              <Kpi label="RMSE" value={fmtPower(a.summary.rmse)} />
              <Kpi label="P10 – P90 error" value={`${fmtGW(a.summary.p10)} to +${fmtGW(a.summary.p90)}`} note="GW" />
              <Kpi label="Shortfall buffer" value={fmtPower(a.summary.shortfallBuffer90)} note="P90 of error" />
              <Kpi label="Bias-adjusted MAE" value={fmtPower(a.biasAdjustedSummary.mae)} tone="good" note={`${fmtPct(improvement)} lower`} />
            </div>
            <Card title="January at a glance" sub="Click a point to open that delivery day.">
              <Legend items={[{ label: 'Actual', color: C.actual }, { label: 'Decision-time forecast', color: C.forecast }]} />
              <MonthChart acc={a} selectedDay={day} onSelect={openDay} />
            </Card>
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <Card title="Daily error" sub="Click a bar to open that day.">
                <DailyErrorChart acc={a} selectedDay={day} onSelect={openDay} />
              </Card>
              <Card title="Error distribution" sub="Hours by forecast − actual.">
                <Legend items={[{ label: 'Over-forecast (short risk)', color: C.forecast, kind: 'area' }, { label: 'Under-forecast (long risk)', color: C.actual, kind: 'area' }]} />
                <ErrorHistogram acc={a} />
              </Card>
            </div>
          </div>
        )}

        {/* ============================================================ INSIGHTS */}
        {tab === 'insights' && a && insights.data && (
          <div>
            <div className="page-head">
              <h2>What drives the error, and what you can do about it</h2>
              <p>Patterns across the month to help set decision timing and safety margins.</p>
            </div>
            <div className="grid grid-2">
              <Card title="Later decisions use better forecasts" sub="Month MAE if the decision were made at each hour on D-1. Click to try that cutoff.">
                <CutoffChart insights={insights.data} cutoff={cutoff} onSelect={setCutoff} />
              </Card>
              <Card title="Error grows with lead time" sub="All forecasts in the window, grouped by hours ahead.">
                <HorizonChart insights={insights.data} acc={a} />
              </Card>
              <Card title="Error by hour of delivery" sub="Night and early-morning hours are hardest.">
                <Legend items={[{ label: 'MAE', color: 'var(--bar)', kind: 'area' }, { label: 'Bias', color: C.forecast }]} />
                <HourChart acc={a} />
              </Card>
              <Card title="Key takeaways">
                <ul className="takeaways">
                  <li><b>Systematic {a.summary.bias > 0 ? 'over' : 'under'}-forecast:</b> {fmtPower(a.summary.bias, true)} on average (forecast − actual).</li>
                  <li><b>Correctable:</b> removing the trailing 14-day bias cuts MAE by {fmtPct(improvement)}, using only data known at decision time.</li>
                  <li><b>Timing matters:</b> each new forecast run (02:30, 04:30, 07:30, 09:30, 11:30, 15:30 …) lowers the error a little.</li>
                  <li><b>Safety margin:</b> holding back {fmtPower(a.summary.shortfallBuffer90)} covers 90% of hours at the {cutoff} cutoff.</li>
                </ul>
              </Card>
            </div>
          </div>
        )}
      </main>

      <footer className="footer">
        Data: Elexon BMRS WINDFOR &amp; FUELHH (WIND) · snapshot {fmtDayTime(meta.data.fetchedAt)} · all times UK local
      </footer>
    </div>
  )
}
