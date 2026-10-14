// @refresh reset
import { useState } from 'react'
import { useVideoChat } from './hooks/useVideoChat'
import { ChatPanel } from './components/ChatPanel'
import { ConnectionPanel } from './components/ConnectionPanel'
import { VideoStage } from './components/VideoStage'
import { Icon } from './components/Icon'

export default function App() {
  const { state, client } = useVideoChat()
  const [consent, setConsent] = useState(false)
  return <div className="app-shell">
    <header className="topbar">
      <a className="brand" href="/" aria-label="Pair 홈"><span className="brand-mark">p<span>∙</span></span>pair<span className="brand-dot">.</span></a>
      <span className="header-label">A little hello, face to face.</span>
      <div className="server-status"><span className={`status-dot ${state.serverOnline ? 'is-online' : ''}`} id="server-dot"/><span>{state.serverOnline ? `${state.online}명 접속 중` : '서버 연결 끊김'}</span></div>
    </header>
    <main>
      <div className="page-heading"><div><p className="eyebrow">VIDEO CONVERSATIONS</p><h1>화면 너머, 새로운 대화</h1><p>우연히 만나거나, 링크 하나로 초대하세요.</p></div><span className="privacy-tag"><Icon name="shield"/>서버에 영상·채팅을 저장하지 않아요</span></div>
      <div className="workspace">
        <section className="conversation" aria-label="영상 통화">
          <VideoStage state={state} client={client} consent={consent}/>
          <ConnectionPanel state={state} client={client} consent={consent} setConsent={setConsent}/>
          <p className={`notice ${state.error || state.media.issue ? 'is-error' : ''}`} id="notice" role="status" aria-live="polite">{state.media.issue?.message || state.notice}</p>
        </section>
        <ChatPanel state={state} client={client}/>
      </div>
    </main>
    <footer className="footer"><span>PAIR · WEBRTC STUDY</span><a href="https://github.com/YooJuno/video-chatting" target="_blank" rel="noopener noreferrer">GitHub ↗</a></footer>
  </div>
}
