import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ChatClient } from './ChatClient'

class FakeWebSocket {
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = 0
  onmessage: ((event: MessageEvent) => void) | null = null
  onerror: (() => void) | null = null
  onclose: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3 })
  constructor() { FakeWebSocket.instances.push(this) }
  receive(message: unknown) {
    this.readyState = FakeWebSocket.OPEN
    this.onmessage?.(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
  disconnect() { this.readyState = 3; this.onclose?.() }
}

function mediaStream() {
  const tracks = ['audio', 'video'].map(kind => Object.assign(new EventTarget(), { kind, enabled: true, stop: vi.fn() }))
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks }
}

describe('ChatClient lifecycle', () => {
  let client: ChatClient
  const getUserMedia = vi.fn<() => Promise<MediaStream>>()
  const fetchConfig = vi.fn()

  beforeEach(() => {
    FakeWebSocket.instances = []
    getUserMedia.mockReset()
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
    vi.stubGlobal('fetch', fetchConfig)
    fetchConfig.mockResolvedValue({ ok: true, json: async () => ({ iceServers: [], relayOnly: false }) })
    client = new ChatClient()
  })
  afterEach(() => { client.dispose() })

  async function connect() {
    const connecting = client.connect()
    const socket = FakeWebSocket.instances.at(-1)!
    socket.receive({ type: 'welcome', id: 'client' })
    await connecting
    return socket
  }

  it('never requests media without consent', async () => {
    await client.start('queue:join', false)
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(fetchConfig).not.toHaveBeenCalled()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(client.snapshot()).toMatchObject({ status: 'idle', error: true })
  })

  it('stops media and clears the online state when the page is disposed', async () => {
    const socket = await connect()
    socket.receive({ type: 'stats', online: 4, waiting: 0 })
    const { stream, tracks } = mediaStream()
    getUserMedia.mockResolvedValue(stream)
    await client.start('queue:join', true)
    client.dispose()
    expect(client.snapshot()).toMatchObject({ status: 'idle', serverOnline: false, online: 0, localStream: null })
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(socket.close).toHaveBeenCalledOnce()
  })

  it('reopens signaling after disposal without reacquiring media', async () => {
    const oldSocket = await connect()
    client.dispose()
    const restored = client.connect()
    oldSocket.receive({ type: 'welcome', id: 'stale' })
    expect(client.snapshot().serverOnline).toBe(false)
    const newSocket = FakeWebSocket.instances[1]!
    newSocket.receive({ type: 'welcome', id: 'restored' })
    await restored
    expect(client.snapshot()).toMatchObject({ serverOnline: true, status: 'idle', localStream: null })
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('stops a late permission result after cancellation and ignores old waiting events', async () => {
    const socket = await connect()
    let grant!: (stream: MediaStream) => void
    getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve }))
    const starting = client.start('queue:join', true)
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    client.leave()
    const { stream, tracks } = mediaStream()
    grant(stream)
    await starting
    socket.receive({ type: 'waiting', attemptId: 'cancelled-attempt' })
    expect(client.snapshot()).toMatchObject({ status: 'idle', localStream: null })
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    const sent = socket.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string })
    expect(sent.some(message => message.type === 'queue:join')).toBe(false)
  })

  it('releases devices when the server disconnects while waiting', async () => {
    const socket = await connect()
    const { stream, tracks } = mediaStream()
    getUserMedia.mockResolvedValue(stream)
    await client.start('queue:join', true)
    const join = JSON.parse(socket.send.mock.calls[0]![0] as string) as { attemptId: string }
    socket.receive({ type: 'waiting', attemptId: join.attemptId })
    expect(client.snapshot().status).toBe('waiting')
    socket.disconnect()
    expect(client.snapshot()).toMatchObject({ status: 'idle', serverOnline: false, localStream: null, error: true })
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
  })

  it('discards delayed configuration after disposal and releases the already prepared devices', async () => {
    await connect()
    const { stream, tracks } = mediaStream()
    getUserMedia.mockResolvedValue(stream)
    let resolveConfiguration!: (configuration: unknown) => void
    const json = vi.fn(() => new Promise(resolve => { resolveConfiguration = resolve }))
    fetchConfig.mockResolvedValue({ ok: true, json })
    const starting = client.start('queue:join', true)
    await vi.waitFor(() => expect(json).toHaveBeenCalledOnce())
    client.dispose()
    await connect()
    resolveConfiguration({ iceServers: [], relayOnly: false })
    await starting
    expect(getUserMedia).toHaveBeenCalledOnce()
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(client.snapshot()).toMatchObject({ status: 'idle', serverOnline: true, localStream: null })
  })

  it('requests device permission immediately before waiting for a server connection', async () => {
    let grant!: (stream: MediaStream) => void
    getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve }))
    const starting = client.start('queue:join', true)
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(client.snapshot().preparationStep).toBe('permissions')
    const { stream } = mediaStream()
    grant(stream)
    await vi.waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1))
    expect(client.snapshot().preparationStep).toBe('server')
    FakeWebSocket.instances[0]!.receive({ type: 'welcome', id: 'client' })
    await starting
    expect(fetchConfig).toHaveBeenCalledOnce()
  })

  it('reports a denied permission without attempting server configuration', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    await client.start('queue:join', true)
    expect(client.snapshot()).toMatchObject({ status: 'idle', error: true, media: { phase: 'error', issue: { code: 'permission' } } })
    expect(FakeWebSocket.instances).toHaveLength(0)
    expect(fetchConfig).not.toHaveBeenCalled()
  })

  it('explains a server configuration failure separately and releases the prepared devices', async () => {
    await connect()
    const { stream, tracks } = mediaStream()
    getUserMedia.mockResolvedValue(stream)
    fetchConfig.mockRejectedValue(new TypeError('Failed to fetch'))
    await client.start('queue:join', true)
    expect(client.snapshot()).toMatchObject({ status: 'idle', localStream: null, error: true, media: { issue: null } })
    expect(client.snapshot().notice).toContain('장치는 준비했지만 대화 서버')
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
  })

  it('a cancelled device request cannot stop devices acquired by a later start', async () => {
    const oldSocket = await connect()
    let grantOldPermission!: (stream: MediaStream) => void
    getUserMedia.mockReturnValueOnce(new Promise(resolve => { grantOldPermission = resolve }))
    const oldStart = client.start('queue:join', true)
    await vi.waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce())
    client.dispose()
    await connect()
    const current = mediaStream()
    getUserMedia.mockResolvedValue(current.stream)
    await client.start('queue:join', true)
    const previous = mediaStream()
    grantOldPermission(previous.stream)
    await oldStart
    expect(client.snapshot().localStream).toBe(current.stream)
    previous.tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    current.tracks.forEach(track => expect(track.stop).not.toHaveBeenCalled())
    const sent = oldSocket.send.mock.calls.map(([payload]) => JSON.parse(payload as string) as { type: string })
    expect(sent.some(message => message.type === 'queue:join')).toBe(false)
  })
})
