import { fireEvent, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChatClient } from '../chat/ChatClient'
import type { ChatState, Message } from '../chat/types'
import { initialMediaState } from '../chat/mediaAccess'
import { ChatPanel } from './ChatPanel'

const message = (id: number, kind: Message['kind'] = 'theirs'): Message => ({ id: String(id), text: `메시지 ${id}`, kind })
const history = (length: number) => Array.from({ length }, (_, index) => message(index + 1))
const state: ChatState = {
  mode: 'random', activeMode: 'random', status: 'connected', preparationStep: null, media: initialMediaState(), online: 2, serverOnline: true,
  notice: '', error: false, localStream: null, remoteStream: null, micMuted: false, cameraMuted: false,
  roomCode: '', messages: [], chatReady: true,
}

// jsdom has no layout. Model a 180px viewport and 60px message rows so that
// scrolling tests exercise the reader's visible position, including pruning.
beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.id === 'messages') return new DOMRect(0, 100, 300, 180)
    if (this.dataset.messageId && this.parentElement?.id === 'messages') {
      const viewport = this.parentElement
      const index = Array.from(viewport.children).indexOf(this)
      return new DOMRect(0, 100 + index * 60 - viewport.scrollTop, 250, 60)
    }
    return new DOMRect()
  })
})

function mount(initialMessages: Message[]) {
  const client = { sendMessage: vi.fn(() => true), report: vi.fn() } as unknown as ChatClient
  const view = render(<ChatPanel state={state} client={client}/>)
  const viewport = view.getByRole('log')
  let scrollTop = 0
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => 180 },
    scrollHeight: { configurable: true, get: () => viewport.children.length * 60 },
    scrollTop: {
      configurable: true,
      get: () => scrollTop,
      set: (value: number) => { scrollTop = Math.max(0, Math.min(value, viewport.scrollHeight - viewport.clientHeight)) },
    },
  })
  const update = (messages: Message[]) => view.rerender(<ChatPanel state={{ ...state, messages }} client={client}/>)
  const scroll = (top: number) => { viewport.scrollTop = top; fireEvent.scroll(viewport) }
  update(initialMessages)
  return { ...view, viewport, update, scroll }
}

describe('ChatPanel message reading', () => {
  it('follows incoming messages while the reader is at the bottom', () => {
    const previous = history(10)
    const view = mount(previous)
    expect(view.viewport.scrollTop).toBe(420)

    view.update([...previous, message(11)])

    expect(view.viewport.scrollTop).toBe(480)
    expect(view.queryByRole('button', { name: /새 메시지/ })).toBeNull()
  })

  it('keeps older messages in view and lets the reader jump to new messages', () => {
    const previous = history(10)
    const view = mount(previous)
    view.scroll(120)

    view.update([...previous, message(11)])

    expect(view.viewport.scrollTop).toBe(120)
    expect(view.getByText('메시지 3').getBoundingClientRect().top).toBe(100)
    fireEvent.click(view.getByRole('button', { name: /새 메시지/ }))
    expect(view.viewport.scrollTop).toBe(480)
    expect(view.queryByRole('button', { name: /새 메시지/ })).toBeNull()
  })

  it('returns to the bottom when the reader sends a message', () => {
    const previous = history(10)
    const view = mount(previous)
    view.scroll(120)

    view.update([...previous, message(11, 'mine')])

    expect(view.viewport.scrollTop).toBe(480)
  })

  it('preserves the visible message when the 150-message limit removes older rows', () => {
    const previous = history(150)
    const view = mount(previous)
    view.scroll(1200)
    expect(view.getByText('메시지 21').getBoundingClientRect().top).toBe(100)

    view.update([...previous.slice(2), message(151), message(152)])

    expect(view.viewport.scrollTop).toBe(1080)
    expect(view.getByText('메시지 21').getBoundingClientRect().top).toBe(100)
  })

  it('shows the earliest retained message if the message being read is removed', () => {
    const previous = history(150)
    const view = mount(previous)
    view.scroll(10)

    view.update([...previous.slice(1), message(151)])

    expect(view.viewport.scrollTop).toBe(0)
    expect(view.getByText('메시지 2').getBoundingClientRect().top).toBe(100)
  })

  it('clears the new-message prompt after manually scrolling to the bottom', () => {
    const previous = history(10)
    const view = mount(previous)
    view.scroll(120)
    view.update([...previous, message(11)])

    view.scroll(480)

    expect(view.queryByRole('button', { name: /새 메시지/ })).toBeNull()
    view.update([...previous, message(11), message(12)])
    expect(view.viewport.scrollTop).toBe(540)
  })

  it('clears the reading position when the previous conversation is replaced', () => {
    const view = mount(history(10))
    view.scroll(120)

    view.update([message(11, 'system')])

    expect(view.viewport.scrollTop).toBe(0)
    expect(view.queryByRole('button', { name: /새 메시지/ })).toBeNull()
    view.update(history(10))
    expect(view.viewport.scrollTop).toBe(420)
  })

  it('includes the sender in screen-reader message text', () => {
    const view = mount([message(1, 'mine'), message(2, 'theirs'), message(3, 'system')])

    expect(view.getByText('메시지 1').textContent).toBe('나: 메시지 1')
    expect(view.getByText('메시지 2').textContent).toBe('상대: 메시지 2')
    expect(view.getByText('메시지 3').textContent).toBe('안내: 메시지 3')
  })
})
