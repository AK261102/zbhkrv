// Typed client for the FastAPI backend. All requests are same-origin `/api/...`
// (Vite proxies them in dev; FastAPI serves both in the container).

export interface Metrics {
  n: number
  mae: number
  rmse: number
  bias: number
  nmae: number | null
  meanActual: number
  p10: number
  p50: number
  p90: number
  shortfallBuffer90: number
  maxOverForecast: number
  maxUnderForecast: number
}

export interface Coverage {
  hours: number
  expected: number
}

export interface Meta {
  source: string
  fetchedAt: string
  defaultCutoff: string
  decisionWindow: [string, string]
  deliveryDays: string[]
  timezone: string
}

export interface DayForecastPoint {
  t: string
  mw: number
  publishTime: string
  horizonH: number
  low: number
  high: number
  adjusted: number
  actual: number | null
}

export interface DayView {
  deliveryDay: string
  decisionDay: string
  cutoff: string
  cutoffUtc: string
  forecastRuns: string[]
  band: { lowerQuantile: number; upperQuantile: number }
  forecast: DayForecastPoint[]
  actuals: { t: string; mw: number }[]
  metrics: Metrics | null
  trailingBias: number
  biasAdjustedMetrics: Metrics | null
  coverage: Coverage
  totals: { forecastMWh: number; actualMWh: number }
}

export interface Accuracy {
  cutoff: string
  coverage: Coverage
  summary: Metrics
  biasAdjustedSummary: Metrics
  biasWindowDays: number
  meanHorizonH: number
  byHour: { hour: number; mae: number | null; bias: number | null; n: number }[]
  byDay: { deliveryDay: string; mae: number | null; bias: number | null; nmae: number | null; forecastRuns: string[] }[]
  histogram: { from: number; to: number; count: number }[]
  series: { t: string; forecast: number; actual: number | null; publishTime: string; horizonH: number }[]
}

export interface Insights {
  horizonCurve: { fromH: number; toH: number; mae: number; bias: number; rmse: number; n: number }[]
  cutoffSensitivity: { cutoff: string; mae: number | null; rmse: number | null; n: number; expected: number }[]
}

async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const qs = params ? `?${new URLSearchParams(params)}` : ''
  const res = await fetch(`/api${path}${qs}`)
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  meta: () => get<Meta>('/meta'),
  day: (date: string, cutoff: string) => get<DayView>('/day', { date, cutoff }),
  accuracy: (cutoff: string) => get<Accuracy>('/accuracy', { cutoff }),
  insights: () => get<Insights>('/insights'),
}
