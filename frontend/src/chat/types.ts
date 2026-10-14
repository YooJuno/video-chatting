export type Mode = 'random' | 'room'
export type Status = 'idle' | 'preparing' | 'waiting' | 'connecting' | 'connected' | 'reconnecting'
export type StartAction = 'queue:join' | 'room:create' | 'room:join'
export interface IceConfig extends RTCConfiguration { relayOnly: boolean }
export interface Message { id: string; text: string; kind: 'system' | 'mine' | 'theirs' }
export interface ChatState {
  mode: Mode
  activeMode: Mode | null
  status: Status
  online: number
  serverOnline: boolean
  notice: string
  error: boolean
  localStream: MediaStream | null
  remoteStream: MediaStream | null
  micMuted: boolean
  cameraMuted: boolean
  roomCode: string
  messages: Message[]
  chatReady: boolean
}
export type ServerMessage =
  | { type: 'welcome'; id: string }
  | { type: 'stats'; online: number; waiting: number }
  | { type: 'paired'; attemptId: string; callId: string; mode: Mode; offerer: boolean }
  | { type: 'signal'; callId: string; description?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit | null }
  | { type: 'waiting'; attemptId: string }
  | { type: 'room-created'; attemptId: string; code: string }
  | { type: 'peer-left'; callId: string }
  | { type: 'error' | 'expired'; attemptId?: string; message: string }
  | { type: 'reported' }

export const statusLabels: Record<Status, string> = {
  idle: '연결 전', preparing: '연결 준비 중', waiting: '상대 기다리는 중',
  connecting: '상대 연결 중', connected: '대화 중', reconnecting: '연결 복구 중',
}

export function invitationCode() {
  const code = new URLSearchParams(location.search).get('room') || ''
  return /^[a-fA-F0-9]{12}$/.test(code) ? code.toUpperCase() : ''
}
