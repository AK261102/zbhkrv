import {
  Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, LineChart,
  ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import type { Accuracy, DayView, Insights } from '../api'
import { fmtDate, fmtDay, fmtDayTime, fmtGW, fmtPower, fmtTime, toMs } from '../format'
import { TipBox } from './ui'

// Recharts passes the hovered row(s) in `payload`; we only need our own row type back.
interface TipProps<Row> {
  active?: boolean
  payload?: ReadonlyArray<{ payload: Row }>
}
const rowOf = <Row,>(p: TipProps<Row>) => (p.active && p.payload?.length ? p.payload[0].payload : null)

const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  adjusted: 'var(--series-adjusted)',
  band: 'var(--band)',
  grid: 'var(--grid)',
  axis: 'var(--axis)',
  bar: 'var(--bar)',
  barMuted: 'var(--bar-muted)',
  ink2: 'var(--ink-2)',
}

const axisProps = { stroke: C.axis, tickLine: false, tick: { fontSize: 11 } } as const
const gwAxis = {
  ...axisProps,
  width: 44,
  tickFormatter: (v: number) => String(+(v / 1000).toFixed(2)),
  label: { value: 'GW', position: 'insideTopLeft', offset: 0, dy: -18, dx: 8, fontSize: 11, fill: 'var(--ink-muted)' },
} as const
const margin = { top: 22, right: 12, bottom: 4, left: 0 }

/** Evenly spaced "round" ticks (1, 2, 2.5, 5 x 10^k) covering [min, max]. */
function niceTicks(min: number, max: number, target = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / target
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? 10 * mag
  const ticks = []
  for (let v = Math.floor(min / step) * step; v <= Math.ceil(max / step) * step + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6)
  return ticks
}
const yTicks = (values: (number | null | undefined)[], fromZero = true) => {
  const vs = values.filter((v): v is number => v != null)
  const t = niceTicks(fromZero ? Math.min(0, ...vs) : Math.min(...vs), Math.max(...vs))
  return { ticks: t, domain: [t[0], t[t.length - 1]] as [number, number] }
}

// ------------------------------------------------------------------ day chart

interface DayRow {
  x: number
  actual?: number
  forecast?: number
  adjusted?: number
  band?: [number, number]
  publishTime?: string
  horizonH?: number
}

export function DayChart({ day, showAdjusted }: { day: DayView; showAdjusted: boolean }) {
  const rows = new Map<number, DayRow>()
  for (const a of day.actuals) rows.set(toMs(a.t), { x: toMs(a.t), actual: a.mw })
  for (const f of day.forecast) {
    const x = toMs(f.t)
    rows.set(x, {
      ...rows.get(x), x, forecast: f.mw, adjusted: f.adjusted, band: [f.low, f.high],
      publishTime: f.publishTime, horizonH: f.horizonH,
    })
  }
  const data = [...rows.values()].sort((a, b) => a.x - b.x)
  const pct = (q: number) => `P${Math.round(q * 100)}`

  return (
    <ResponsiveContainer width="100%" height={340}>
      <ComposedChart data={data} margin={margin}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']}
          ticks={data.filter((r) => new Date(r.x).getUTCMinutes() === 0 && new Date(r.x).getUTCHours() % 3 === 0).map((r) => r.x)}
          tickFormatter={fmtTime} {...axisProps} />
        <YAxis {...gwAxis} {...yTicks(data.flatMap((r) => [r.actual, r.band?.[1], r.forecast]))} />
        <Tooltip
          cursor={{ stroke: C.axis }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<DayRow>)
            if (!r) return null
            return (
              <TipBox
                title={fmtDayTime(r.x)}
                rows={[
                  ['Actual', fmtPower(r.actual)],
                  ...(r.forecast != null ? [['Forecast', fmtPower(r.forecast)] as [string, string]] : []),
                  ...(r.forecast != null && showAdjusted ? [['Bias-adjusted', fmtPower(r.adjusted)] as [string, string]] : []),
                  ...(r.band ? [[`Likely range (${pct(day.band.lowerQuantile)}–${pct(day.band.upperQuantile)})`, `${fmtGW(r.band[0])}–${fmtGW(r.band[1])} GW`] as [string, string]] : []),
                  ...(r.forecast != null && r.actual != null ? [['Error (fc − act)', fmtPower(r.forecast - r.actual, true)] as [string, string]] : []),
                ]}
                note={r.publishTime ? `Forecast run ${fmtDayTime(r.publishTime)} · ${r.horizonH?.toFixed(1)}h ahead` : 'Half-hour actual (no hourly forecast)'}
              />
            )
          }}
        />
        <Area dataKey="band" stroke="none" fill={C.band} connectNulls isAnimationActive={false} />
        <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="forecast" stroke={C.forecast} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
        {showAdjusted && (
          <Line dataKey="adjusted" stroke={C.adjusted} strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={false} />
        )}
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ month overview

