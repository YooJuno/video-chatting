import { initialMediaState, MediaAccessError, mediaAvailability, mediaIssue } from './mediaAccess'
import type { MediaIssue, MediaPermission, MediaState } from './types'

export const MEDIA_PERMISSION_TIMEOUT = 45000

export class MediaController {
  stream: MediaStream | null = null
  state = initialMediaState()
  private observing = false
  private observation = 0
  private permissionTimer?: ReturnType<typeof setInterval>
  private readonly cleanups: (() => void)[] = []

  constructor(private readonly ended: () => void, private readonly changed: (state: MediaState) => void = () => {}) {}

  private update(patch: Partial<MediaState>) { this.state = { ...this.state, ...patch }; this.changed(this.state) }

  private lostAccess(issue: MediaIssue) {
    if (!this.stream) return
    this.update({ phase: 'error', issue })
    this.stop()
    this.ended()
  }

  private permissionRevoked() {
    this.lostAccess({ code: 'permission', message: '카메라 또는 마이크 권한이 해제되어 장치를 껐습니다. 사이트 설정에서 다시 허용한 뒤 대화를 시작해주세요.' })
  }

  private async checkPermissions() {
    const stream = this.stream
    if (!stream || !navigator.permissions?.query) return
    const states = await Promise.all(['camera', 'microphone'].map(async name => {
      try { return (await navigator.permissions.query({ name: name as PermissionName })).state }
      catch { return null }
    }))
    if (this.stream !== stream) return
    this.update({ ...(states[0] ? { cameraPermission: states[0] } : {}), ...(states[1] ? { microphonePermission: states[1] } : {}) })
    if (states.includes('denied')) this.permissionRevoked()
  }

  observe() {
    if (this.observing) return
    this.observing = true
    const observation = ++this.observation
    for (const kind of ['camera', 'microphone'] as const) {
      if (!navigator.permissions?.query) continue
      void navigator.permissions.query({ name: kind as PermissionName }).then(status => {
        if (!this.observing || observation !== this.observation) return
        const change = () => {
          const permission: MediaPermission = status.state
          this.update(kind === 'camera' ? { cameraPermission: permission } : { microphonePermission: permission })
          if (permission === 'denied') this.permissionRevoked()
        }
        change()
        status.addEventListener('change', change)
        this.cleanups.push(() => status.removeEventListener('change', change))
      }).catch(() => { /* Some browsers do not expose camera/microphone permission queries. */ })
    }
    const focus = () => { void this.checkPermissions() }
    const visible = () => { if (!document.hidden) focus() }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    this.cleanups.push(() => { window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible) })
  }

  stopObserving() {
    clearInterval(this.permissionTimer)
    this.observing = false
    this.observation++
    this.cleanups.splice(0).forEach(cleanup => cleanup())
  }

  async acquire(valid: () => boolean, signal?: AbortSignal): Promise<MediaStream> {
    if (!valid() || signal?.aborted) throw new DOMException('장치 요청이 취소되었습니다.', 'AbortError')
    const unavailable = mediaAvailability()
    if (unavailable) { this.update({ phase: 'error', issue: unavailable }); throw new MediaAccessError(unavailable) }
    if (this.stream) return this.stream
    this.update({ phase: 'requesting', issue: null })
    const constraints: MediaStreamConstraints = {
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    }
    try {
      // Call immediately from the user's click, before any server request or permission query.
      const pending = navigator.mediaDevices.getUserMedia(constraints)
      const stream = await new Promise<MediaStream>((resolve, reject) => {
        let settled = false
        const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel) }
        const cancel = () => { if (settled) return; settled = true; cleanup(); reject(new DOMException('장치 요청이 취소되었습니다.', 'AbortError')) }
        const timer = setTimeout(() => {
          if (settled) return
          settled = true
          cleanup()
          reject(new MediaAccessError({ code: 'timeout', message: '장치 권한 요청에 응답이 없습니다. 주소창의 카메라·마이크 알림에서 허용하거나, 사이트 설정을 확인한 뒤 다시 시도해주세요.' }))
        }, MEDIA_PERMISSION_TIMEOUT)
        signal?.addEventListener('abort', cancel, { once: true })
        if (signal?.aborted) cancel()
        pending.then(value => {
          if (settled || !valid()) {
            value.getTracks().forEach(track => track.stop())
            if (!settled) { settled = true; cleanup(); reject(new DOMException('장치 요청이 취소되었습니다.', 'AbortError')) }
            return
          }
          settled = true
          cleanup()
          resolve(value)
        }, error => { if (!settled) { settled = true; cleanup(); reject(error) } })
      })
      if (!valid() || signal?.aborted) { stream.getTracks().forEach(track => track.stop()); throw new DOMException('장치 요청이 취소되었습니다.', 'AbortError') }
      const tracks = stream.getTracks()
      if (!['audio', 'video'].every(kind => tracks.some(track => track.kind === kind && track.readyState !== 'ended'))) {
        tracks.forEach(track => track.stop())
        throw new MediaAccessError({ code: 'missing', message: '카메라와 마이크를 모두 준비하지 못했습니다. 두 장치가 연결되어 있고 사용 가능한지 확인해주세요.' })
      }
      this.stream = stream
      tracks.forEach(track => track.addEventListener('ended', () => {
        if (this.stream === stream) this.lostAccess({ code: 'ended', message: '카메라 또는 마이크 연결이 종료되었습니다. 장치 연결과 사이트 권한을 확인한 뒤 다시 시도해주세요.' })
      }))
      this.update({ phase: 'ready', cameraPermission: 'granted', microphonePermission: 'granted', issue: null })
      if (typeof navigator.permissions?.query === 'function') this.permissionTimer = setInterval(() => { void this.checkPermissions() }, 3000)
      return stream
    } catch (error) {
      if (valid()) this.update(signal?.aborted ? { phase: 'idle' } : { phase: 'error', issue: mediaIssue(error) })
      throw error instanceof DOMException && error.name === 'AbortError' && signal?.aborted ? error : new MediaAccessError(mediaIssue(error))
    }
  }

  toggle(kind: 'audio' | 'video') {
    const track = this.stream?.getTracks().find(value => value.kind === kind)
    if (!track) return false
    track.enabled = !track.enabled
    return !track.enabled
  }

  stop() {
    clearInterval(this.permissionTimer)
    this.permissionTimer = undefined
    const stream = this.stream
    this.stream = null
    stream?.getTracks().forEach(track => track.stop())
    this.update({ phase: this.state.issue ? 'error' : 'idle' })
  }
}
