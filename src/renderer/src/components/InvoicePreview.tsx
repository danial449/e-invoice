import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { api } from '../lib/api'
import { useDebounced } from './ui'
import { pageDimensions } from '@shared/renderInvoice'
import type { InvoiceWithItems, TemplateConfig } from '@shared/types'

const PX_PER_MM = 96 / 25.4
/** Breathing room around the sheet inside the preview pane. */
const GUTTER = 34

/**
 * Renders an invoice into a sandboxed iframe, scaled so a full page always
 * fits the pane width. The HTML is produced by the same renderer that makes
 * the PDF, so the preview is a true representation of the printed page.
 */
export default function InvoicePreview({
  invoice,
  config,
  debounceMs = 300
}: {
  invoice: InvoiceWithItems
  config: TemplateConfig | null
  debounceMs?: number
}): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const [paneWidth, setPaneWidth] = useState(0)
  const [html, setHtml] = useState('')

  // Track the available width so the page can be scaled to fit.
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const measure = (): void => setPaneWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const debouncedInvoice = useDebounced(invoice, debounceMs)
  const debouncedConfig = useDebounced(config, debounceMs)
  const debouncedWidth = useDebounced(paneWidth, 120)

  useEffect(() => {
    if (!debouncedConfig || debouncedWidth <= 0) return

    const pageWidthPx = pageDimensions(debouncedConfig).w * PX_PER_MM
    const scale = Math.min(1, Math.max(0.2, (debouncedWidth - GUTTER) / pageWidthPx))

    let cancelled = false
    void api
      .previewHtml(debouncedInvoice, debouncedConfig, scale)
      .then((h) => {
        if (!cancelled) setHtml(h)
      })
      .catch(() => {
        // The preview is non-critical; leave the previous render in place.
      })
    return () => {
      cancelled = true
    }
  }, [debouncedInvoice, debouncedConfig, debouncedWidth])

  return (
    <div className="preview-host" ref={hostRef}>
      {/* sandbox="" keeps scripts disabled inside the preview document. */}
      <iframe className="preview-frame" title="Invoice preview" sandbox="" srcDoc={html} />
    </div>
  )
}
