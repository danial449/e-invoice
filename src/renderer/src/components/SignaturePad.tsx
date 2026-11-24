import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Modal } from './ui'

interface Point {
  x: number
  y: number
  /** Pen pressure where the device reports it, otherwise derived from speed. */
  w: number
}

type Stroke = Point[]

const COLORS = ['#101828', '#1d4ed8', '#047857', '#b91c1c']

/** Drawn at this size, then exported trimmed to the ink. */
const W = 760
const H = 260

/**
 * Draw a signature with a mouse, trackpad, pen or finger.
 *
 * Strokes are smoothed through the midpoints between samples, and the nib
 * width follows how fast the pen is moving — slow strokes lay down more ink,
 * fast ones taper — which is what makes a drawn line read as handwriting
 * rather than a constant-width scribble.
 */
export default function SignaturePad({
  initial,
  onCancel,
  onSave
}: {
  initial?: string
  onCancel: () => void
  onSave: (dataUrl: string) => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const strokesRef = useRef<Stroke[]>([])
  const currentRef = useRef<Stroke | null>(null)
  const lastRef = useRef<{ x: number; y: number; t: number } | null>(null)

  const [color, setColor] = useState(COLORS[0])
  const [size, setSize] = useState(3)
  const [hasInk, setHasInk] = useState(false)
  const [showGuide, setShowGuide] = useState(true)

  /** Repaint everything from the stroke list. */
  const repaint = useCallback((): void => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, W, H)

    if (showGuide) {
      ctx.save()
      ctx.strokeStyle = 'rgba(148,163,184,.55)'
      ctx.setLineDash([6, 6])
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(40, H - 62)
      ctx.lineTo(W - 40, H - 62)
      ctx.stroke()
      ctx.restore()
    }

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'

    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue
      ctx.strokeStyle = (stroke as Stroke & { color?: string }).color ?? color

      if (stroke.length === 1) {
        // A tap still leaves a dot.
        ctx.beginPath()
        ctx.arc(stroke[0].x, stroke[0].y, stroke[0].w / 2, 0, Math.PI * 2)
        ctx.fillStyle = ctx.strokeStyle
        ctx.fill()
        continue
      }

      // Each segment is drawn separately so its width can vary along the line.
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]
        const b = stroke[i]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        ctx.beginPath()
        ctx.lineWidth = (a.w + b.w) / 2
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }
  }, [color, showGuide])

  useEffect(() => {
    repaint()
  }, [repaint])

  const pointFrom = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const canvas = canvasRef.current!
    const rect = canvas.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * W
    const y = ((e.clientY - rect.top) / rect.height) * H

    const now = performance.now()
    let w = size

    if (e.pressure > 0 && e.pressure !== 0.5) {
      // A real pen reports pressure; 0.5 is the mouse's fixed stand-in.
      w = size * (0.45 + e.pressure * 1.1)
    } else if (lastRef.current) {
      const dt = Math.max(1, now - lastRef.current.t)
      const dist = Math.hypot(x - lastRef.current.x, y - lastRef.current.y)
      const speed = dist / dt
      // Faster movement lays down a thinner line, as a real nib would.
      w = size * Math.max(0.42, Math.min(1.6, 1.5 - speed * 0.42))
    }

    lastRef.current = { x, y, t: now }
    return { x, y, w }
  }

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    lastRef.current = null
    const stroke: Stroke = [pointFrom(e)]
    ;(stroke as Stroke & { color?: string }).color = color
    currentRef.current = stroke
    strokesRef.current.push(stroke)
    setHasInk(true)
    repaint()
  }

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    if (!currentRef.current) return
    currentRef.current.push(pointFrom(e))
    repaint()
  }

  const onUp = (): void => {
    currentRef.current = null
    lastRef.current = null
  }

  const undo = (): void => {
    strokesRef.current.pop()
    setHasInk(strokesRef.current.length > 0)
    repaint()
  }

  const clear = (): void => {
    strokesRef.current = []
    setHasInk(false)
    repaint()
  }

  /**
   * Export the ink alone: no guide line, no background, cropped to what was
   * actually drawn so it does not arrive on the invoice surrounded by empty
   * space.
   */
  const save = (): void => {
    const out = document.createElement('canvas')
    out.width = W
    out.height = H
    const ctx = out.getContext('2d')
    if (!ctx) return

    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue
      ctx.strokeStyle = (stroke as Stroke & { color?: string }).color ?? color
      if (stroke.length === 1) {
        ctx.beginPath()
        ctx.arc(stroke[0].x, stroke[0].y, stroke[0].w / 2, 0, Math.PI * 2)
        ctx.fillStyle = ctx.strokeStyle
        ctx.fill()
        continue
      }
      for (let i = 1; i < stroke.length; i++) {
        const a = stroke[i - 1]
        const b = stroke[i]
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
        ctx.beginPath()
        ctx.lineWidth = (a.w + b.w) / 2
        ctx.moveTo(a.x, a.y)
        ctx.quadraticCurveTo(a.x, a.y, mid.x, mid.y)
        ctx.lineTo(b.x, b.y)
        ctx.stroke()
      }
    }

    // Find the drawn bounds from the alpha channel.
    const img = ctx.getImageData(0, 0, W, H).data
    let minX = W
    let minY = H
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (img[(y * W + x) * 4 + 3] > 8) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    if (maxX < 0) return // nothing drawn

    const pad = 8
    minX = Math.max(0, minX - pad)
    minY = Math.max(0, minY - pad)
    maxX = Math.min(W - 1, maxX + pad)
    maxY = Math.min(H - 1, maxY + pad)

    const cropped = document.createElement('canvas')
    cropped.width = maxX - minX + 1
    cropped.height = maxY - minY + 1
    cropped
      .getContext('2d')
      ?.drawImage(out, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)

    onSave(cropped.toDataURL('image/png'))
  }

  return (
    <Modal
      title="Draw your signature"
      onClose={onCancel}
      size="wide"
      footer={
        <>
          <button onClick={undo} disabled={!hasInk}>
            ↶ Undo stroke
          </button>
          <button onClick={clear} disabled={!hasInk}>
            Clear
          </button>
          <button className="ml-auto" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-primary" onClick={save} disabled={!hasInk}>
            Use this signature
          </button>
        </>
      }
    >
      <div className="sig-toolbar">
        <div className="sig-colors">
          <span className="small dim">Ink</span>
          {COLORS.map((c) => (
            <button
              key={c}
              className={`sig-swatch ${color === c ? 'active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Ink colour ${c}`}
            />
          ))}
        </div>

        <label className="sig-size">
          <span className="small dim">Nib</span>
          <input
            type="range"
            min={1}
            max={8}
            step={0.5}
            value={size}
            onChange={(e) => setSize(parseFloat(e.target.value))}
          />
          <span className="xsmall muted">{size.toFixed(1)}</span>
        </label>

        <label className="inline-check ml-auto">
          <input type="checkbox" checked={showGuide} onChange={(e) => setShowGuide(e.target.checked)} />
          <span className="small">Guide line</span>
        </label>
      </div>

      <canvas
        ref={canvasRef}
        className="sig-canvas"
        width={W}
        height={H}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
        onPointerCancel={onUp}
      />

      <p className="small muted mb0 mt8">
        Sign with your mouse, trackpad, pen or finger. Press harder, or move slowly, for a thicker
        line. Only the ink is kept — the background stays transparent and the image is trimmed to
        what you drew, so it sits neatly above the signature line.
        {initial ? ' Saving replaces the signature you already have.' : ''}
      </p>
    </Modal>
  )
}
