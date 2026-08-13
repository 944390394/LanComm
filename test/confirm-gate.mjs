import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'

const config = JSON.parse(
  readFileSync(join(process.env.APPDATA, 'lop2p', 'lop2p-config.json'), 'utf8')
)

const ws = new WebSocket(`ws://127.0.0.1:${config.wsPort}`, {
  headers: { 'x-lancomm-protocol': '1' }
})
const transferId = randomUUID()
let responded = null

ws.on('open', () => {
  ws.send(
    JSON.stringify({ type: 'hello', id: randomUUID(), name: '陌生设备', hostname: 'stranger' })
  )
  ws.send(
    JSON.stringify({
      type: 'transfer.offer',
      transferId,
      fileName: '未经允许的文件.exe',
      fileSize: 1024,
      mimeType: 'application/octet-stream',
      kind: 'file',
      createdAt: Date.now()
    })
  )
})

ws.on('message', (raw) => {
  const msg = JSON.parse(raw.toString('utf8'))
  if (msg.transferId === transferId) responded = msg.type
})

setTimeout(async () => {
  const held = responded === null
  console.log(
    `${held ? 'PASS' : 'FAIL'}  陌生设备的文件被挂起等待确认 :: ${responded || '无自动回应'}`
  )

  // Without an accepted slot the upload endpoint must refuse the data outright.
  const res = await fetch(`http://127.0.0.1:${config.httpPort}/transfer/${transferId}`, {
    method: 'POST',
    body: 'malicious'
  })
  const blocked = res.status === 404
  console.log(`${blocked ? 'PASS' : 'FAIL'}  未确认前无法上传数据 :: status=${res.status}`)

  ws.close()
  process.exitCode = held && blocked ? 0 : 1
}, 3000)
