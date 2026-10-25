// Display helpers. Everything is shown in UK local time, the buyer's working clock.

const UK = 'Europe/London'

const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, hour: '2-digit', minute: '2-digit' })
const dayFmt = new Intl.DateTimeFormat('en-GB', { timeZone: UK, weekday: 'short', day: 'numeric', month: 'short' })
const dayTimeFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
})

export const toMs = (iso: string) => new Date(iso).getTime()
export const fmtTime = (v: string | number) => timeFmt.format(new Date(v))
export const fmtDay = (v: string | number) => dayFmt.format(new Date(v))
export const fmtDayTime = (v: string | number) => dayTimeFmt.format(new Date(v))
/** A calendar date string (YYYY-MM-DD) shown as e.g. "Thu 15 Jan". */
export const fmtDate = (d: string) => dayFmt.format(new Date(`${d}T12:00:00Z`))

/** MW with GW switch for big numbers: 1 995 -> "2.00 GW", 640 -> "640 MW". */
export function fmtPower(mw: number | null | undefined, signed = false): string {
  if (mw == null || Number.isNaN(mw)) return '–'
  const sign = signed && mw > 0 ? '+' : ''
  return Math.abs(mw) >= 1000 ? `${sign}${(mw / 1000).toFixed(2)} GW` : `${sign}${Math.round(mw)} MW`
}

/** MW -> GW with 2 decimals, e.g. -502.7 -> "-0.50". */
export const fmtGW = (mw: number) => (mw / 1000).toFixed(2)

export function fmtEnergy(mwh: number): string {
  return mwh >= 1000 ? `${(mwh / 1000).toFixed(1)} GWh` : `${Math.round(mwh)} MWh`
}

export const fmtPct = (x: number | null | undefined) => (x == null ? '–' : `${(x * 100).toFixed(1)}%`)
