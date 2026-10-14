import type { MediaIssue, MediaState } from './types'

export class MediaAccessError extends Error {
  constructor(readonly issue: MediaIssue) { super(issue.message); this.name = 'MediaAccessError' }
}

export function mediaAvailability(): MediaIssue | null {
  if (globalThis.isSecureContext === false) return {
    code: 'insecure', message: '이 주소에서는 장치 권한을 요청할 수 없습니다. 이 컴퓨터에서는 localhost로, 다른 기기에서는 HTTPS 주소로 접속해주세요.',
  }
  if (!navigator.mediaDevices?.getUserMedia) return {
    code: 'unsupported', message: '이 브라우저는 카메라·마이크 요청을 지원하지 않습니다. 최신 Chrome, Edge, Firefox 또는 Safari에서 페이지를 직접 열어주세요.',
  }
  const documentPolicy = document as Document & { permissionsPolicy?: { allowsFeature: (name: string) => boolean }; featurePolicy?: { allowsFeature: (name: string) => boolean } }
  const policy = documentPolicy.permissionsPolicy || documentPolicy.featurePolicy
  if (policy && (!policy.allowsFeature('camera') || !policy.allowsFeature('microphone'))) return {
    code: 'policy', message: '이 페이지의 보안 정책이 카메라 또는 마이크를 막고 있습니다. 미리보기나 다른 페이지 안의 화면 대신 이 사이트를 새 탭에서 직접 열어주세요.',
  }
  return null
}

export function initialMediaState(): MediaState {
  return { phase: 'idle', cameraPermission: 'unknown', microphonePermission: 'unknown', issue: mediaAvailability() }
}

export function mediaIssue(error: unknown): MediaIssue {
  if (error instanceof MediaAccessError) return error.issue
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') return {
    code: 'permission', message: '카메라 또는 마이크 권한을 사용할 수 없습니다. 주소창의 사이트 설정과 운영체제의 브라우저 권한을 확인한 뒤 다시 시도해주세요.',
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') return {
    code: 'missing', message: '카메라 또는 마이크를 찾지 못했습니다. 두 장치를 연결하고 운영체제에서 인식하는지 확인해주세요.',
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') return {
    code: 'busy', message: '장치를 열지 못했습니다. 다른 통화·녹화 앱을 종료하고 운영체제의 카메라·마이크 권한을 확인한 뒤 다시 시도해주세요.',
  }
  if (name === 'OverconstrainedError') return {
    code: 'constraints', message: '현재 장치 설정으로 카메라 또는 마이크를 사용할 수 없습니다. 브라우저와 운영체제의 장치 설정을 확인한 뒤 다시 시도해주세요.',
  }
  if (name === 'SecurityError') return {
    code: 'policy', message: '브라우저 또는 이 페이지의 보안 설정이 장치 접근을 막고 있습니다. 브라우저에서 사이트를 직접 열고 장치 접근 설정을 확인해주세요.',
  }
  return { code: 'other', message: '카메라·마이크를 준비하지 못했습니다. 장치 연결과 브라우저 권한을 확인한 뒤 다시 시도해주세요.' }
}
