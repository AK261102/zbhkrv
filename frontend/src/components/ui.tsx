import type { ReactNode } from 'react'

export function Card({ title, sub, actions, children, className = '' }: {
  title?: string
  sub?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p className="sub">{sub}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </div>
  )
}

export function Kpi({ label, value, note, tone, emphasis, title }: {
  label: string
  value: ReactNode
  note?: ReactNode
  tone?: 'good'
  emphasis?: boolean
  title?: string
}) {
  return (
    <div className={`card kpi ${emphasis ? 'emphasis' : ''}`} title={title}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {note && <div className={`note ${tone ?? ''}`}>{note}</div>}
    </div>
  )
}

export function Legend({ items }: {
  items: { label: string; color: string; kind?: 'line' | 'dashed' | 'area' }[]
}) {
  return (
    <div className="legend" role="list">
      {items.map((i) => (
        <span key={i.label} role="listitem">
          <i
            className={`swatch ${i.kind === 'dashed' ? 'dashed' : ''} ${i.kind === 'area' ? 'area' : ''}`}
            style={{ background: i.color, color: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export function TipBox({ title, rows, note }: {
  title: ReactNode
  rows: [string, ReactNode][]
  note?: ReactNode
}) {
  return (
    <div className="tip">
      <div className="tip-title">{title}</div>
      {rows.map(([k, v]) => (
        <div className="row" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
      {note && <div className="muted">{note}</div>}
    </div>
  )
}
