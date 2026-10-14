import { useEffect, useRef, useState } from 'react'
import type { ChatClient } from '../chat/ChatClient'
import { invitationCode, statusLabels } from '../chat/types'
import type { ChatState } from '../chat/types'
import { Icon } from './Icon'
import { MediaHelp } from './MediaHelp'

interface Props { state: ChatState; client: ChatClient; consent: boolean; setConsent: (value: boolean) => void }

export function ConnectionPanel({ state, client, consent, setConsent }: Props) {
  const [code, setCode] = useState(invitationCode)
  const [copied, setCopied] = useState('')
  const [needsConsent, setNeedsConsent] = useState(false)
  const consentInput = useRef<HTMLInputElement>(null)
  const active = state.status !== 'idle'
  useEffect(() => { setCopied('') }, [state.roomCode])
  const requestConsent = () => {
    if (consent) return true
    setNeedsConsent(true)
    consentInput.current?.focus()
    consentInput.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    return false
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${location.origin}/?room=${state.roomCode}`); setCopied('복사했어요') }
    catch { setCopied(`초대 코드: ${state.roomCode}`) }
  }
  return <div className="connection-panel">
    <div className={`consent-block ${needsConsent && !consent ? 'needs-consent' : ''}`}>
      <label className="consent"><input ref={consentInput} type="checkbox" id="consent" checked={consent} onChange={event => {
        setConsent(event.target.checked)
        setNeedsConsent(false)
        if (!event.target.checked && state.localStream) client.leave()
      }} disabled={active} aria-describedby="consent-hint"/><span><strong>이용 안내 동의 · 필수</strong>성인 이용자이며, 상대방을 존중하고 허락 없이 녹화하지 않는 데 동의합니다.</span></label>
      <p id="consent-hint" className="consent-hint" hidden={active} role={needsConsent && !consent ? 'alert' : undefined}>{consent ? '시작하면 브라우저에서 카메라·마이크 권한을 요청합니다.' : needsConsent ? '먼저 위 이용 안내에 동의해주세요.' : '동의한 뒤 대화 시작을 눌러주세요.'}</p>
    </div>
    <div className="mode-tabs" role="group" aria-label="연결 방식">
      <button id="mode-random" aria-pressed={state.mode === 'random'} disabled={active} onClick={() => client.selectMode('random')}>랜덤 연결</button>
      <button id="mode-room" aria-pressed={state.mode === 'room'} disabled={active} onClick={() => client.selectMode('room')}>초대방</button>
    </div>
    <div id="random-controls" className="mode-panel" hidden={state.mode !== 'random'}>
      <div><h2>새로운 사람과 1:1 대화</h2><p>대기 중인 상대와 연결합니다. 원치 않으면 언제든 종료하세요.</p></div>
      <button className="primary-button" id="start-random" disabled={active} aria-describedby={!consent ? 'consent-hint' : undefined} onClick={() => { if (requestConsent()) void client.start('queue:join', true) }}>{active ? state.preparationStep === 'permissions' ? '권한 확인 중' : state.preparationStep === 'server' ? '서버 연결 중' : statusLabels[state.status] : '대화 시작'} <span>↗</span></button>
    </div>
    <div id="room-controls" className="mode-panel room-panel" hidden={state.mode !== 'room'}>
      <div className="room-actions">
        <button className="primary-button" id="create-room" disabled={active} aria-describedby={!consent ? 'consent-hint' : undefined} onClick={() => { if (requestConsent()) void client.start('room:create', true) }}>초대방 만들기</button>
        <form id="join-form" onSubmit={event => { event.preventDefault(); if (requestConsent()) void client.start('room:join', true, code) }}>
          <label className="sr-only" htmlFor="room-code">초대 코드</label>
          <input id="room-code" maxLength={12} placeholder="초대 코드 12자리" autoComplete="off" spellCheck={false} pattern="[a-fA-F0-9]{12}" required disabled={active} value={code} onChange={event => setCode(event.target.value)}/>
          <button className="secondary-button" type="submit" disabled={active}>입장</button>
        </form>
      </div>
      <div id="invite-panel" className="invite-panel" hidden={!state.roomCode}>
        <span>초대 코드 <strong id="invite-code">{state.roomCode}</strong></span>
        <button className="text-button" id="copy-invite" onClick={() => { void copy() }}><Icon name="link"/>초대 링크 복사</button><span role="status">{copied}</span>
      </div>
    </div>
    <MediaHelp issue={state.media.issue}/>
  </div>
}
