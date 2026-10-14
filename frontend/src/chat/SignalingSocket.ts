import type { ServerMessage } from './types'

export class SignalingSocket {
  private socket: WebSocket | null = null
  private pending: Promise<void> | null = null
  private welcomed = false

  constructor(private readonly receive: (message: ServerMessage) => void, private readonly disconnected: () => void) {}

  open(): Promise<void> {
    if (this.welcomed && this.socket?.readyState === WebSocket.OPEN) return Promise.resolve()
    if (this.pending) return this.pending
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`)
    this.socket = socket
    this.pending = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(new Error('서버 연결 시간이 초과되었습니다.')) }, 10000)
      socket.onmessage = event => {
        if (this.socket !== socket) return
        let message: ServerMessage
        try { message = JSON.parse(event.data) as ServerMessage } catch { return }
        if (message.type === 'welcome') {
          clearTimeout(timer)
          this.welcomed = true
          resolve()
        }
        this.receive(message)
      }
      socket.onerror = () => { clearTimeout(timer); reject(new Error('서버에 연결할 수 없습니다.')) }
      socket.onclose = () => {
        clearTimeout(timer)
        reject(new Error('서버 연결이 종료되었습니다.'))
        if (this.socket !== socket) return
        this.socket = null
        this.pending = null
        this.welcomed = false
        this.disconnected()
      }
    })
    return this.pending
  }

  send(message: Record<string, unknown>) {
    if (!this.welcomed || this.socket?.readyState !== WebSocket.OPEN) throw new Error('서버 연결이 끊겼습니다. 다시 시작해주세요.')
    this.socket.send(JSON.stringify(message))
  }

  close() {
    const socket = this.socket
    this.socket = null
    this.pending = null
    this.welcomed = false
    socket?.close()
  }
}
