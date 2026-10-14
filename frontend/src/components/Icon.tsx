import type { ReactNode } from 'react'

const paths: Record<string, ReactNode> = {
  camera: <><rect x="3" y="6" width="12" height="12" rx="3"/><path d="m15 10 6-3v10l-6-3"/></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/></>,
  next: <path d="m5 6 9 6-9 6V6Zm13 0v12"/>,
  phone: <path d="M3 15c5-6 13-6 18 0l-3 4-4-2v-3h-4v3l-4 2-3-4Z"/>,
  send: <path d="m3 3 18 9-18 9 3-9-3-9Zm3 9h15"/>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
  link: <path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3m1 7 8-10"/>,
}

export function Icon({ name }: { name: string }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>
}
