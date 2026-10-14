import { MediaController } from './MediaController'
import { PeerSession } from './PeerSession'
import { SignalingSocket } from './SignalingSocket'
import { invitationCode } from './types'
import { initialMediaState, MediaAccessError } from './mediaAccess'
import type { ChatState, IceConfig, Message, Mode, ServerMessage, StartAction } from './types'

export class ChatClient {
  private state: ChatState = {
    mode: invitationCode() ? 'room' : 'random', activeMode: null, status: 'idle', preparationStep: null, media: initialMediaState(), online: 0, serverOnline: false,
    notice: '학습용 1:1 서비스입니다. 개인정보를 공유하지 마세요. P2P 연결에서는 상대방에게 네트워크 주소가 드러날 수 있습니다.',
    error: false, localStream: null, remoteStream: null, micMuted: false, cameraMuted: false, roomCode: '', messages: [], chatReady: false,
  }
  private readonly listeners = new Set<() => void>()
  private readonly media = new MediaController(() => this.fail('장치 연결 또는 권한이 종료되어 카메라·마이크를 껐습니다. 장치와 사이트 권한을 확인해주세요.'), media => this.update({ media }))
  private readonly signaling = new SignalingSocket(message => this.receive(message), () => {
    const active = this.state.activeMode !== null || this.state.preparationStep === 'server'
    if (!active) { this.update({ serverOnline: false, online: 0 }); return }
    this.reset()
    this.update({ serverOnline: false, ...(active ? { notice: '서버 연결이 끊겨 카메라와 통화를 종료했습니다. 다시 시작해주세요.', error: true } : {}) })
  })
  private peer: PeerSession | null = null
  private configuration?: IceConfig
  private attemptId: string | null = null
  private generation = 0
  private sequence = Promise.resolve()
  private request: AbortController | null = null
  private mediaRequest: AbortController | null = null

