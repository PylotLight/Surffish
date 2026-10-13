/**
 * Per-request cost of Surffish's declarativeNetRequest matcher.
 *
 *   bun scripts/bench-dnr.ts [rules.json ...]
 *
 * With no arguments it builds a synthetic ruleset shaped like "I still don't care about cookies"
 * 1.1.9 (1734 literal block rules, a third with initiator conditions). Pass real ruleset files
 * (e.g. from `bun scripts/fetch-web-store-extension.ts <id> <dir> --raw`) to measure those instead.
 * Nothing is vendored; the URL mix is typical page subresources (mostly non-matching).
 */
import { readFileSync } from 'node:fs'
import { DnrMatcher, parseDnrRules, type DnrRequest } from '../src/shared/dnr.ts'

function syntheticRules(count: number): unknown[] {
  const words = ['consent', 'cookie', 'gdpr', 'banner', 'notice', 'cmp', 'privacy', 'law', 'policy', 'accept']
  return Array.from({ length: count }, (_, index) => {
    const word = `${words[index % words.length]}${index}`
    const urlFilter = index % 3 === 0 ? `/${word}_` : index % 3 === 1 ? `${word}.example-cdn.com` : `/js/${word}.js`
    const condition: Record<string, unknown> = { urlFilter, resourceTypes: ['script', 'stylesheet', 'xmlhttprequest', 'image'] }
    if (index % 3 === 0) condition.initiatorDomains = [`site${index}.com`]
    if (index % 25 === 0) condition.excludedInitiatorDomains = ['skip.com', 'other.org']
    return { id: index + 1, priority: 1, action: { type: 'block' }, condition }
  })
}

const files = process.argv.slice(2)
const ruleInputs = files.length > 0 ? files.flatMap((file) => JSON.parse(readFileSync(file, 'utf8')) as unknown[]) : syntheticRules(1734)
const parseStart = performance.now()
const parsed = parseDnrRules(ruleInputs, 'bench', 'static')
const matcher = new DnrMatcher(parsed.rules)
const compileMs = performance.now() - parseStart

const hosts = ['www.theguardian.com', 'cdn.jsdelivr.net', 'fonts.gstatic.com', 'www.googletagmanager.com', 'static.xx.fbcdn.net', 'cdn.iubenda.com', 'i.ytimg.com', 'consent.cookiebot.com']
const paths = ['/assets/app.8f3a1c.js', '/css/main.css', '/img/hero-1200x630.jpg?w=1200&q=80', '/gtm.js?id=GTM-ABC123', '/v3/fonts/roboto.woff2', '/iubenda_cs.js', '/uc.js', '/api/v1/feed?page=2&limit=20']
const types: DnrRequest['type'][] = ['script', 'stylesheet', 'image', 'script', 'font', 'script', 'script', 'xmlhttprequest']
const requests: DnrRequest[] = []
for (let index = 0; index < 4000; index += 1) {
  requests.push({ url: `https://${hosts[index % hosts.length]}${paths[(index * 7) % paths.length]}`, initiator: 'https://www.example-news.com', type: types[index % types.length] as DnrRequest['type'] })
}

let matched = 0
for (const request of requests) if (matcher.match(request).rule) matched += 1 // warm-up
const rounds = 25
const start = performance.now()
for (let round = 0; round < rounds; round += 1) for (const request of requests) matcher.match(request)
const perRequestUs = ((performance.now() - start) * 1000) / (rounds * requests.length)
console.log(JSON.stringify({
  rules: parsed.rules.length,
  rejected: parsed.rejected.length,
  compileMs: Number(compileMs.toFixed(1)),
  requests: requests.length,
  matchedPerPass: matched,
  perRequestMicroseconds: Number(perRequestUs.toFixed(2))
}, null, 2))
