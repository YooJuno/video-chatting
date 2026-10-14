import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MediaController, MEDIA_PERMISSION_TIMEOUT } from './MediaController'

function capture(kinds = ['audio', 'video']) {
  const tracks = kinds.map(kind => Object.assign(new EventTarget(), { kind, enabled: true, readyState: 'live', stop: vi.fn() }))
  return { stream: { getTracks: () => tracks } as unknown as MediaStream, tracks }
}

class Permission extends EventTarget {
  constructor(public state: PermissionState) { super() }
  change(state: PermissionState) { this.state = state; this.dispatchEvent(new Event('change')) }
}

describe('MediaController device permissions', () => {
  let media: MediaController
  let devices: { getUserMedia: ReturnType<typeof vi.fn> }
  const ended = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('isSecureContext', true)
    devices = { getUserMedia: vi.fn() }
    vi.stubGlobal('navigator', { mediaDevices: devices })
    media = new MediaController(ended)
  })
  afterEach(() => { media.stop(); media.stopObserving(); vi.useRealTimers() })

  it('requests both devices immediately and marks permissions granted after success', async () => {
    const { stream } = capture()
    devices.getUserMedia.mockResolvedValue(stream)
    const opening = media.acquire(() => true)
    expect(devices.getUserMedia).toHaveBeenCalledOnce()
    expect(media.state.phase).toBe('requesting')
    await opening
    expect(media.state).toMatchObject({ phase: 'ready', cameraPermission: 'granted', microphonePermission: 'granted', issue: null })
  })

  it('explains insecure HTTP without attempting permission or device access', async () => {
    vi.stubGlobal('isSecureContext', false)
    await expect(media.acquire(() => true)).rejects.toThrow('HTTPS')
    expect(media.state.issue?.code).toBe('insecure')
    expect(devices.getUserMedia).not.toHaveBeenCalled()
  })

  it('handles browsers without media support', async () => {
    vi.stubGlobal('navigator', {})
    await expect(media.acquire(() => true)).rejects.toThrow('지원하지 않습니다')
    expect(media.state.issue?.code).toBe('unsupported')
  })

  it('never opens a browser prompt for an already cancelled request', async () => {
    const abort = new AbortController()
    abort.abort()
    await expect(media.acquire(() => true, abort.signal)).rejects.toMatchObject({ name: 'AbortError' })
    expect(devices.getUserMedia).not.toHaveBeenCalled()
  })

  it.each([
    ['NotAllowedError', 'permission'], ['NotFoundError', 'missing'], ['NotReadableError', 'busy'], ['OverconstrainedError', 'constraints'],
  ])('maps %s to actionable %s guidance', async (name, code) => {
    devices.getUserMedia.mockRejectedValue(new DOMException('device error', name))
    await expect(media.acquire(() => true)).rejects.toThrow()
    expect(media.state).toMatchObject({ phase: 'error', issue: { code } })
    expect(media.stream).toBeNull()
  })

  it('does not leave a partial capture running when one device is unavailable', async () => {
    const { stream, tracks } = capture(['video'])
    devices.getUserMedia.mockResolvedValue(stream)
    await expect(media.acquire(() => true)).rejects.toThrow('모두 준비하지 못했습니다')
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(media.stream).toBeNull()
  })

  it('times out ignored permission requests and stops any subsequently granted stream', async () => {
    vi.useFakeTimers()
    let grant!: (stream: MediaStream) => void
    devices.getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve }))
    const opening = media.acquire(() => true)
    const rejected = expect(opening).rejects.toThrow('응답')
    // The browser can leave its prompt pending indefinitely; the app must recover.
    await vi.advanceTimersByTimeAsync(MEDIA_PERMISSION_TIMEOUT)
    await rejected
    expect(media.state.issue?.code).toBe('timeout')
    const { stream, tracks } = capture()
    grant(stream)
    await Promise.resolve()
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(media.stream).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels promptly and releases a late permission result without changing newer state', async () => {
    const abort = new AbortController()
    let grant!: (stream: MediaStream) => void
    devices.getUserMedia.mockReturnValue(new Promise(resolve => { grant = resolve }))
    const opening = media.acquire(() => !abort.signal.aborted, abort.signal)
    const rejected = expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    media.stop()
    await rejected
    const { stream, tracks } = capture()
    grant(stream)
    await Promise.resolve()
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(media.state.phase).toBe('idle')
  })

  it('reads permission state without prompting and observes revocation only while subscribed', async () => {
    const camera = new Permission('prompt'), microphone = new Permission('granted')
    const query = vi.fn(async ({ name }: { name: string }) => name === 'camera' ? camera : microphone)
    vi.stubGlobal('navigator', { mediaDevices: devices, permissions: { query } })
    media.observe()
    await Promise.resolve()
    expect(media.state).toMatchObject({ cameraPermission: 'prompt', microphonePermission: 'granted' })
    expect(devices.getUserMedia).not.toHaveBeenCalled()
    devices.getUserMedia.mockResolvedValue(capture().stream)
    await media.acquire(() => true)
    camera.change('denied')
    expect(ended).toHaveBeenCalledOnce()
    expect(media.state.cameraPermission).toBe('denied')
    media.stopObserving()
    camera.change('granted')
    expect(media.state.cameraPermission).toBe('denied')
  })

  it('still acquires devices if permission queries are unsupported', async () => {
    vi.stubGlobal('navigator', { mediaDevices: devices, permissions: { query: vi.fn().mockRejectedValue(new TypeError('unsupported')) } })
    media.observe()
    const { stream } = capture()
    devices.getUserMedia.mockResolvedValue(stream)
    await expect(media.acquire(() => true)).resolves.toBe(stream)
    expect(media.state.cameraPermission).toBe('granted')
  })

  it('releases both devices if permission is revoked without a change event', async () => {
    vi.useFakeTimers()
    const camera = new Permission('granted'), microphone = new Permission('granted')
    vi.stubGlobal('navigator', { mediaDevices: devices, permissions: { query: vi.fn(async ({ name }: { name: string }) => name === 'camera' ? camera : microphone) } })
    const { stream, tracks } = capture()
    devices.getUserMedia.mockResolvedValue(stream)
    await media.acquire(() => true)
    camera.state = 'denied'
    await vi.advanceTimersByTimeAsync(3000)
    expect(media.stream).toBeNull()
    expect(media.state).toMatchObject({ phase: 'error', cameraPermission: 'denied', issue: { code: 'permission' } })
    tracks.forEach(track => expect(track.stop).toHaveBeenCalledOnce())
    expect(ended).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not let an ended event from a stopped stream terminate a newer capture', async () => {
    const previous = capture(), current = capture()
    devices.getUserMedia.mockResolvedValueOnce(previous.stream).mockResolvedValueOnce(current.stream)
    await media.acquire(() => true)
    media.stop()
    await media.acquire(() => true)
    previous.tracks[0]!.dispatchEvent(new Event('ended'))
    expect(ended).not.toHaveBeenCalled()
    current.tracks[0]!.dispatchEvent(new Event('ended'))
    expect(ended).toHaveBeenCalledOnce()
  })
})
