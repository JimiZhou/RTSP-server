export type StreamStatus = 'created' | 'starting' | 'running' | 'stopped' | 'error'

export type HwAccelPolicy = 'auto' | 'cpu' | 'qsv' | 'videotoolbox' | 'nvenc'

export type VideoCodec = 'copy' | 'h264' | 'hevc'

export type AudioCodec = 'copy' | 'aac' | 'opus' | 'none'

export type RtspTransport = 'tcp' | 'udp'

export type RTSPServerState = 'stopped' | 'starting' | 'running' | 'error'

export interface StreamTask {
  id: string
  name: string
  inputFile: string
  path: string
  transport: RtspTransport
  loop: boolean
  hwAccel: HwAccelPolicy
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  bitrateKbps?: number
  fps?: number
  status: StreamStatus
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface StreamTaskPayload {
  name: string
  inputFile: string
  path: string
  transport: RtspTransport
  loop: boolean
  hwAccel: HwAccelPolicy
  videoCodec: VideoCodec
  audioCodec: AudioCodec
  bitrateKbps?: number
  fps?: number
}

export interface AppSettings {
  listenHost: string
  listenPort: number
  enableAuth: boolean
  authUsername: string
  authPassword: string
  defaultHwAccelPolicy: HwAccelPolicy
}

export interface AppConfig {
  version: number
  settings: AppSettings
  tasks: StreamTask[]
}

export interface RTSPServerStatus {
  state: RTSPServerState
  pid?: number
  lastError?: string
}

export interface FFmpegCapabilities {
  available: boolean
  ffmpegPath: string
  hwaccels: string[]
  encoders: string[]
  hasQsvH264: boolean
  hasQsvHevc: boolean
  hasVideoToolboxH264: boolean
  hasVideoToolboxHevc: boolean
  hasNvencH264: boolean
  hasNvencHevc: boolean
  lastError?: string
}

export interface StreamStateChangedEvent {
  task: StreamTask
}

export interface StreamLogEvent {
  taskId: string
  line: string
  timestamp: string
}

export interface ServerLogEvent {
  line: string
  timestamp: string
}

export interface RTSPDesktopApi {
  getSettings: () => Promise<AppSettings>
  setSettings: (payload: Partial<AppSettings>) => Promise<AppSettings>
  getTasks: () => Promise<StreamTask[]>
  createTask: (payload: StreamTaskPayload) => Promise<StreamTask>
  updateTask: (id: string, payload: Partial<StreamTaskPayload>) => Promise<StreamTask>
  removeTask: (id: string) => Promise<boolean>
  startTask: (id: string) => Promise<StreamTask>
  stopTask: (id: string) => Promise<StreamTask>
  openVideoFileDialog: () => Promise<string | null>
  scanCapabilities: (force?: boolean) => Promise<FFmpegCapabilities>
  getServerStatus: () => Promise<RTSPServerStatus>
  startServer: () => Promise<RTSPServerStatus>
  stopServer: () => Promise<RTSPServerStatus>
  onStreamStateChanged: (cb: (event: StreamStateChangedEvent) => void) => () => void
  onStreamLog: (cb: (event: StreamLogEvent) => void) => () => void
  onServerLog: (cb: (event: ServerLogEvent) => void) => () => void
  onServerStateChanged: (cb: (event: RTSPServerStatus) => void) => () => void
}
