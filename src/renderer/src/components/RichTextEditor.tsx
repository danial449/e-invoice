import React, { useCallback, useEffect, useRef, useState } from 'react'
import { sanitizeRichText } from '@shared/richText'

interface ToolButton {
  key: string
  label: string
  title: string
  command: string
  value?: string
  /** Draw a separator before this button. */
  startsGroup?: boolean
}

const TOOLS: ToolButton[] = [
  { key: 'bold', label: 'B', title: 'Bold  (Ctrl+B)', command: 'bold' },
  { key: 'italic', label: 'I', title: 'Italic  (Ctrl+I)', command: 'italic' },
  { key: 'underline', label: 'U', title: 'Underline  (Ctrl+U)', command: 'underline' },
  { key: 'strike', label: 'S', title: 'Strikethrough', command: 'strikeThrough' },

  { key: 'ul', label: '•', title: 'Bullet list', command: 'insertUnorderedList', startsGroup: true },
  { key: 'ol', label: '1.', title: 'Numbered list', command: 'insertOrderedList' },
  { key: 'indent', label: '→', title: 'Indent', command: 'indent' },
  { key: 'outdent', label: '←', title: 'Outdent', command: 'outdent' },

  { key: 'h2', label: 'H1', title: 'Heading', command: 'formatBlock', value: 'h2', startsGroup: true },
  { key: 'h3', label: 'H2', title: 'Sub-heading', command: 'formatBlock', value: 'h3' },
  { key: 'p', label: '¶', title: 'Normal text', command: 'formatBlock', value: 'p' },
  { key: 'quote', label: '❝', title: 'Quote', command: 'formatBlock', value: 'blockquote' },

  { key: 'left', label: '≡', title: 'Align left', command: 'justifyLeft', startsGroup: true },
  { key: 'center', label: '≣', title: 'Centre', command: 'justifyCenter' },
  { key: 'hr', label: '―', title: 'Divider', command: 'insertHorizontalRule' }
]

/**
 * A small rich text editor for invoice wording.
 *
 * Built on `contenteditable` rather than an editor library, so the app keeps
 * no extra dependency and works offline. Everything leaving it is sanitised
 * through the same allow-list the invoice renderer uses, so a paste out of
 * Word or a web page cannot smuggle markup into a printed document.
 */
export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  minHeight = 150,
  ariaLabel
}: {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  ariaLabel?: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const lastEmitted = useRef<string>('')
  const [active, setActive] = useState<Record<string, boolean>>({})
  const [focused, setFocused] = useState(false)

  // Only write into the element when the value arrived from outside, or the
  // caret would jump to the start on every keystroke.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const incoming = value ?? ''
    if (incoming === lastEmitted.current) return
    if (el.innerHTML !== incoming) el.innerHTML = incoming
  }, [value])

  const emit = useCallback((): void => {
    const el = ref.current
    if (!el) return
    const html = sanitizeRichText(el.innerHTML)
    lastEmitted.current = html
    onChange(html)
  }, [onChange])

  const refreshActive = useCallback((): void => {
    const next: Record<string, boolean> = {}
    for (const t of TOOLS) {
      if (t.command === 'formatBlock' || t.command === 'insertHorizontalRule') continue
      try {
        next[t.key] = document.queryCommandState(t.command)
      } catch {
        next[t.key] = false
      }
    }
    setActive(next)
  }, [])

  /**
   * Emit real tags (<b>, <i>, <u>) rather than styled spans.
   *
   * Chromium styles with CSS by default, and the sanitiser that protects the
   * invoice drops `style` - so formatting looked right in the editor and then
   * disappeared on the printed page.
   */
  const useTagsNotStyles = (): void => {
    try {
      document.execCommand('styleWithCSS', false, 'false')
    } catch {
      /* older engines simply do not support the switch */
    }
  }

  const run = (tool: ToolButton): void => {
    const el = ref.current
    if (!el) return
    el.focus()
    useTagsNotStyles()
    try {
      if (tool.command === 'formatBlock') document.execCommand('formatBlock', false, tool.value)
      else document.execCommand(tool.command, false, tool.value)
    } catch {
      /* the command is simply unavailable for this selection */
    }
    refreshActive()
    emit()
  }

  const addLink = (): void => {
    const el = ref.current
    if (!el) return
    const url = window.prompt('Link address', 'https://')
    if (!url) return
    el.focus()
    useTagsNotStyles()
    try {
      document.execCommand('createLink', false, url)
    } catch {
      /* nothing selected */
    }
    emit()
  }

  const clearFormatting = (): void => {
    const el = ref.current
    if (!el) return
    el.focus()
    useTagsNotStyles()
    try {
      document.execCommand('removeFormat')
      document.execCommand('unlink')
      document.execCommand('formatBlock', false, 'p')
    } catch {
      /* ignore */
    }
    refreshActive()
    emit()
  }

  /** Paste as markup the editor understands, never raw foreign HTML. */
  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>): void => {
    e.preventDefault()
    const html = e.clipboardData.getData('text/html')
    const text = e.clipboardData.getData('text/plain')
    try {
      if (html) document.execCommand('insertHTML', false, sanitizeRichText(html))
      else document.execCommand('insertText', false, text)
    } catch {
      document.execCommand('insertText', false, text)
    }
    emit()
  }

  const isEmpty = !value || !value.replace(/<[^>]*>/g, '').replace(/&nbsp;/gi, ' ').trim()

  return (
    <div className={`rte ${focused ? 'focused' : ''}`}>
      <div className="rte-toolbar" role="toolbar" aria-label="Formatting">
        {TOOLS.map((t) => (
          <React.Fragment key={t.key}>
            {t.startsGroup ? <span className="rte-sep" aria-hidden="true" /> : null}
            <button
              type="button"
              className={`rte-btn ${active[t.key] ? 'on' : ''} rte-${t.key}`}
              title={t.title}
              aria-label={t.title}
              // Keep the selection: mousedown would blur the editor first.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => run(t)}
            >
              {t.label}
            </button>
          </React.Fragment>
        ))}
        <span className="rte-sep" aria-hidden="true" />
        <button
          type="button"
          className="rte-btn"
          title="Insert link"
          onMouseDown={(e) => e.preventDefault()}
          onClick={addLink}
        >
          &#128279;
        </button>
        <button
          type="button"
          className="rte-btn"
          title="Clear formatting"
          onMouseDown={(e) => e.preventDefault()}
          onClick={clearFormatting}
        >
          &#9003;
        </button>
      </div>

      <div className="rte-surface" style={{ minHeight }}>
        {isEmpty && placeholder ? <div className="rte-placeholder">{placeholder}</div> : null}
        <div
          ref={ref}
          className="rte-input"
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel ?? 'Rich text'}
          onInput={emit}
          onBlur={() => {
            setFocused(false)
            emit()
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={(e) => {
            // The keyboard shortcuts bypass the toolbar, so switch the engine
            // over before Chromium handles them.
            if (e.ctrlKey || e.metaKey) useTagsNotStyles()
          }}
          onKeyUp={refreshActive}
          onMouseUp={refreshActive}
          onPaste={onPaste}
        />
      </div>
    </div>
  )
}
