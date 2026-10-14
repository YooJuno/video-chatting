interface Callbacks {
  signal: (message: Record<string, unknown>) => void
  stream: (stream: MediaStream) => void
  state: (state: 'connected' | 'reconnecting') => void
  chat: (ready: boolean) => void
  message: (text: string) => void
  error: (message: string) => void
}

export class PeerSession {
  private readonly connection: RTCPeerConnection
  private channel: RTCDataChannel | null = null
  private candidates: (RTCIceCandidateInit | null)[] = []
  private connectionTimer: ReturnType<typeof setTimeout>
  private disconnectTimer?: ReturnType<typeof setTimeout>
  private closed = false
  private messageWindowStart = Date.now()
  private messageCount = 0

  constructor(readonly id: string, stream: MediaStream, configuration: RTCConfiguration, private readonly callbacks: Callbacks) {
    this.connection = new RTCPeerConnection(configuration)
    stream.getTracks().forEach(track => this.connection.addTrack(track, stream))
    this.connection.onicecandidate = event => {
      if (!this.closed) callbacks.signal({ candidate: event.candidate?.toJSON() || null })
    }
    this.connection.ontrack = event => {
      if (!this.closed) callbacks.stream(event.streams[0] || new MediaStream([event.track]))
    }
    this.connection.ondatachannel = event => this.attachChannel(event.channel)
    this.connection.onconnectionstatechange = () => {
      if (this.closed) return
      const state = this.connection.connectionState
      if (state === 'connected') {
        clearTimeout(this.connectionTimer)
        clearTimeout(this.disconnectTimer)
        callbacks.state('connected')
      } else if (state === 'failed') callbacks.error('네트워크 연결에 실패했습니다. TURN 릴레이 설정과 네트워크를 확인해주세요.')
      else if (state === 'disconnected') {
        callbacks.state('reconnecting')
        clearTimeout(this.disconnectTimer)
        this.disconnectTimer = setTimeout(() => callbacks.error('상대와 연결이 끊겨 카메라와 통화를 종료했습니다.'), 10000)
      }
    }
    this.connectionTimer = setTimeout(() => callbacks.error('연결 시간이 초과되었습니다. 외부 네트워크에서는 TURN 서버가 필요할 수 있습니다.'), 30000)
  }

  async start(offerer: boolean) {
    if (!offerer || this.closed) return
    this.attachChannel(this.connection.createDataChannel('chat', { ordered: true }))
    const offer = await this.connection.createOffer()
    if (this.closed) return
    await this.connection.setLocalDescription(offer)
    if (!this.closed) this.callbacks.signal({ description: this.connection.localDescription?.toJSON() })
  }

  async receive(description?: RTCSessionDescriptionInit, candidate?: RTCIceCandidateInit | null) {
    if (this.closed) return
    if (description) {
      await this.connection.setRemoteDescription(description)
      if (this.closed) return
      for (const pending of this.candidates) {
        await this.connection.addIceCandidate(pending || undefined)
        if (this.closed) return
      }
      this.candidates = []
      if (description.type === 'offer') {
        const answer = await this.connection.createAnswer()
        if (this.closed) return
        await this.connection.setLocalDescription(answer)
        if (!this.closed) this.callbacks.signal({ description: this.connection.localDescription?.toJSON() })
      }
    } else if (candidate !== undefined) {
      if (this.connection.remoteDescription) await this.connection.addIceCandidate(candidate || undefined)
      else this.candidates.push(candidate)
    }
  }

  private attachChannel(channel: RTCDataChannel) {
    if (this.closed || channel.label !== 'chat' || this.channel) { channel.close(); return }
    this.channel = channel
    let channelClosed = false
    const current = () => !this.closed && this.channel === channel && !channelClosed
    channel.onopen = () => { if (current() && channel.readyState === 'open') this.callbacks.chat(true) }
    channel.onclose = () => {
      if (!current()) return
      channelClosed = true
      this.callbacks.chat(false)
    }
    channel.onmessage = event => {
      if (!current() || channel.readyState !== 'open' || typeof event.data !== 'string' || event.data.length > 2000) return
      if (Date.now() - this.messageWindowStart >= 1000) { this.messageWindowStart = Date.now(); this.messageCount = 0 }
      if (++this.messageCount <= 10) this.callbacks.message(event.data)
    }
  }

  send(text: string) {
    if (this.channel?.readyState !== 'open' || this.channel.bufferedAmount > 64000 || text.length > 2000) return false
    this.channel.send(text)
    return true
  }

  close() {
    this.closed = true
    clearTimeout(this.connectionTimer)
    clearTimeout(this.disconnectTimer)
    if (this.channel) {
      this.channel.onopen = null
      this.channel.onclose = null
      this.channel.onmessage = null
    }
    this.channel?.close()
    this.channel = null
    this.connection.onconnectionstatechange = null
    this.connection.onicecandidate = null
    this.connection.ontrack = null
    this.connection.ondatachannel = null
    this.connection.close()
    this.candidates = []
  }
}
