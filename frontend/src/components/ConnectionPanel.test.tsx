import { useState } from 'react'
import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { ChatClient } from '../chat/ChatClient'
import type { ChatState } from '../chat/types'
import { initialMediaState } from '../chat/mediaAccess'
import { ConnectionPanel } from './ConnectionPanel'

const state: ChatState = {
  mode: 'random', activeMode: null, status: 'idle', preparationStep: null, media: { ...initialMediaState(), issue: null }, online: 0, serverOnline: true,
  notice: '', error: false, localStream: null, remoteStream: null, micMuted: false, cameraMuted: false, roomCode: '', messages: [], chatReady: false,
}

function mount(patch: Partial<ChatState> = {}, initialConsent = false) {
  const actions = { start: vi.fn(), leave: vi.fn(), selectMode: vi.fn() }
  function Form() {
    const [consent, setConsent] = useState(initialConsent)
    return <ConnectionPanel state={{ ...state, ...patch }} client={actions as unknown as ChatClient} consent={consent} setConsent={setConsent}/>
  }
  return { ...render(<Form/>), actions }
}

describe('ConnectionPanel setup guidance', () => {
  it('keeps start clickable and explains missing consent while focusing the checkbox', () => {
    const view = mount()
    const start = view.getByRole('button', { name: /대화 시작/ }) as HTMLButtonElement
    expect(start.disabled).toBe(false)
    fireEvent.click(start)
    expect(view.actions.start).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('먼저 위 이용 안내에 동의해주세요')
    expect(document.activeElement).toBe(view.getByRole('checkbox'))
  })

  it('starts matching after consent without requiring a separate device-check click', () => {
    const view = mount()
    fireEvent.click(view.getByRole('checkbox'))
    fireEvent.click(view.getByRole('button', { name: /대화 시작/ }))
    expect(view.actions.start).toHaveBeenCalledWith('queue:join', true)
  })

  it('explains missing consent for both invitation room actions', () => {
    const view = mount({ mode: 'room' })
    fireEvent.click(view.getByRole('button', { name: '초대방 만들기' }))
    fireEvent.change(view.getByLabelText('초대 코드'), { target: { value: '123456ABCDEF' } })
    fireEvent.submit(view.container.querySelector('#join-form')!)
    expect(view.actions.start).not.toHaveBeenCalled()
    expect(view.getByRole('alert').textContent).toContain('동의해주세요')
  })

  it('stops a preview immediately when consent is withdrawn', () => {
    const view = mount({ localStream: {} as MediaStream }, true)
    fireEvent.click(view.getByRole('checkbox'))
    expect(view.actions.leave).toHaveBeenCalledOnce()
  })

  it('shows why start is busy while a permission request is pending', () => {
    const view = mount({ status: 'preparing', preparationStep: 'permissions', media: { ...state.media, phase: 'requesting' } }, true)
    const start = view.getByRole('button', { name: /권한 확인 중/ }) as HTMLButtonElement
    expect(start.disabled).toBe(true)
    expect(view.actions.start).not.toHaveBeenCalled()
  })

  it('offers collapsed recovery instructions after a permission failure and lets start retry', () => {
    const view = mount({ media: { ...state.media, phase: 'error', cameraPermission: 'denied', issue: { code: 'permission', message: '권한이 필요합니다.' } } }, true)
    expect(view.container.querySelector('details')?.open).toBe(false)
    expect(view.getByText(/주소창의 사이트 설정/)).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: /대화 시작/ }))
    expect(view.actions.start).toHaveBeenCalledWith('queue:join', true)
  })
})
