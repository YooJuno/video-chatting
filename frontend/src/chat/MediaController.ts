export class MediaController {
  stream: MediaStream | null = null

  constructor(private readonly ended: () => void) {}

  async acquire(valid: () => boolean): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('카메라는 HTTPS 또는 localhost에서 사용할 수 있습니다.')
    if (this.stream) return this.stream
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: { echoCancellation: true, noiseSuppression: true },
    })
    if (!valid()) {
      stream.getTracks().forEach(track => track.stop())
      throw new Error('시작 요청이 취소되었습니다.')
    }
    this.stream = stream
    stream.getTracks().forEach(track => track.addEventListener('ended', () => { if (this.stream === stream) this.ended() }))
    return stream
  }

  toggle(kind: 'audio' | 'video') {
    const track = this.stream?.getTracks().find(value => value.kind === kind)
    if (!track) return false
    track.enabled = !track.enabled
    return !track.enabled
  }

  stop() {
    const stream = this.stream
    this.stream = null
    stream?.getTracks().forEach(track => track.stop())
  }
}
