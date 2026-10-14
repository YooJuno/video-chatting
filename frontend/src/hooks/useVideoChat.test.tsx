import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useVideoChat } from './useVideoChat'

const lifecycle = vi.hoisted(() => ({ connect: vi.fn(), dispose: vi.fn() }))
vi.mock('../chat/ChatClient', () => ({
  ChatClient: class {
    connect = lifecycle.connect
    dispose = lifecycle.dispose
    snapshot = () => null
    subscribe = () => () => {}
  },
}))

describe('useVideoChat page lifecycle', () => {
  beforeEach(() => { lifecycle.connect.mockResolvedValue(undefined) })

  it('disposes on pagehide and reconnects only when restored from the back-forward cache', () => {
    const { unmount } = renderHook(useVideoChat)
    expect(lifecycle.connect).toHaveBeenCalledOnce()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })) })
    expect(lifecycle.dispose).toHaveBeenCalledOnce()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false })) })
    expect(lifecycle.connect).toHaveBeenCalledOnce()
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(lifecycle.connect).toHaveBeenCalledTimes(2)
    unmount()
    expect(lifecycle.dispose).toHaveBeenCalledTimes(2)
    act(() => {
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
    })
    expect(lifecycle.connect).toHaveBeenCalledTimes(2)
    expect(lifecycle.dispose).toHaveBeenCalledTimes(2)
  })
})
