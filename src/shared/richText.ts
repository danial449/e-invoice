/**
 * Rich text for invoice wording (notes, terms).
 *
 * The editor stores a small subset of HTML. Everything that reaches an invoice
 * is run through `sanitizeRichText` first: only the tags and attributes listed
 * here survive, so nothing a paste brings in — scripts, event handlers, styles,
 * iframes, images pointing anywhere — can ride along into a document that gets
 * printed, turned into a PDF and emailed to a customer.
 */

/** Tags the editor can produce, and that an invoice will render. */
const ALLOWED_TAGS = new Set([
  'p', 'br', 'div',
  'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'sub', 'sup',
  'ul', 'ol', 'li',
  'h1', 'h2', 'h3', 'h4',
  'blockquote', 'hr',
  'a', 'span',
  'table', 'thead', 'tbody', 'tr', 'th', 'td'
])

/** Attributes kept, per tag. Everything else is dropped. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
  span: new Set([]),
  div: new Set([]),
  p: new Set([]),
  td: new Set(['colspan', 'rowspan']),
  th: new Set(['colspan', 'rowspan'])
}

/** Only ordinary web and mail links become clickable. */
function safeHref(raw: string): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (/^(https?:|mailto:|tel:)/i.test(v)) return v
  // A bare domain is a link; anything else - javascript:, data:, vbscript: - is not.
  if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(v)) return `https://${v}`
  return null
}

/** True when the value looks like stored rich text rather than plain typing. */
export function isRichText(value: unknown): boolean {
  const s = String(value ?? '')
  return /<(p|div|ul|ol|li|h[1-4]|strong|b|em|i|u|s|br|blockquote|table)\b/i.test(s)
}

/**
 * Strip everything not on the allow-list, keeping the text inside.
 *
 * Written as a single pass over the tags rather than with a DOM, because this
 * runs in the main process while rendering a PDF, where there is no DOM.
 */
export function sanitizeRichText(input: unknown): string {
  let s = String(input ?? '')
  if (!s) return ''

  // Remove whole dangerous elements, contents and all.
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|noscript)\b[\s\S]*?<\/\1\s*>/gi, '')
  s = s.replace(/<(script|style|iframe|object|embed|link|meta|noscript)\b[^>]*\/?>/gi, '')
  // HTML comments can hide conditional markup.
  s = s.replace(/<!--[\s\S]*?-->/g, '')

  return s.replace(/<\/?([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g, (whole, rawName: string, rawAttrs: string) => {
    const tag = rawName.toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) return ''
    if (whole.startsWith('</')) return `</${tag}>`

    const selfClosing = tag === 'br' || tag === 'hr'
    const allowed = ALLOWED_ATTRS[tag]
    if (!allowed || allowed.size === 0) return selfClosing ? `<${tag}>` : `<${tag}>`

    const kept: string[] = []
    const attrRe = /([a-zA-Z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g
    let m: RegExpExecArray | null
    while ((m = attrRe.exec(rawAttrs)) !== null) {
      const name = m[1].toLowerCase()
      if (!allowed.has(name)) continue
      const value = m[3] ?? m[4] ?? m[5] ?? ''
      if (name === 'href') {
        const href = safeHref(value)
        if (!href) continue
        kept.push(`href="${href.replace(/"/g, '&quot;')}"`)
        continue
      }
      kept.push(`${name}="${value.replace(/"/g, '&quot;')}"`)
    }
    return kept.length ? `<${tag} ${kept.join(' ')}>` : `<${tag}>`
  })
}

/** True once the markup carries actual words, not just empty tags. */
export function richTextHasContent(value: unknown): boolean {
  const s = String(value ?? '')
  if (!s.trim()) return false
  return s
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .trim().length > 0
}

/** Rich text reduced to plain lines, for places that cannot show markup. */
export function richTextToPlain(value: unknown): string {
  return String(value ?? '')
    .replace(/<\/(p|div|li|h[1-4]|tr|blockquote)\s*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '• ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
