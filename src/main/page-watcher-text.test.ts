import assert from 'node:assert/strict'
import test from 'node:test'
import { extractWatchText, isSupportedWatchSelector } from './page-watcher-text.ts'

const PAGE = `<!doctype html><html><head><title>Shop</title><style>.x{color:red}</style><script>var tracking = 1</script></head>
<body>
  <header><nav><a href="/">Home</a> <a href="/deals">Deals</a></nav></header>
  <div id="content">
    <h1>Kettle &amp; stand</h1>
    <p class="price">Price: <b>$49</b></p>
    <ul class="stock"><li>Melbourne: 3 left</li><li>Sydney: sold out</li></ul>
    <noscript>Enable JavaScript</noscript>
    <template><p>hidden template</p></template>
  </div>
  <footer>© 2026 Shop</footer>
</body></html>`

test('whole page: body text without scripts, styles or page chrome', () => {
  const result = extractWatchText(PAGE, null)
  assert.deepEqual(result, { ok: true, lines: ['Kettle & stand', 'Price: $49', 'Melbourne: 3 left', 'Sydney: sold out'] })
})

test('whole page: prefers <main> (or a single <article>) when there is one', () => {
  const html = '<body><nav>Menu</nav><main><p>Main one</p><p>Main two</p></main><aside>Ad</aside></body>'
  assert.deepEqual(extractWatchText(html, null), { ok: true, lines: ['Main one', 'Main two'] })
  assert.deepEqual(extractWatchText('<body><div>Top</div><article><p>Story</p></article></body>', null), { ok: true, lines: ['Story'] })
})

test('selector: the picker\'s selectors work on fetched HTML', () => {
  assert.deepEqual(extractWatchText(PAGE, '#content > p.price'), { ok: true, lines: ['Price: $49'] })
  assert.deepEqual(extractWatchText(PAGE, 'body > div:nth-of-type(1) > ul.stock > li:nth-of-type(2)'), { ok: true, lines: ['Sydney: sold out'] })
})

test('selector: missing element and unsupported selectors are reported', () => {
  const missing = extractWatchText(PAGE, '#reviews')
  assert.equal(missing.ok, false)
  assert.match(missing.ok ? '' : missing.error, /Render JavaScript/)
  assert.equal(extractWatchText(PAGE, 'a[').ok, false)
  assert.equal(isSupportedWatchSelector('main > .price:nth-of-type(2)'), true)
  assert.equal(isSupportedWatchSelector('a['), false)
})
