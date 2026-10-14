import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChatClient } from '../chat/ChatClient'

export function useVideoChat() {
  const [client] = useState(() => new ChatClient())
  const state = useSyncExternalStore(client.subscribe, client.snapshot)
  useEffect(() => {
    void client.connect()
    const cleanup = () => client.dispose()
    const restore = (event: PageTransitionEvent) => { if (event.persisted) void client.connect() }
    window.addEventListener('pagehide', cleanup)
    window.addEventListener('pageshow', restore)
    return () => {
      window.removeEventListener('pagehide', cleanup)
      window.removeEventListener('pageshow', restore)
      cleanup()
    }
  }, [client])
  return { state, client }
}
