// .cjs: the repo root package.json is "type": "module", and this is a dependency-free CommonJS script.
// Minimal artifact v4 uploader (CreateArtifact -> PUT blob -> FinalizeArtifact), no dependencies.
// Same wire protocol as @actions/artifact. Single file, stored in a zip (artifacts download as zips).
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const input = (n) => (process.env[`INPUT_${n.replace(/ /g, '_').toUpperCase()}`] || '').trim()
const setOutput = (k, v) => fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`)
const fail = (m) => { console.log(`::error::${m}`); process.exit(1) }

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 }
  return t
})()
function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

// zip with one stored entry
function zipOne(name, data) {
  const nameBuf = Buffer.from(name, 'utf8')
  const crc = crc32(data)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8)
  local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(crc, 14)
  local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28)
  const central = Buffer.alloc(46)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8)
  central.writeUInt16LE(0, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(crc, 16)
  central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28)
  central.writeUInt32LE((0o100644 * 65536) >>> 0, 38); central.writeUInt32LE(0, 42)
  const centralOffset = local.length + nameBuf.length + data.length
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10)
  end.writeUInt32LE(central.length + nameBuf.length, 12); end.writeUInt32LE(centralOffset, 16)
  return Buffer.concat([local, nameBuf, data, central, nameBuf, end])
}

async function twirp(method, body, token, base) {
  const url = `${base.replace(/\/$/, '')}/twirp/github.actions.results.api.v1.ArtifactService/${method}`
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': 'surffish-upload-artifact' }, body: JSON.stringify(body) })
    const text = await res.text()
    if (res.ok) return JSON.parse(text)
    console.log(`${method} attempt ${attempt}: HTTP ${res.status} ${text.slice(0, 300)}`)
    if (res.status < 500 && res.status !== 429) break
    await new Promise((r) => setTimeout(r, attempt * 3000))
  }
  fail(`${method} failed`)
}

async function main() {
  const name = input('name')
  const file = input('path')
  const token = process.env.ACTIONS_RUNTIME_TOKEN
  const base = process.env.ACTIONS_RESULTS_URL
  if (!token || !base) fail('ACTIONS_RUNTIME_TOKEN / ACTIONS_RESULTS_URL missing (must run as an action)')
  if (!fs.existsSync(file)) fail(`no such file: ${file}`)

  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'))
  const scope = String(claims.scp || '').split(' ').find((s) => s.startsWith('Actions.Results:'))
  if (!scope) fail('runtime token has no Actions.Results scope')
  const [, workflowRunBackendId, workflowJobRunBackendId] = scope.split(':')

  const zip = zipOne(path.basename(file), fs.readFileSync(file))
  const hash = crypto.createHash('sha256').update(zip).digest('hex')
  console.log(`zipped ${path.basename(file)}: ${zip.length} bytes, sha256 ${hash}`)

  const created = await twirp('CreateArtifact', { workflowRunBackendId, workflowJobRunBackendId, name, version: 4 }, token, base)
  if (!created.ok || !created.signedUploadUrl) fail(`CreateArtifact: ${JSON.stringify(created)}`)

  let uploaded = false
  for (let attempt = 1; attempt <= 3 && !uploaded; attempt++) {
    const put = await fetch(created.signedUploadUrl, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'x-ms-version': '2023-11-03', 'Content-Type': 'application/zip', 'Content-Length': String(zip.length) },
      body: zip
    })
    if (put.ok) uploaded = true
    else console.log(`blob PUT attempt ${attempt}: HTTP ${put.status} ${(await put.text()).slice(0, 300)}`)
  }
  if (!uploaded) fail('blob upload failed')

  const fin = await twirp('FinalizeArtifact', { workflowRunBackendId, workflowJobRunBackendId, name, size: String(zip.length), hash: `sha256:${hash}` }, token, base)
  if (!fin.ok) fail(`FinalizeArtifact: ${JSON.stringify(fin)}`)
  const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${fin.artifactId}`
  console.log(`artifact ${name} (#${fin.artifactId}): ${url}`)
  setOutput('artifact-id', fin.artifactId)
  setOutput('artifact-url', url)
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
