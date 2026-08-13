import type { ReactElement } from 'react'
import type { IncomingTransferRequest } from '../../shared/types'
import { formatBytes } from '../utils'

interface Props {
  requests: IncomingTransferRequest[]
  onRespond: (requestId: string, accept: boolean, trust: boolean) => void
}

export default function IncomingRequests({ requests, onRespond }: Props): ReactElement | null {
  if (!requests.length) return null

  return (
    <div className="absolute inset-x-0 top-0 z-30 space-y-2 px-5 pt-4">
      {requests.map((request) => (
        <div
          key={request.requestId}
          className="animate-rise rounded-2xl border border-mint-500/40 bg-ink-900/95 px-4 py-3 shadow-lg"
        >
          <div className="text-sm text-ink-100">
            <span className="font-medium text-mint-400">{request.peerName}</span> 想发送文件
          </div>
          <div className="mt-1 truncate text-xs text-ink-500">
            {request.fileName} · {formatBytes(request.fileSize)}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded-lg bg-mint-500 px-3 py-1.5 text-xs font-semibold text-ink-950 hover:bg-mint-400"
              onClick={() => onRespond(request.requestId, true, false)}
            >
              接收
            </button>
            <button
              type="button"
              className="rounded-lg border border-mint-500/40 px-3 py-1.5 text-xs text-mint-400 hover:bg-mint-600/10"
              onClick={() => onRespond(request.requestId, true, true)}
            >
              接收并信任此设备
            </button>
            <button
              type="button"
              className="rounded-lg border border-ink-700 px-3 py-1.5 text-xs text-ink-300 hover:border-red-400/40 hover:text-red-300"
              onClick={() => onRespond(request.requestId, false, false)}
            >
              拒绝
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}
