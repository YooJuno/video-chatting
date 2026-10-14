import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChatClient } from '../chat/ChatClient'

export function useVideoChat() {
  const [client] = useState(() => new ChatClient())
  const state = useSyncExternalStore(client.subscribe, client.snapshot)
  useEffect(() => {
    void client.connect()
    const cleanup = () => client.dispose()
    window.addEventListener('pagehide', cleanup)
    return () => { window.removeEventListener('pagehide', cleanup); cleanup() }
  }, [client])
  return { state, client }
}
