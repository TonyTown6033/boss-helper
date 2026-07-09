export interface CapturedMessage {
  index: number
  sender: string
  direction: 'self' | 'other' | 'system' | 'unknown'
  content: string
  time: string
  avatar: string
  className: string
}

export interface CapturePayload {
  title: string
  url: string
  capturedAt: string
  messages: CapturedMessage[]
}

export interface AutoChatLogEntry {
  id: number
  time: string
  level: 'info' | 'warn' | 'error'
  text: string
}