  snapshot = () => this.state
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }

  private update(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach(listener => listener())
  }

  async connect() {
    this.media.observe()
    const generation = this.generation
    try { await this.signaling.open() }
    catch (error) {
      if (generation === this.generation && this.state.status === 'idle' && !this.state.localStream) this.update({ notice: this.errorMessage(error), error: true })
    }
  }

  selectMode(mode: Mode) {
    if (this.state.status === 'idle') this.update({ mode })
  }

  async start(action: StartAction, consent: boolean, code?: string) {
    if (this.state.status !== 'idle') return
    const generation = this.generation
    this.update({ status: 'preparing', preparationStep: 'permissions', error: false })
    try {
      if (!consent) throw new Error('이용 안내에 동의한 뒤 시작해주세요.')
      const stream = await this.acquireMedia(generation)
      if (generation !== this.generation) return
      this.attemptId = crypto.randomUUID()
      this.update({ localStream: stream, preparationStep: 'server', notice: '장치가 준비되었습니다. 대화 서버에 연결하고 있습니다.' })
      await this.signaling.open()
      if (generation !== this.generation) return
      const request = new AbortController()
      this.request = request
      const timer = setTimeout(() => request.abort(), 10000)
      let response: Response
      try { response = await fetch('/api/config', { cache: 'no-store', signal: request.signal }) }
      catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error
        throw new Error('장치는 준비했지만 대화 서버의 연결 설정을 가져오지 못했습니다. 서버 연결 상태를 확인한 뒤 다시 시작해주세요.')
      }
      finally { clearTimeout(timer) }
      if (!response.ok) throw new Error('연결 설정을 가져오지 못했습니다. 잠시 후 다시 시도해주세요.')
      const configuration = await response.json() as IceConfig
      if (generation !== this.generation) return
      this.configuration = configuration
      this.signaling.send({ type: action, attemptId: this.attemptId, ...(code ? { code: code.trim() } : {}) })
      this.update({
        preparationStep: null, localStream: stream, activeMode: action === 'queue:join' ? 'random' : 'room',
        notice: configuration.relayOnly ? 'TURN 릴레이 전용 연결입니다. 미디어와 채팅은 저장하지 않습니다.' : 'P2P 연결을 준비합니다. 상대에게 네트워크 주소가 드러날 수 있습니다.',
      })
    } catch (error) {
      if (generation !== this.generation) return
      this.reset()
      this.update({ notice: this.errorMessage(error), error: true })
    }
  }

  private acquireMedia(generation: number) {
    const request = new AbortController()
    this.mediaRequest = request
    this.update({ notice: this.media.stream ? '준비된 장치를 사용합니다.' : '브라우저의 카메라·마이크 권한 요청에서 허용을 선택해주세요. 이미 허용한 사이트는 바로 장치가 켜집니다.' })
    return this.media.acquire(() => generation === this.generation, request.signal)
  }

  private receive(message: ServerMessage) {
    if (message.type === 'welcome') { this.update({ serverOnline: true }); return }
    if (message.type === 'stats') { this.update({ online: message.online }); return }
    if (['paired', 'waiting', 'room-created', 'error', 'expired'].includes(message.type)
        && 'attemptId' in message && message.attemptId !== this.attemptId) return
    if (message.type === 'paired' || message.type === 'signal') {
      const generation = this.generation
      this.sequence = this.sequence.then(async () => {
        if (generation !== this.generation) return
        if (message.type === 'signal') {
          if (this.peer?.id === message.callId) await this.peer.receive(message.description, message.candidate)
          return
        }
        if (!this.media.stream || !this.configuration || !this.attemptId) return
        this.peer?.close()
        const current = () => this.peer?.id === message.callId && generation === this.generation
        this.peer = new PeerSession(message.callId, this.media.stream, this.configuration, {
          signal: payload => { if (current()) { try { this.signaling.send({ type: 'signal', callId: message.callId, ...payload }) } catch (error) { this.fail(this.errorMessage(error)) } } },
          stream: stream => { if (current()) this.update({ remoteStream: stream }) },
          state: status => { if (current()) this.update({ status, ...(status === 'connected' ? { notice: '편안한 대화 되세요. 원치 않는 대화는 종료하거나 신고·차단할 수 있습니다.' } : {}) }) },
          chat: ready => { if (current()) { this.update({ chatReady: ready }); if (ready) this.addMessage('연결되었습니다. 가벼운 인사로 대화를 시작해보세요.', 'system') } },
          message: text => { if (current()) this.addMessage(text, 'theirs') },
          error: text => { if (current()) this.fail(text) },
        })
        this.update({ status: 'connecting', activeMode: message.mode })
        await this.peer.start(message.offerer)
      }).catch(error => { if (generation === this.generation) this.fail(`연결 처리에 실패했습니다. ${this.errorMessage(error)}`) })
    } else if (message.type === 'waiting') this.update({ status: 'waiting' })
    else if (message.type === 'room-created') this.update({ status: 'waiting', roomCode: message.code })
    else if (message.type === 'peer-left' && message.callId === this.peer?.id) {
      this.reset()
      this.update({ notice: '상대방이 대화를 종료했습니다. 카메라·마이크를 껐습니다. 새 대화는 직접 시작해주세요.' })
      this.addMessage('대화가 종료되었습니다.', 'system')
    } else if (message.type === 'error' || message.type === 'expired') this.fail(message.message)
    else if (message.type === 'reported') this.update({ notice: '이 세션에서 상대를 차단했습니다. 신고 기록은 서버 메모리에 1시간 이내로 보관됩니다.' })
  }

  leave() {
    try { this.signaling.send({ type: 'call:leave' }) } catch {}
    this.reset()
    this.update({ notice: '카메라·마이크와 연결을 모두 종료했습니다.' })
  }

  next(consent: boolean) {
    if (!this.peer || this.state.activeMode !== 'random') return
    try { this.signaling.send({ type: 'call:leave' }) } catch {}
    this.reset(true)
    void this.start('queue:join', consent)
  }

  report() {
    if (!this.peer) return
    try { this.signaling.send({ type: 'peer:report' }); this.reset() }
    catch (error) { this.fail(this.errorMessage(error)) }
  }

  toggle(kind: 'audio' | 'video') {
    if (!this.media.stream) return
    const muted = this.media.toggle(kind)
    this.update(kind === 'audio' ? { micMuted: muted } : { cameraMuted: muted })
  }

  sendMessage(value: string) {
    const text = value.trim()
    try {
      if (!text || !this.peer?.send(text)) return false
      this.addMessage(text, 'mine')
      return true
    } catch { this.update({ notice: '메시지 전송에 실패했습니다. 연결 상태를 확인해주세요.', error: true }); return false }
  }

  private addMessage(text: string, kind: Message['kind']) {
    this.update({ messages: [...this.state.messages, { id: crypto.randomUUID(), text, kind }].slice(-150) })
  }

  private reset(keepMedia = false) {
    this.generation++
    this.attemptId = null
    this.mediaRequest?.abort()
    this.mediaRequest = null
    this.request?.abort()
    this.request = null
    this.peer?.close()
    this.peer = null
    if (!keepMedia) this.media.stop()
    this.update({
      activeMode: null, status: 'idle', preparationStep: null, localStream: this.media.stream, remoteStream: null, roomCode: '', messages: [], chatReady: false,
      ...(!keepMedia ? { micMuted: false, cameraMuted: false } : {}),
    })
  }

  private fail(message: string) {
    try { this.signaling.send({ type: 'call:leave' }) } catch {}
    this.reset()
    this.update({ notice: message, error: true })
  }

  private errorMessage(error: unknown) {
    if (error instanceof MediaAccessError) return error.message
    if (error instanceof DOMException && error.name === 'NotAllowedError') return '카메라·마이크 권한이 필요합니다. 브라우저 권한 설정을 확인해주세요.'
    if (error instanceof DOMException && error.name === 'NotFoundError') return '사용할 수 있는 카메라·마이크를 찾지 못했습니다.'
    if (error instanceof DOMException && error.name === 'AbortError') return '연결 설정 요청이 취소되었거나 시간이 초과되었습니다.'
    return error instanceof Error ? error.message : '연결 처리 중 오류가 발생했습니다.'
  }

  dispose() {
    this.leave()
    this.signaling.close()
    this.media.stopObserving()
    this.update({ serverOnline: false, online: 0 })
  }
}
