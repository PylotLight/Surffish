import { describe, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { jsString, shellQuote, toCurl, toFetch } from './request-snippets.ts'

const HOSTILE = [
  `it's`, `"double"`, '$(rm -rf ~)', '`whoami`', 'back\\slash', 'semi; colon && pipe | amp &', 'new\nline', 'tab\there',
  'cr\rhere', 'nul-ish \x01\x1b[31m', 'unicode ü 中文 😀', '!history !!', '*glob?[a]', '~tilde', '$HOME ${HOME}', `'`, '', ' '
]

/** What the shell actually passes as an argument for a quoted word. */
function bashEcho(word: string): string | null {
  const result = spawnSync('bash', ['-c', `printf '%s' ${word}`], { encoding: 'utf8' })
  return result.status === 0 ? result.stdout : null
}

describe('shell quoting', () => {
  test('simple values use single quotes', () => {
    expect(shellQuote('abc')).toBe(`'abc'`)
    expect(shellQuote(`it's`)).toBe(`'it'\\''s'`)
    expect(shellQuote('$(x) `y`')).toBe(`'$(x) \`y\`'`)
  })
  test('control and non-ASCII characters use $\'…\' escapes', () => {
    expect(shellQuote('a\nb')).toBe(`$'a\\nb'`)
    expect(shellQuote("x'\\")).toBe(`'x'\\''\\'`)
    expect(shellQuote('é\x01')).toBe(`$'\\xc3\\xa9\\x01'`)
    expect(shellQuote('中')).toBe(`$'\\xe4\\xb8\\xad'`)
    expect(shellQuote('😀')).toBe(`$'\\xf0\\x9f\\x98\\x80'`)
  })
  const hasBash = spawnSync('bash', ['-c', 'true']).status === 0
  test.if(hasBash)('bash reads every hostile value back unchanged', () => {
    for (const value of HOSTILE) expect(bashEcho(shellQuote(value))).toBe(value)
  })
})

describe('copy as cURL', () => {
  test('GET with headers; pseudo and computed headers dropped', () => {
    expect(toCurl({
      method: 'GET',
      url: 'https://example.com/a?b=1&c=2',
      headers: [{ name: ':authority', value: 'example.com' }, { name: 'Accept', value: 'text/html' }, { name: 'Content-Length', value: '0' }, { name: 'Accept-Encoding', value: 'gzip, br' }, { name: 'X-Empty', value: '' }],
      body: null
    })).toBe([
      `curl 'https://example.com/a?b=1&c=2'`,
      `-H 'Accept: text/html'`,
      `-H 'Accept-Encoding: gzip, br'`,
      `-H 'X-Empty;'`,
      '--compressed'
    ].join(' \\\n  '))
  })
  test('POST body, other methods, HEAD', () => {
    expect(toCurl({ method: 'POST', url: 'https://e.com/', headers: [], body: `{"a":"it's"}` })).toBe(`curl 'https://e.com/' \\\n  --data-raw '{"a":"it'\\''s"}'`)
    expect(toCurl({ method: 'put', url: 'https://e.com/', headers: [], body: 'x' })).toContain(`-X 'PUT'`)
    expect(toCurl({ method: 'DELETE', url: 'https://e.com/', headers: [], body: null })).toContain(`-X 'DELETE'`)
    expect(toCurl({ method: 'HEAD', url: 'https://e.com/', headers: [], body: null })).toBe(`curl 'https://e.com/' \\\n  --head`)
    expect(toCurl({ method: 'GET', url: 'https://e.com/', headers: [], body: 'q' })).toContain(`-X 'GET'`)
  })
  const hasBash = spawnSync('bash', ['-c', 'true']).status === 0
  test.if(hasBash)('a hostile request parses back into exactly the original arguments', () => {
    const body = HOSTILE.join('|')
    const command = toCurl({ method: 'PATCH', url: `https://e.com/?q=${encodeURIComponent("'$(x)")}#frag`, headers: [{ name: 'X-Evil', value: HOSTILE.slice(0, 8).join(' ') }], body })
    // Replace curl with a function that prints its arguments NUL-separated.
    const script = `curl() { printf '%s\\0' "$@"; }\n${command}`
    const result = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    const args = result.stdout.split('\0').slice(0, -1)
    expect(args).toEqual([
      `https://e.com/?q=${encodeURIComponent("'$(x)")}#frag`,
      '-X', 'PATCH',
      '-H', `X-Evil: ${HOSTILE.slice(0, 8).join(' ')}`,
      '--data-raw', body
    ])
  })
})

describe('copy as fetch', () => {
  test('JS string escaping', () => {
    expect(jsString('a"b\\c\n')).toBe('"a\\"b\\\\c\\n"')
    expect(jsString('\u2028\u2029')).toBe('"\\u2028\\u2029"')
    expect(jsString('</script><script>')).toBe('"<\\/script><script>"')
  })
  test('shape, forbidden headers dropped, referrer kept', () => {
    const snippet = toFetch({
      method: 'post',
      url: 'https://api.example.com/x',
      headers: [
        { name: ':method', value: 'POST' }, { name: 'Content-Type', value: 'application/json' }, { name: 'Cookie', value: 'sid=1' },
        { name: 'Referer', value: 'https://example.com/page' }, { name: 'Sec-Fetch-Mode', value: 'cors' }, { name: 'User-Agent', value: 'UA' }, { name: 'X-Token', value: 't' }
      ],
      body: '{"a":1}'
    })
    expect(snippet).toBe([
      'fetch("https://api.example.com/x", {',
      '  "headers": {',
      '    "content-type": "application/json",',
      '    "x-token": "t"',
      '  },',
      '  "referrer": "https://example.com/page",',
      '  "body": "{\\"a\\":1}",',
      '  "method": "POST",',
      '  "mode": "cors",',
      '  "credentials": "include"',
      '});'
    ].join('\n'))
  })
  test('GET never carries a body; hostile values evaluate back to themselves', () => {
    expect(toFetch({ method: 'GET', url: 'https://e.com/', headers: [], body: 'ignored' })).toContain('"body": null')
    const value = HOSTILE.join('|') + '\u2028</script>'
    const snippet = toFetch({ method: 'PUT', url: 'https://e.com/', headers: [{ name: 'X-V', value }], body: value })
    const captured: Array<{ url: string; init: { headers: Record<string, string>; body: string; method: string } }> = []
    const fakeFetch = (url: string, init: { headers: Record<string, string>; body: string; method: string }): void => { captured.push({ url, init }) }
    new Function('fetch', snippet)(fakeFetch)
    expect(captured).toHaveLength(1)
    expect(captured[0]!.init.headers['x-v']).toBe(value)
    expect(captured[0]!.init.body).toBe(value)
    expect(captured[0]!.init.method).toBe('PUT')
  })
})
