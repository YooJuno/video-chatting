import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PeerSession } from './PeerSession'

class FakeChannel {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 'closed'; this.onclose?.() })

  constructor(readonly label = 'chat') {}

  open() { this.readyState = 'open'; this.onopen?.() }
  receive(data: unknown) { this.onmessage?.({ data }) }
  asChannel() { return this as unknown as RTCDataChannel }
}

class FakeConnection {
  static instances: FakeConnection[] = []
  connectionState: RTCPeerConnectionState = 'new'
  remoteDescription: RTCSessionDescriptionInit | null = null
  localDescription: { toJSON: () => RTCSessionDescriptionInit } | null = null
  onicecandidate: ((event: { candidate: { toJSON: () => RTCIceCandidateInit } | null }) => void) | null = null
  ontrack: ((event: { streams: MediaStream[]; track: MediaStreamTrack }) => void) | null = null
  ondatachannel: ((event: { channel: RTCDataChannel }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  channels: FakeChannel[] = []
  addTrack = vi.fn()
  addIceCandidate = vi.fn(async (_candidate?: RTCIceCandidateInit) => {})
  createOffer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'offer', sdp: 'offer-sdp' }))
  createAnswer = vi.fn(async (): Promise<RTCSessionDescriptionInit> => ({ type: 'answer', sdp: 'answer-sdp' }))
  setLocalDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.localDescription = { toJSON: () => description }
  })
  setRemoteDescription = vi.fn(async (description: RTCSessionDescriptionInit) => {
    this.remoteDescription = description
  })
  createDataChannel = vi.fn((label: string, _options?: RTCDataChannelInit) => {
    const channel = new FakeChannel(label)
    this.channels.push(channel)
    return channel.asChannel()
  })
  close = vi.fn()

  constructor() { FakeConnection.instances.push(this) }
  receiveChannel(channel: FakeChannel) { this.ondatachannel?.({ channel: channel.asChannel() }) }
  changeState(state: RTCPeerConnectionState) { this.connectionState = state; this.onconnectionstatechange?.() }
}

