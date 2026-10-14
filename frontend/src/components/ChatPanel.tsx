import { useEffect, useRef, useState } from 'react'
import type { ChatClient } from '../chat/ChatClient'
import type { ChatState } from '../chat/types'
import { Icon } from './Icon'

export function ChatPanel({ state, client }: { state: ChatState; client: ChatClient }) {
  const [draft, setDraft] = useState('')
  const messages = useRef<HTMLDivElement>(null)
  useEffect(() => { if (messages.current) messages.current.scrollTop = messages.current.scrollHeight }, [state.messages])
  useEffect(() => { if (!state.chatReady) setDraft('') }, [state.chatReady])
  const paired = ['connecting', 'connected', 'reconnecting'].includes(state.status)
  return <aside className="chat-panel" aria-labelledby="chat-heading">
    <div className="chat-heading"><div><h2 id="chat-heading">대화</h2><span>{state.chatReady ? '상대와 직접 연결되었습니다' : '연결 후 채팅할 수 있어요'}</span></div><span className="chat-bubble">↗</span></div>
    <div className="messages" id="messages" ref={messages} role="log" aria-live="polite" aria-relevant="additions">
      {state.messages.length ? state.messages.map(message => <div className={`message ${message.kind}`} key={message.id}>{message.text}</div>) : <div className="chat-placeholder"><span>“안녕하세요!”</span><p>첫 인사는 가볍게.<br/>연결되면 메시지를 보내보세요.</p></div>}
    </div>
    <form className="chat-composer" id="chat-form" onSubmit={event => { event.preventDefault(); if (client.sendMessage(draft)) setDraft('') }}>
      <label className="sr-only" htmlFor="chat-input">메시지</label><input id="chat-input" maxLength={2000} placeholder="메시지 입력" autoComplete="off" disabled={!state.chatReady} value={draft} onChange={event => setDraft(event.target.value)}/>
      <button type="submit" id="send-message" aria-label="메시지 보내기" disabled={!state.chatReady}><Icon name="send"/></button>
    </form>
    <div className="chat-footer"><span>메시지는 연결 중에만 유지됩니다.</span><button className="text-button report-button" id="report-peer" disabled={!paired} onClick={() => { if (confirm('현재 연결을 종료하고 이 세션에서 상대를 차단할까요? 운영자 검토 기능은 아닙니다.')) client.report() }}>신고·차단</button></div>
  </aside>
}
