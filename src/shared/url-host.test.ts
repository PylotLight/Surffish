import { expect, test } from 'bun:test'
import { displayHost, urlHostname } from './url-host'

test('urlHostname returns the lower-case hostname or an empty string', () => {
  expect(urlHostname('https://Example.COM:8443/path?q=1')).toBe('example.com')
  expect(urlHostname('http://[::1]:3000/')).toBe('[::1]')
  expect(urlHostname('about:blank')).toBe('')
  expect(urlHostname('not a url')).toBe('')
  expect(urlHostname(null)).toBe('')
  expect(urlHostname(undefined)).toBe('')
  expect(urlHostname('')).toBe('')
})

test('displayHost drops a leading www. and falls back to the input', () => {
  expect(displayHost('https://www.Example.com/a')).toBe('example.com')
  expect(displayHost('https://news.example.com/')).toBe('news.example.com')
  expect(displayHost('https://wwwexample.com/')).toBe('wwwexample.com')
  expect(displayHost('about:blank')).toBe('')
  expect(displayHost('plain text')).toBe('plain text')
})