interface MonthRow { x: number; actual: number | null; forecast: number; day: string }

export function MonthChart({ acc, selectedDay, onSelect }: {
  acc: Accuracy
  selectedDay: string
  onSelect: (day: string) => void
}) {
  const data: MonthRow[] = acc.series.map((s) => ({
    x: toMs(s.t), actual: s.actual, forecast: s.forecast,
    day: new Date(s.t).toLocaleDateString('en-CA', { timeZone: 'Europe/London' }),
  }))
  const dayStart = toMs(`${selectedDay}T00:00:00Z`)
  const ticks = acc.byDay.filter((_, i) => i % 5 === 0).map((d) => toMs(`${d.deliveryDay}T00:00:00Z`))

  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart
        data={data} margin={margin} style={{ cursor: 'pointer' }}
        onClick={(e) => {
          const idx = Number(e?.activeTooltipIndex ?? -1)
          if (idx >= 0 && data[idx]) onSelect(data[idx].day)
        }}
      >
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} ticks={ticks}
          tickFormatter={fmtDay} {...axisProps} />
        <YAxis {...gwAxis} {...yTicks(data.flatMap((r) => [r.actual, r.forecast]))} />
        <ReferenceArea x1={dayStart} x2={dayStart + 23 * 3600e3} fill="var(--accent)" fillOpacity={0.1} stroke="none" />
        <Tooltip
          cursor={{ stroke: C.axis }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<MonthRow>)
            if (!r) return null
            return (
              <TipBox title={fmtDayTime(r.x)}
                rows={[['Actual', fmtPower(r.actual)], ['Decision-time forecast', fmtPower(r.forecast)],
                  ['Error', r.actual == null ? '–' : fmtPower(r.forecast - r.actual, true)]]}
                note="Click to open this day" />
            )
          }}
        />
        <Line dataKey="actual" stroke={C.actual} strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line dataKey="forecast" stroke={C.forecast} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ daily error bars

export function DailyErrorChart({ acc, selectedDay, onSelect }: {
  acc: Accuracy
  selectedDay: string
  onSelect: (day: string) => void
}) {
  const data = acc.byDay.map((d) => ({ ...d, label: fmtDate(d.deliveryDay) }))
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ ...margin, right: 24 }} barCategoryGap={2}
        onClick={(e) => {
          const idx = Number(e?.activeTooltipIndex ?? -1)
          if (idx >= 0 && data[idx]) onSelect(data[idx].deliveryDay)
        }}
        style={{ cursor: 'pointer' }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={4} />
        <YAxis {...gwAxis} {...yTicks(data.map((d) => d.mae))} />
        <Tooltip cursor={{ fill: 'var(--grid)', fillOpacity: 0.5 }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<(typeof data)[number]>)
            if (!r) return null
            return (
              <TipBox title={`Delivery ${r.label}`}
                rows={[['MAE', fmtPower(r.mae)], ['Bias', fmtPower(r.bias, true)],
                  ['Forecast run', r.forecastRuns.map((t) => fmtDayTime(t)).join(', ')]]}
                note="Click to open this day" />
            )
          }} />
        <Bar dataKey="mae" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.deliveryDay} fill={d.deliveryDay === selectedDay ? C.bar : C.barMuted} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ by hour of day