function setup() {
  const callbacks = {
    signal: vi.fn(), stream: vi.fn(), state: vi.fn(), chat: vi.fn(), message: vi.fn(), error: vi.fn(),
  }
  const track = { kind: 'video' } as MediaStreamTrack
  const stream = { getTracks: () => [track] } as unknown as MediaStream
  const session = new PeerSession('call-id', stream, {}, callbacks)
  const connection = FakeConnection.instances.at(-1)!
  return { session, connection, callbacks, stream, track }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(0)
  FakeConnection.instances = []
  vi.stubGlobal('RTCPeerConnection', FakeConnection)
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('PeerSession chat channel', () => {
  it('creates an ordered chat channel and sends an offer with the local media', async () => {
    const { session, connection, callbacks, stream, track } = setup()
    await session.start(true)
    expect(connection.addTrack).toHaveBeenCalledWith(track, stream)
    expect(connection.createDataChannel).toHaveBeenCalledWith('chat', { ordered: true })
    expect(callbacks.signal).toHaveBeenCalledWith({ description: { type: 'offer', sdp: 'offer-sdp' } })
    const channel = connection.channels[0]
    expect(session.send('before open')).toBe(false)
    channel.open()
    expect(callbacks.chat).toHaveBeenCalledWith(true)
    expect(session.send('hello')).toBe(true)
    expect(channel.send).toHaveBeenCalledWith('hello')
    channel.receive('reply')
    expect(callbacks.message).toHaveBeenCalledWith('reply')
  })

  it('keeps outgoing size and buffering limits', () => {
    const { session, connection } = setup()
    const channel = new FakeChannel()
    connection.receiveChannel(channel)
    channel.open()
    expect(session.send('a'.repeat(2000))).toBe(true)
    expect(session.send('a'.repeat(2001))).toBe(false)
    channel.bufferedAmount = 64001
    expect(session.send('buffered')).toBe(false)
    channel.bufferedAmount = 64000
    expect(session.send('allowed')).toBe(true)
    expect(channel.send).toHaveBeenCalledTimes(2)
  })

  it('rejects other labels and duplicate channels without replacing the accepted channel', () => {
    const { session, connection, callbacks } = setup()
    const invalid = new FakeChannel('other')
    const accepted = new FakeChannel()
    const duplicate = new FakeChannel()
    connection.receiveChannel(invalid)
    connection.receiveChannel(accepted)
    connection.receiveChannel(duplicate)
    expect(invalid.close).toHaveBeenCalledOnce()
    expect(duplicate.close).toHaveBeenCalledOnce()
    accepted.open()
    invalid.open()
    duplicate.open()
    invalid.receive('invalid')
    duplicate.receive('duplicate')
    accepted.receive('accepted')
    expect(callbacks.chat).toHaveBeenCalledTimes(1)
    expect(callbacks.message).toHaveBeenCalledExactlyOnceWith('accepted')
    expect(session.send('outgoing')).toBe(true)
    expect(accepted.send).toHaveBeenCalledWith('outgoing')
    expect(duplicate.send).not.toHaveBeenCalled()
  })

  it('prevents extra channels from bypassing the per-call receive limit', () => {
    const { connection, callbacks } = setup()
    const channel = new FakeChannel()
    connection.receiveChannel(channel)
    channel.open()
    for (let index = 0; index < 12; index++) channel.receive(`message-${index}`)
    const duplicate = new FakeChannel()
    connection.receiveChannel(duplicate)
    duplicate.open()
    for (let index = 0; index < 10; index++) duplicate.receive('bypass')
    expect(callbacks.message).toHaveBeenCalledTimes(10)
    expect(duplicate.close).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(1000)
    channel.receive('next window')
    expect(callbacks.message).toHaveBeenCalledTimes(11)
    expect(callbacks.message).toHaveBeenLastCalledWith('next window')
  })

  it('ignores non-string and oversized received messages without consuming the limit', () => {
    const { connection, callbacks } = setup()
    const channel = new FakeChannel()
    connection.receiveChannel(channel)
    channel.open()
    for (let index = 0; index < 12; index++) {
      channel.receive(new Uint8Array([1]))
      channel.receive('a'.repeat(2001))
    }
    for (let index = 0; index < 10; index++) channel.receive('a'.repeat(2000))
    expect(callbacks.message).toHaveBeenCalledTimes(10)
  })

  it('ignores events from a closed channel and refuses a replacement for the same call', () => {
    const { session, connection, callbacks } = setup()
    const channel = new FakeChannel()
    connection.receiveChannel(channel)
    channel.open()
    const lateOpen = channel.onopen!
    const lateClose = channel.onclose!
    const lateMessage = channel.onmessage!
    channel.close()
    const replacement = new FakeChannel()
    connection.receiveChannel(replacement)
    replacement.open()
    lateOpen()
    lateClose()
    lateMessage({ data: 'late message' })
    expect(callbacks.chat.mock.calls).toEqual([[true], [false]])
    expect(callbacks.message).not.toHaveBeenCalled()
    expect(replacement.close).toHaveBeenCalledOnce()
    expect(session.send('closed')).toBe(false)
  })

  it('ignores queued channel events after the session closes and clears connection timers', () => {
    const { session, connection, callbacks } = setup()
    const channel = new FakeChannel()
    connection.receiveChannel(channel)
    channel.open()
    connection.changeState('disconnected')
    const lateOpen = channel.onopen!
    const lateClose = channel.onclose!
    const lateMessage = channel.onmessage!
    const lateChannel = connection.ondatachannel!
    session.close()
    lateOpen()
    lateClose()
    lateMessage({ data: 'late' })
    const rejected = new FakeChannel()
    lateChannel({ channel: rejected.asChannel() })
    vi.advanceTimersByTime(30000)
    expect(callbacks.chat).toHaveBeenCalledExactlyOnceWith(true)
    expect(callbacks.message).not.toHaveBeenCalled()
    expect(callbacks.error).not.toHaveBeenCalled()
    expect(rejected.close).toHaveBeenCalledOnce()
    expect(connection.close).toHaveBeenCalledOnce()
    expect(connection.ondatachannel).toBeNull()
    expect(channel.onmessage).toBeNull()
    expect(session.send('late send')).toBe(false)
  })
})

describe('PeerSession signaling and connection lifecycle', () => {
  it('buffers ICE until the remote description and preserves the end-of-candidates marker', async () => {
    const { session, connection, callbacks } = setup()
    const candidate = { candidate: 'candidate-one', sdpMid: '0' }
    await session.receive(undefined, candidate)
    await session.receive(undefined, null)
    expect(connection.addIceCandidate).not.toHaveBeenCalled()
    const description: RTCSessionDescriptionInit = { type: 'offer', sdp: 'remote-offer' }
    await session.receive(description)
    expect(connection.setRemoteDescription).toHaveBeenCalledWith(description)
    expect(connection.addIceCandidate.mock.calls).toEqual([[candidate], [undefined]])
    expect(callbacks.signal).toHaveBeenCalledWith({ description: { type: 'answer', sdp: 'answer-sdp' } })
    await session.receive(undefined, { candidate: 'candidate-two' })
    expect(connection.addIceCandidate).toHaveBeenLastCalledWith({ candidate: 'candidate-two' })
    session.close()
    await session.receive(undefined, candidate)
    expect(connection.addIceCandidate).toHaveBeenCalledTimes(3)
  })

  it('does not create an answer when the session closes while applying an offer', async () => {
    const { session, connection, callbacks } = setup()
    let finish!: () => void
    connection.setRemoteDescription.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    const applying = session.receive({ type: 'offer', sdp: 'remote-offer' })
    session.close()
    finish()
    await applying
    expect(connection.createAnswer).not.toHaveBeenCalled()
    expect(callbacks.signal).not.toHaveBeenCalled()
  })

  it('ends an initial connection after 30 seconds and a disconnected connection after 10 seconds', () => {
    const initial = setup()
    vi.advanceTimersByTime(29999)
    expect(initial.callbacks.error).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(initial.callbacks.error).toHaveBeenCalledOnce()
    initial.session.close()

    const connected = setup()
    connected.connection.changeState('connected')
    connected.connection.changeState('disconnected')
    expect(connected.callbacks.state.mock.calls).toEqual([['connected'], ['reconnecting']])
    vi.advanceTimersByTime(9999)
    expect(connected.callbacks.error).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(connected.callbacks.error).toHaveBeenCalledOnce()
    connected.session.close()
  })

  it('cancels both connection timers when a peer recovers', () => {
    const { connection, callbacks } = setup()
    connection.changeState('connected')
    connection.changeState('disconnected')
    vi.advanceTimersByTime(5000)
    connection.changeState('connected')
    vi.advanceTimersByTime(30000)
    expect(callbacks.error).not.toHaveBeenCalled()
    expect(callbacks.state.mock.calls).toEqual([['connected'], ['reconnecting'], ['connected']])
  })
})
