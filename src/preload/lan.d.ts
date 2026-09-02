interface LanStatus {
  running: boolean
  ip: string | null
  port: number | null
  url: string | null
  dir: string | null
  token: string | null
  requireToken: boolean
  ips: string[]
}

interface LanClipSlot {
  id: string
  label: string
  text: string
  updatedAt: number
}

interface LanClipsState {
  revision: number
  slots: LanClipSlot[]
}

interface LanClipImagePayload {
  mime: string
  dataBase64: string
}
