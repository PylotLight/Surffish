import { parse, type HTMLElement } from 'node-html-parser'
import { normalizeWatchText } from '../shared/page-watchers'

/**
 * Text of a fetched page for a watcher, without a browser: parse the HTML with node-html-parser
 * (no scripts run, nothing is fetched), pick the watched element and take its block-aware text.
 */

const NEVER_TEXT = 'script, style, noscript, template, svg, iframe, object, embed, head'
/** Page chrome that changes on its own (menus, cookie banners, footers with the year). */
const PAGE_CHROME = 'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [aria-hidden="true"]'

export type WatchTextResult = { ok: true; lines: string[] } | { ok: false; error: string }

/** Throws on selectors the parser can't read, so a typo is caught when the watcher is saved. */
export function isSupportedWatchSelector(selector: string): boolean {
  try {
    parse('<html><body></body></html>').querySelector(selector)
    return true
  } catch {
    return false
  }
}

function mainElement(root: HTMLElement): HTMLElement | null {
  const main = root.querySelector('main') ?? root.querySelector('[role="main"]')
  if (main) return main
  const articles = root.querySelectorAll('article')
  if (articles.length === 1) return articles[0]!
  const body = root.querySelector('body') ?? root
  for (const element of body.querySelectorAll(PAGE_CHROME)) element.remove()
  return body
}

export function extractWatchText(html: string, selector: string | null): WatchTextResult {
  let root: HTMLElement
  try {
    root = parse(html, { comment: false, blockTextElements: { script: false, style: false, noscript: false, pre: true } })
  } catch {
    return { ok: false, error: 'Could not read the page’s HTML.' }
  }
  for (const element of root.querySelectorAll(NEVER_TEXT)) element.remove()
  let target: HTMLElement | null
  if (selector) {
    try {
      target = root.querySelector(selector)
    } catch {
      return { ok: false, error: 'The CSS selector is not supported.' }
    }
    if (!target) return { ok: false, error: 'The watched element was not found in the page’s HTML. If the page builds it with JavaScript, turn on “Render JavaScript”.' }
  } else {
    target = mainElement(root)
  }
  if (!target) return { ok: false, error: 'The page has no text to watch.' }
  return { ok: true, lines: normalizeWatchText(target.structuredText) }
}
