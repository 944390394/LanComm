import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'fs'
import { createReadStream } from 'fs'
import { Readable } from 'stream'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { WebSocket } from 'ws'

const config = JSON.parse(
  readFileSync(join(process.env.APPDATA, 'lop2p', 'lop2p-config.json'), 'utf8')
)
const { httpPort, wsPort, downloadDir } = config

// A 6 MB payload exercises the streaming path rather than a single buffer.
const sourceDir = join(process.env.TEMP, 'lancomm-e2e')
mkdirSync(sourceDir, { recursive: true })
const sourcePath = join(sourceDir, '端到端测试 文件.bin')
const payload = Buffer.alloc(6 * 1024 * 1024)
for (let i = 0; i < payload.length; i += 4096) payload[i] = i % 251
writeFileSync(sourcePath, payload)

const transferId = randomUUID()
const peerId = randomUUID()
const fileName = '端到端测试 文件.bin'

const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
  headers: { 'x-lancomm-protocol': '1' }
})

const done = new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('等待 transfer.accept 超时')), 15000)

  ws.on('open', () => {
    ws.send(
      JSON.stringify({ type: 'hello', id: peerId, name: '测试发送端', hostname: 'e2e-host' })
    )
    ws.send(
      JSON.stringify({
        type: 'transfer.offer',
        transferId,
        fileName,
        fileSize: payload.length,
        mimeType: 'application/octet-stream',
        kind: 'file',
        createdAt: Date.now()
      })
    )
  })

  ws.on('message', async (raw) => {
    const msg = JSON.parse(raw.toString('utf8'))
    if (msg.type === 'transfer.reject' && msg.transferId === transferId) {
      clearTimeout(timer)
      reject(new Error(`对端拒绝：${msg.reason || '未知原因'}`))
      return
    }
    if (msg.type !== 'transfer.accept' || msg.transferId !== transferId) return

    clearTimeout(timer)
    try {
      const started = Date.now()
      const res = await fetch(`http://127.0.0.1:${httpPort}/transfer/${transferId}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream',
          'x-lancomm-total': String(payload.length)
        },
        body: Readable.toWeb(createReadStream(sourcePath, { highWaterMark: 512 * 1024 })),
        duplex: 'half'
      })
      if (!res.ok) throw new Error(`上传失败 HTTP ${res.status}: ${await res.text()}`)

      ws.send(JSON.stringify({ type: 'transfer.done', transferId, ok: true }))
      resolve(Date.now() - started)
    } catch (err) {
      reject(err)
    }
  })

  ws.on('error', reject)
})

try {
  const elapsed = await done
  const target = join(downloadDir, fileName)

  if (!existsSync(target)) throw new Error(`未在下载目录找到文件：${target}`)
  const written = readFileSync(target)

  const sizeOk = statSync(target).size === payload.length
  const contentOk = written.equals(payload)
  const speed = (payload.length / 1024 / 1024 / (elapsed / 1000)).toFixed(1)

  console.log(`PASS  文件已落盘 :: ${target}`)
  console.log(`${sizeOk ? 'PASS' : 'FAIL'}  大小一致 :: ${written.length} / ${payload.length}`)
  console.log(`${contentOk ? 'PASS' : 'FAIL'}  内容逐字节一致`)
  console.log(`INFO  6 MB 耗时 ${elapsed} ms（约 ${speed} MB/s）`)

  process.exitCode = sizeOk && contentOk ? 0 : 1
} catch (err) {
  console.log(`FAIL  ${err.message}`)
  process.exitCode = 1
} finally {
  ws.close()
}