export function HourChart({ acc }: { acc: Accuracy }) {
  const data = acc.byHour.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }))
  return (
    <ResponsiveContainer width="100%" height={240}>
      <ComposedChart data={data} margin={margin} barCategoryGap={2}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} interval={2} />
        <YAxis {...gwAxis} {...yTicks(data.flatMap((d) => [d.mae, d.bias]))} />
        <ReferenceLine y={0} stroke={C.axis} />
        <Tooltip cursor={{ fill: 'var(--grid)', fillOpacity: 0.5 }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<(typeof data)[number]>)
            if (!r) return null
            return <TipBox title={`${r.label} UK time`} rows={[['MAE', fmtPower(r.mae)], ['Bias', fmtPower(r.bias, true)], ['Hours', String(r.n)]]} />
          }} />
        <Bar dataKey="mae" fill={C.bar} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        <Line dataKey="bias" stroke={C.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ error distribution

export function ErrorHistogram({ acc }: { acc: Accuracy }) {
  const data = acc.histogram.map((b) => ({ ...b, mid: (b.from + b.to) / 2 }))
  const { p10, p90 } = acc.summary
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={margin} barCategoryGap={2}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="mid" type="number" {...axisProps}
          domain={[data[0].from, data[data.length - 1].to]}
          ticks={niceTicks(data[0].from, data[data.length - 1].to, 8).filter((t) => t >= data[0].from && t <= data[data.length - 1].to)}
          tickFormatter={(v: number) => `${v > 0 ? '+' : ''}${+(v / 1000).toFixed(1)}`}
          label={{ value: 'Forecast − actual (GW)', position: 'insideBottomRight', offset: -2, fontSize: 11, fill: 'var(--ink-muted)' }} />
        <YAxis {...axisProps} width={36} allowDecimals={false} {...yTicks(data.map((d) => d.count))}
          label={{ value: 'hours', position: 'insideTopLeft', offset: 0, dy: -18, dx: 4, fontSize: 11, fill: 'var(--ink-muted)' }} />
        <ReferenceArea x1={p10} x2={p90} fill="var(--accent)" fillOpacity={0.06} stroke="none" />
        <ReferenceLine x={0} stroke={C.ink2} strokeWidth={1} />
        <Tooltip cursor={{ fill: 'var(--grid)', fillOpacity: 0.5 }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<(typeof data)[number]>)
            if (!r) return null
            return <TipBox title={`${fmtPower(r.from, true)} to ${fmtPower(r.to, true)}`}
              rows={[['Hours', String(r.count)], ['Share', `${((r.count / acc.summary.n) * 100).toFixed(1)}%`]]}
              note={r.from >= 0 ? 'Over-forecast → buyer would be short' : 'Under-forecast → buyer would be long'} />
          }} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} isAnimationActive={false}>
          {data.map((d) => <Cell key={d.from} fill={d.from >= 0 ? C.forecast : C.actual} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ lead time

export function HorizonChart({ insights, acc }: { insights: Insights; acc: Accuracy }) {
  const data = insights.horizonCurve.map((h) => ({ ...h, mid: (h.fromH + h.toH) / 2, label: `${h.fromH}–${h.toH}h` }))
  const hs = acc.series.map((s) => s.horizonH)
  const [lo, hi] = [Math.min(...hs), Math.max(...hs)]
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={margin}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="mid" type="number" domain={[0, 'dataMax + 3']} ticks={[0, 12, 24, 36, 48, 60, 72]} {...axisProps}
          tickFormatter={(v: number) => `${v}h`} />
        <YAxis {...gwAxis} {...yTicks(data.map((d) => d.mae))} />
        <ReferenceArea x1={lo} x2={hi} fill="var(--accent)" fillOpacity={0.08} stroke="none"
          label={{ value: `Lead times used at ${acc.cutoff}`, position: 'insideBottom', fontSize: 11, fill: 'var(--ink-2)' }} />
        <Tooltip cursor={{ stroke: C.axis }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<(typeof data)[number]>)
            if (!r) return null
            return <TipBox title={`${r.label} ahead`} rows={[['MAE', fmtPower(r.mae)], ['RMSE', fmtPower(r.rmse)], ['Bias', fmtPower(r.bias, true)], ['Samples', String(r.n)]]} />
          }} />
        <Line dataKey="mae" stroke={C.bar} strokeWidth={2} dot={{ r: 4, fill: C.bar, strokeWidth: 2, stroke: 'var(--surface)' }} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ------------------------------------------------------------------ cutoff sensitivity

export function CutoffChart({ insights, cutoff, onSelect }: {
  insights: Insights
  cutoff: string
  onSelect: (cutoff: string) => void
}) {
  const data = insights.cutoffSensitivity
  const current = `${cutoff.slice(0, 2)}:00`
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={data} margin={margin} style={{ cursor: 'pointer' }}
        onClick={(e) => {
          const idx = Number(e?.activeTooltipIndex ?? -1)
          if (idx >= 0 && data[idx]) onSelect(data[idx].cutoff)
        }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="cutoff" {...axisProps} interval={2} />
        <YAxis {...gwAxis} {...yTicks(data.map((d) => d.mae), false)} />
        <ReferenceLine x={current} stroke={C.ink2} label={{ value: 'current', position: 'insideTopRight', fontSize: 11, fill: 'var(--ink-2)' }} />
        <Tooltip cursor={{ stroke: C.axis }}
          content={(p) => {
            const r = rowOf(p as unknown as TipProps<(typeof data)[number]>)
            if (!r) return null
            return <TipBox title={`Decide at ${r.cutoff} on D-1`} rows={[['Month MAE', fmtPower(r.mae)], ['RMSE', fmtPower(r.rmse)], ['Hours scored', `${r.n} of ${r.expected}`]]}
              note={r.n < r.expected ? 'Earliest runs do not reach the last hours of D' : 'Click to use this cutoff'} />
          }} />
        <Line type="stepAfter" dataKey="mae" stroke={C.bar} strokeWidth={2} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}
