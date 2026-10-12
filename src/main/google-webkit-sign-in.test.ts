import assert from 'node:assert/strict'
import test from 'node:test'
import { isGoogleSignInPage, parseHelperOutput, signInContinueUrl, toElectronCookie } from './google-webkit-sign-in-policy.ts'

test('detects Google sign-in pages only', () => {
  for (const url of [
    'https://accounts.google.com/v3/signin/identifier?continue=x',
    'https://accounts.google.com/v3/signin/rejected?x=1',
    'https://accounts.google.com/ServiceLogin?service=mail',
    'https://accounts.google.com/signin/v2/identifier',
    'https://accounts.google.com/AccountChooser'
  ]) assert.equal(isGoogleSignInPage(url), true, url)
  for (const url of [
    'https://accounts.google.com/v3/signin/_/AccountsSignInUi/data/batchexecute',
    'https://accounts.google.com/signin/oauth/consent?x',
    'https://accounts.google.com/o/oauth2/v2/auth?client_id=x',
    'https://accounts.google.com/SignOutOptions',
    'https://myaccount.google.com/',
    'https://accounts.google.com.evil.example/ServiceLogin',
    'http://accounts.google.com/ServiceLogin',
    'garbage'
  ]) assert.equal(isGoogleSignInPage(url), false, url)
})

test('continues to the requested page, never back into sign-in', () => {
  assert.equal(signInContinueUrl('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fmail.google.com%2Fmail%2F'), 'https://mail.google.com/mail/')
  assert.equal(signInContinueUrl('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Faccounts.google.com%2FServiceLogin'), 'https://www.google.com/')
  assert.equal(signInContinueUrl('https://accounts.google.com/ServiceLogin?continue=javascript%3Aalert(1)'), 'https://www.google.com/')
  assert.equal(signInContinueUrl('https://accounts.google.com/ServiceLogin'), 'https://www.google.com/')
})

test('maps WebKit cookies to Electron cookie details', () => {
  assert.deepEqual(toElectronCookie({ name: 'SID', value: 'v', domain: '.google.com', path: '/', secure: true, httpOnly: false, expirationDate: 2000000000 }), {
    url: 'https://google.com/', name: 'SID', value: 'v', path: '/', secure: true, httpOnly: false, sameSite: 'no_restriction', domain: '.google.com', expirationDate: 2000000000
  })
  assert.deepEqual(toElectronCookie({ name: '__Host-GAPS', value: 'v', domain: 'accounts.google.com', path: '/', secure: true, httpOnly: true, sameSite: 'lax' }), {
    url: 'https://accounts.google.com/', name: '__Host-GAPS', value: 'v', path: '/', secure: true, httpOnly: true, sameSite: 'lax'
  })
  assert.equal(toElectronCookie({ name: 'x', value: 'y', domain: '.evil.example' }), null)
  assert.equal(toElectronCookie({ name: 'x', value: 'y', domain: '.notgoogle.com' }), null)
})

test('parses the helper JSON line', () => {
  assert.deepEqual(parseHelperOutput('noise\n[{"name":"SID","value":"v","domain":".google.com"}]\n'), [{ name: 'SID', value: 'v', domain: '.google.com' }])
  assert.throws(() => parseHelperOutput('{}'))
})
