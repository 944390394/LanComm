import { readFileSync } from 'fs'
import { join } from 'path'
import { WebSocket } from 'ws'

const configPath = join(process.env.APPDATA, 'lop2p', 'lop2p-config.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
const HTTP = config.httpPort
const WS = config.wsPort

console.log(`dev instance: http=${HTTP} ws=${WS}\n`)

let failures = 0
function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ' :: ' + detail : ''}`)
  if (!passed) failures += 1
}

function wsAttempt(label, { origin, headers, expectOpen }) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${WS}`, { origin, headers })
    const timer = setTimeout(() => {
      check(label, !expectOpen, 'timed out')
      ws.close()
      resolve()
    }, 4000)

    ws.on('open', () => {
      clearTimeout(timer)
      check(label, expectOpen === true, 'connection opened')
      ws.close()
      resolve()
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      check(label, expectOpen === false, err.message)
      resolve()
    })
  })
}

for (const [label, port] of [
  ['transfer /identity', HTTP],
  ['hub /identity', WS]
]) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/identity`)
    const body = await res.json()
    check(label, res.ok && body.type === 'identity', `name=${body.name}`)
  } catch (err) {
    check(label, false, String(err))
  }
}

try {
  const res = await fetch(`http://127.0.0.1:${HTTP}/identity`)
  const acao = res.headers.get('access-control-allow-origin')
  check('CORS wildcard removed', acao === null, `ACAO=${acao}`)
} catch (err) {
  check('CORS wildcard removed', false, String(err))
}

try {
  const res = await fetch(`http://127.0.0.1:${HTTP}/transfer/does-not-exist`, {
    method: 'POST',
    body: 'x'
  })
  check('unknown transfer id rejected', res.status === 404, `status=${res.status}`)
} catch (err) {
  check('unknown transfer id rejected', false, String(err))
}

await wsAttempt('WS from browser Origin refused', {
  origin: 'http://evil.example.com',
  headers: { 'x-lancomm-protocol': '1' },
  expectOpen: false
})
await wsAttempt('WS without protocol header refused', { headers: {}, expectOpen: false })
await wsAttempt('WS with protocol header accepted', {
  headers: { 'x-lancomm-protocol': '1' },
  expectOpen: true
})

// Malformed payloads from an unauthenticated peer must not take the app down.
await new Promise((resolve) => {
  const ws = new WebSocket(`ws://127.0.0.1:${WS}`, {
    headers: { 'x-lancomm-protocol': '1' }
  })
  const junk = [
    'not json at all',
    '{}',
    '{"type":"hello"}',
    '{"type":"hello","id":{}}',
    '{"type":"chat.text","id":1,"text":null}',
    '{"type":"transfer.offer","transferId":"x","fileName":123,"fileSize":"huge"}',
    '{"type":"transfer.offer","transferId":"y","fileName":"../../evil.exe","fileSize":-1}',
    '{"type":"transfer.progress","transferId":"z","transferred":"NaN"}'
  ]

  ws.on('open', () => {
    junk.forEach((payload) => ws.send(payload))
    setTimeout(async () => {
      ws.close()
      try {
        const res = await fetch(`http://127.0.0.1:${WS}/identity`)
        check('畸形报文后服务仍存活', res.ok)
      } catch (err) {
        check('畸形报文后服务仍存活', false, String(err))
      }
      resolve()
    }, 1500)
  })
  ws.on('error', (err) => {
    check('畸形报文后服务仍存活', false, err.message)
    resolve()
  })
})

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
