import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'

// ─────────────────────── Toasts ───────────────────────

type ToastKind = 'info' | 'success' | 'error' | 'warn'
interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void
  success: (m: string) => void
  error: (m: unknown) => void
  warn: (m: string) => void
}

const ToastCtx = createContext<ToastApi>({
  push: () => {},
  success: () => {},
  error: () => {},
  warn: () => {}
})

export function useToast(): ToastApi {
  return useContext(ToastCtx)
}

let toastId = 0

export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([])

  const remove = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id))
  }, [])

  const push = useCallback(
    (message: string, kind: ToastKind = 'info') => {
      const id = ++toastId
      setToasts((t) => [...t, { id, kind, message }])
      // Errors linger so they can actually be read.
      window.setTimeout(() => remove(id), kind === 'error' ? 9000 : 4000)
    },
    [remove]
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (m) => push(m, 'success'),
      warn: (m) => push(m, 'warn'),
      error: (m) => push(m instanceof Error ? m.message : String(m), 'error')
    }),
    [push]
  )

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span className="toast-msg">{t.message}</span>
            <button className="toast-close" onClick={() => remove(t.id)} aria-label="Dismiss">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ─────────────────────── Modal ───────────────────────

export function Modal({
  title,
  children,
  footer,
  onClose,
  size = 'normal',
  className = ''
}: {
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
  onClose: () => void
  size?: 'narrow' | 'normal' | 'wide'
  /** Extra class on the dialog, for one-off sizing. */
  className?: string
}): React.JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const base = size === 'wide' ? 'modal wide' : size === 'narrow' ? 'modal narrow' : 'modal'
  const cls = className ? `${base} ${className}` : base

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cls} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn-ghost btn-sm ml-auto" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  )
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onConfirm,
  onCancel
}: {
  title: string
  message: React.ReactNode
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}): React.JSX.Element {
  return (
    <Modal
      title={title}
      size="narrow"
      onClose={onCancel}
      footer={
        <>
          <button onClick={onCancel}>Cancel</button>
          <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      <div style={{ fontSize: 13.5, lineHeight: 1.6 }}>{message}</div>
    </Modal>
  )
}

// ─────────────────────── Small helpers ───────────────────────

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="loading-page">
      <span className="spinner" />
      {label ? <span>{label}</span> : null}
    </div>
  )
}

export function Empty({
  icon = '∅',
  title,
  hint,
  action
}: {
  icon?: string
  title: string
  hint?: string
  action?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <div className="empty-title">{title}</div>
      {hint ? <div className="small">{hint}</div> : null}
      {action ? <div className="mt16">{action}</div> : null}
    </div>
  )
}

/** Collapsible section used throughout the template designer. */
export function Accordion({
  title,
  icon,
  defaultOpen = false,
  children
}: {
  title: string
  icon?: string
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className={`acc ${open ? 'open' : ''}`}>
      <button className="acc-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {icon ? <span className="nav-icon">{icon}</span> : null}
        <span>{title}</span>
        <span className="chev">▶</span>
      </button>
      {open ? <div className="acc-body">{children}</div> : null}
    </div>
  )
}

export function Toggle({
  label,
  checked,
  onChange,
  help
}: {
  label: string
  checked: boolean
  onChange: (v: boolean) => void
  help?: string
}): React.JSX.Element {
  return (
    <div className="ctl">
      <label className="inline-check">
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span>{label}</span>
      </label>
      {help ? <div className="help">{help}</div> : null}
    </div>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  onChange: (v: number) => void
}): React.JSX.Element {
  return (
    <div className="ctl">
      <label>{label}</label>
      <div className="slider-row">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value))}
        />
        <span className="slider-val">
          {Math.round(value * 100) / 100}
          {unit}
        </span>
      </div>
    </div>
  )
}

export function ColorField({
  label,
  value,
  onChange
}: {
  label: string
  value: string
  onChange: (v: string) => void
}): React.JSX.Element {
  // <input type=color> only accepts #rrggbb; keep a text box for anything else.
  const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'
  return (
    <div className="ctl">
      <label>{label}</label>
      <div className="color-row">
        <input type="color" value={hex} onChange={(e) => onChange(e.target.value)} />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />
      </div>
    </div>
  )
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
}): React.JSX.Element {
  return (
    <div className="ctl">
      {label ? <label>{label}</label> : null}
      <div className="seg">
        {options.map((o) => (
          <button key={o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix
}: {
  label: string
  value: number
  onChange: (v: number) => void
  min?: number
  max?: number
  step?: number
  suffix?: string
}): React.JSX.Element {
  return (
    <div className="ctl-row">
      <label>
        {label}
        {suffix ? <span className="muted"> ({suffix})</span> : null}
      </label>
      <div className="ctl-input">
        <input
          type="number"
          value={Number.isFinite(value) ? value : 0}
          min={min}
          max={max}
          step={step}
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            onChange(Number.isFinite(v) ? v : 0)
          }}
        />
      </div>
    </div>
  )
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  help
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  help?: string
}): React.JSX.Element {
  return (
    <div className="ctl">
      <label>{label}</label>
      <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      {help ? <div className="help">{help}</div> : null}
    </div>
  )
}

/** Debounce a rapidly changing value (search boxes, live preview). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delay)
    return () => window.clearTimeout(t)
  }, [value, delay])
  return v
}
