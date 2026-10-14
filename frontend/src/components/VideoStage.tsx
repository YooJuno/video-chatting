import { useEffect, useRef, useState } from 'react'
import { statusLabels } from '../chat/types'
import type { ChatState } from '../chat/types'
import type { ChatClient } from '../chat/ChatClient'
import { Icon } from './Icon'

export function VideoStage({ state, client, consent }: { state: ChatState; client: ChatClient; consent: boolean }) {
  const local = useRef<HTMLVideoElement>(null)
  const remote = useRef<HTMLVideoElement>(null)
  const [needsPlay, setNeedsPlay] = useState(false)
  const displayStream = state.remoteStream || state.localStream
  useEffect(() => {
    if (!local.current) return
    local.current.srcObject = state.localStream
    local.current.muted = true
    if (state.localStream) void local.current.play().catch(() => {})
  }, [state.localStream])
  useEffect(() => {
    const video = remote.current
    if (!video) return
    video.srcObject = displayStream
    video.muted = !state.remoteStream
    let current = true
    setNeedsPlay(false)
    if (displayStream) void video.play().catch(() => { if (current && state.remoteStream) setNeedsPlay(true) })
    return () => { current = false }
  }, [displayStream, state.remoteStream])
  const active = state.status !== 'idle'
  const paired = ['connecting', 'connected', 'reconnecting'].includes(state.status)
  const cameraOn = Boolean(state.localStream) && !state.cameraMuted
  let title = '대화할 준비가 되셨나요?'
  let description = '연결 방식을 고른 뒤 시작해주세요. 카메라는 동의 후에 켜집니다.'
  if (state.status === 'preparing') {
    title = state.preparationStep === 'permissions' ? '카메라·마이크 권한 확인' : '대화 서버 연결 중'
    description = state.preparationStep === 'permissions' ? '브라우저 권한 요청에서 허용을 선택해주세요. 요청을 취소할 수도 있습니다.' : '장치 준비를 마쳤습니다. 서버 연결을 확인하고 있습니다.'
  }
  if (state.status === 'waiting') {
    title = state.roomCode ? '초대 링크를 보내주세요' : '상대 기다리는 중'
    description = state.roomCode ? '한 명이 입장하면 1:1 대화가 시작됩니다.' : '대기 중인 상대가 들어오면 자동으로 연결합니다.'
  }
  if (state.status === 'connecting') { title = '상대 연결 중'; description = '영상과 소리를 연결하고 있습니다.' }
  if (state.status === 'reconnecting') { title = '연결 복구 중'; description = '상대방의 연결을 확인하고 있습니다.' }
  return <>
    <div className={`video-stage ${state.status === 'connected' ? 'is-connected' : active ? 'is-waiting' : ''}`} id="video-stage">
      <video id="remote-video" ref={remote} autoPlay playsInline muted={!state.remoteStream} className={!state.remoteStream ? 'self-preview' : undefined} aria-label={state.remoteStream ? '상대 영상' : '내 카메라 미리보기'}/>
      <div className="remote-empty" id="remote-empty" hidden={Boolean(state.remoteStream) || cameraOn}>
        <span className="empty-orbit"><Icon name="camera"/></span><h2>{title}</h2><p>{description}</p>
      </div>
      <div className="stage-status"><span className="status-dot"/><span id="call-status" role="status">{state.localStream && state.status === 'idle' ? '내 카메라 미리보기' : state.roomCode && state.status === 'waiting' ? '초대방 대기 중' : statusLabels[state.status]}</span></div>
      {needsPlay && <button className="audio-prompt" id="play-audio" onClick={() => { void remote.current?.play().then(() => setNeedsPlay(false)).catch(() => {}) }}>상대 소리 재생하기</button>}
      <div className="local-preview" hidden={!state.remoteStream}><video id="local-video" ref={local} autoPlay muted playsInline aria-label="내 영상 미리보기"/>
        <div id="local-empty" hidden={cameraOn}><Icon name="camera"/><span>내 카메라</span></div>
        <span className="local-label">나 · 카메라 {cameraOn ? '켜짐' : '꺼짐'}</span>
      </div>
    </div>
    <div className="call-controls">
      <div className="device-controls">
        <button className="icon-button" id="toggle-mic" aria-label={`마이크 ${state.micMuted ? '켜기' : '끄기'}`} aria-pressed={state.micMuted} disabled={!state.localStream} onClick={() => client.toggle('audio')}><Icon name="mic"/></button>
        <button className="icon-button" id="toggle-camera" aria-label={`카메라 ${state.cameraMuted ? '켜기' : '끄기'}`} aria-pressed={state.cameraMuted} disabled={!state.localStream} onClick={() => client.toggle('video')}><Icon name="camera"/></button>
      </div>
      <button className="next-button" id="next-peer" disabled={!paired || state.activeMode !== 'random'} onClick={() => client.next(consent)}><Icon name="next"/>다음 상대</button>
      <button className="end-button" id="leave-call" disabled={!active && !state.localStream} onClick={() => client.leave()}><Icon name="phone"/><span>{state.preparationStep === 'permissions' ? '요청 취소' : '종료'}</span></button>
    </div>
  </>
}
