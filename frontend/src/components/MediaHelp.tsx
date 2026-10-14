import type { MediaIssue } from '../chat/types'

const help: Partial<Record<MediaIssue['code'], string>> = {
  permission: '주소창의 사이트 설정에서 카메라·마이크를 허용해주세요. 계속 차단되면 운영체제의 개인정보 보호 설정에서 브라우저의 장치 접근도 확인해주세요.',
  timeout: '주소창 옆에 접힌 권한 요청이 있는지 확인해주세요. 요청이 없으면 사이트 설정에서 카메라·마이크 권한을 확인해주세요.',
  busy: '다른 통화·녹화 앱을 종료해주세요. 계속 열리지 않으면 운영체제에서 브라우저의 카메라·마이크 접근을 허용하고 브라우저를 다시 실행해주세요.',
  missing: '카메라·마이크 연결과 운영체제에서의 인식 여부를 확인해주세요.',
  ended: '장치가 분리되지 않았는지 확인하고, 사이트 설정에서 카메라·마이크 권한을 허용해주세요.',
  constraints: '브라우저나 운영체제의 기본 카메라·마이크 설정을 확인해주세요.',
}

export function MediaHelp({ issue }: { issue: MediaIssue | null }) {
  if (!issue || !help[issue.code]) return null
  return <details className="permission-help">
    <summary>카메라·마이크 문제 해결</summary>
    <p>{help[issue.code]} 설정을 바꾼 뒤 시작 버튼을 다시 눌러주세요.</p>
    {(issue.code === 'permission' || issue.code === 'timeout') && <a href="https://support.google.com/chrome/answer/2693767?hl=ko" target="_blank" rel="noopener noreferrer">Chrome 권한 설정 안내 ↗</a>}
  </details>
}
