import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignalingSocket } from './SignalingSocket'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 2 })

  constructor(readonly url: string) { FakeWebSocket.instances.push(this) }
  receive(message: unknown) {
    this.readyState = FakeWebSocket.OPEN
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
  finishClose() { this.readyState = 3; this.onclose?.() }
}

describe('SignalingSocket', () => {
  let signaling: SignalingSocket
  const receive = vi.fn()
  const disconnected = vi.fn()

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    signaling = new SignalingSocket(receive, disconnected)
  })
  afterEach(() => { signaling.close(); vi.useRealTimers() })

  it('shares an opening connection and waits for welcome before sending', async () => {
    const opening = signaling.open()
    expect(signaling.open()).toBe(opening)
    expect(FakeWebSocket.instances).toHaveLength(1)
    expect(() => signaling.send({ type: 'queue:join' })).toThrow('서버 연결이 끊겼습니다.')
    const socket = FakeWebSocket.instances[0]!
    socket.receive({ type: 'welcome', id: 'client' })
    await opening
    signaling.send({ type: 'queue:join', attemptId: 'attempt' })
    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ type: 'queue:join', attemptId: 'attempt' }))
    expect(receive).toHaveBeenCalledWith({ type: 'welcome', id: 'client' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels an opening connection and its timeout on explicit close', async () => {
    const opening = signaling.open()
    const rejected = expect(opening).rejects.toThrow('서버 연결이 종료되었습니다.')
    const socket = FakeWebSocket.instances[0]!
    signaling.close()
    await rejected
    expect(socket.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    socket.finishClose()
    expect(disconnected).not.toHaveBeenCalled()
  })

  it('ignores old messages and close events after a replacement connection opens', async () => {
    const first = signaling.open()
    const firstSocket = FakeWebSocket.instances[0]!
    firstSocket.receive({ type: 'welcome', id: 'first' })
    await first
    signaling.close()
    receive.mockClear()
    const second = signaling.open()
    const secondSocket = FakeWebSocket.instances[1]!
    firstSocket.receive({ type: 'stats', online: 999, waiting: 0 })
    firstSocket.finishClose()
    secondSocket.receive({ type: 'welcome', id: 'second' })
    await second
    expect(receive).toHaveBeenCalledTimes(1)
    expect(disconnected).not.toHaveBeenCalled()
    expect(() => signaling.send({ type: 'call:leave' })).not.toThrow()
  })

  it('rejects a missing welcome after ten seconds', async () => {
    const opening = signaling.open()
    const rejected = expect(opening).rejects.toThrow('서버 연결 시간이 초과되었습니다.')
    await vi.advanceTimersByTimeAsync(10000)
    await rejected
    const socket = FakeWebSocket.instances[0]!
    expect(socket.close).toHaveBeenCalledOnce()
    socket.finishClose()
    expect(disconnected).toHaveBeenCalledOnce()
  })

  it('can reconnect after a server-side close', async () => {
    const opening = signaling.open()
    FakeWebSocket.instances[0]!.receive({ type: 'welcome', id: 'first' })
    await opening
    FakeWebSocket.instances[0]!.finishClose()
    expect(disconnected).toHaveBeenCalledOnce()
    const retry = signaling.open()
    expect(FakeWebSocket.instances).toHaveLength(2)
    FakeWebSocket.instances[1]!.receive({ type: 'welcome', id: 'second' })
    await retry
    expect(() => signaling.send({ type: 'call:leave' })).not.toThrow()
  })
})
