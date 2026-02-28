import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import {
  AppConfig,
  AppSettings,
  StreamStatus,
  StreamTask,
  StreamTaskPayload
} from '../../shared/types'

const CONFIG_VERSION = 1

function createPassword(): string {
  return crypto.randomBytes(9).toString('base64url')
}

function defaultSettings(): AppSettings {
  return {
    listenHost: '127.0.0.1',
    listenPort: 8554,
    authUsername: 'rtspuser',
    authPassword: createPassword(),
    defaultHwAccelPolicy: 'auto'
  }
}

function normalizePathSegment(value: string): string {
  const trimmed = value.trim().replace(/^\/+/, '').replace(/\s+/g, '-')
  return trimmed
}

function nowIso(): string {
  return new Date().toISOString()
}

function toFiniteInt(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined
  }

  return Math.floor(parsed)
}

function toStreamStatus(value: unknown): StreamStatus {
  if (value === 'created' || value === 'starting' || value === 'running' || value === 'stopped' || value === 'error') {
    return value
  }

  return 'created'
}

function normalizeTask(raw: Partial<StreamTask>): StreamTask | null {
  if (!raw.id || !raw.name || !raw.inputFile || !raw.path) {
    return null
  }

  const pathSegment = normalizePathSegment(raw.path)
  if (!pathSegment) {
    return null
  }

  const createdAt = raw.createdAt || nowIso()
  const updatedAt = raw.updatedAt || createdAt

  return {
    id: raw.id,
    name: raw.name,
    inputFile: raw.inputFile,
    path: pathSegment,
    transport: raw.transport === 'udp' ? 'udp' : 'tcp',
    loop: Boolean(raw.loop),
    hwAccel:
      raw.hwAccel === 'cpu' || raw.hwAccel === 'qsv' || raw.hwAccel === 'nvenc' || raw.hwAccel === 'videotoolbox'
        ? raw.hwAccel
        : 'auto',
    videoCodec: raw.videoCodec === 'copy' || raw.videoCodec === 'hevc' ? raw.videoCodec : 'h264',
    audioCodec:
      raw.audioCodec === 'copy' || raw.audioCodec === 'opus' || raw.audioCodec === 'none' ? raw.audioCodec : 'aac',
    bitrateKbps: toFiniteInt(raw.bitrateKbps),
    fps: toFiniteInt(raw.fps),
    status: toStreamStatus(raw.status),
    lastError: raw.lastError,
    createdAt,
    updatedAt
  }
}

export class SettingsStore {
  private readonly configPath: string

  private config: AppConfig | null = null

  private saveQueue: Promise<void> = Promise.resolve()

  constructor(userDataPath: string) {
    this.configPath = path.join(userDataPath, 'config.json')
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.configPath), { recursive: true })

    try {
      const raw = await fs.readFile(this.configPath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<AppConfig>
      this.config = this.normalizeConfig(parsed)
      await this.persist()
    } catch {
      this.config = {
        version: CONFIG_VERSION,
        settings: defaultSettings(),
        tasks: []
      }
      await this.persist()
    }
  }

  getSettings(): AppSettings {
    return { ...this.getConfig().settings }
  }

  getTasks(): StreamTask[] {
    return this.getConfig().tasks.map((task) => ({ ...task }))
  }

  async updateSettings(partial: Partial<AppSettings>): Promise<AppSettings> {
    const config = this.getConfig()

    const next: AppSettings = {
      ...config.settings,
      ...partial
    }

    if (!next.listenHost) {
      throw new Error('listenHost is required')
    }

    if (!Number.isInteger(next.listenPort) || next.listenPort <= 0 || next.listenPort > 65535) {
      throw new Error('listenPort must be between 1 and 65535')
    }

    if (!next.authUsername) {
      throw new Error('authUsername is required')
    }

    if (!next.authPassword) {
      throw new Error('authPassword is required')
    }

    config.settings = next
    await this.persist()
    return { ...next }
  }

  async createTask(payload: StreamTaskPayload): Promise<StreamTask> {
    const config = this.getConfig()
    const createdAt = nowIso()
    const pathSegment = normalizePathSegment(payload.path)

    if (!pathSegment) {
      throw new Error('RTSP path is required')
    }

    if (!payload.inputFile.trim()) {
      throw new Error('Input file is required')
    }

    if (config.tasks.some((item) => item.path === pathSegment)) {
      throw new Error(`RTSP path '${pathSegment}' already exists`)
    }

    const task: StreamTask = {
      id: crypto.randomUUID(),
      name: payload.name.trim() || pathSegment,
      inputFile: payload.inputFile.trim(),
      path: pathSegment,
      transport: payload.transport,
      loop: payload.loop,
      hwAccel: payload.hwAccel,
      videoCodec: payload.videoCodec,
      audioCodec: payload.audioCodec,
      bitrateKbps: toFiniteInt(payload.bitrateKbps),
      fps: toFiniteInt(payload.fps),
      status: 'created',
      createdAt,
      updatedAt: createdAt
    }

    config.tasks.push(task)
    await this.persist()
    return { ...task }
  }

  async updateTask(id: string, payload: Partial<StreamTaskPayload>): Promise<StreamTask> {
    const config = this.getConfig()
    const task = config.tasks.find((item) => item.id === id)

    if (!task) {
      throw new Error(`Task ${id} not found`)
    }

    const nextPath = payload.path !== undefined ? normalizePathSegment(payload.path) : task.path
    if (!nextPath) {
      throw new Error('RTSP path is required')
    }

    if (config.tasks.some((item) => item.id !== id && item.path === nextPath)) {
      throw new Error(`RTSP path '${nextPath}' already exists`)
    }

    if (payload.inputFile !== undefined) {
      if (!payload.inputFile.trim()) {
        throw new Error('Input file is required')
      }
      task.inputFile = payload.inputFile.trim()
    }

    if (payload.name !== undefined) {
      task.name = payload.name.trim() || nextPath
    }

    task.path = nextPath

    if (payload.transport !== undefined) {
      task.transport = payload.transport
    }

    if (payload.loop !== undefined) {
      task.loop = payload.loop
    }

    if (payload.hwAccel !== undefined) {
      task.hwAccel = payload.hwAccel
    }

    if (payload.videoCodec !== undefined) {
      task.videoCodec = payload.videoCodec
    }

    if (payload.audioCodec !== undefined) {
      task.audioCodec = payload.audioCodec
    }

    if (payload.bitrateKbps !== undefined) {
      task.bitrateKbps = toFiniteInt(payload.bitrateKbps)
    }

    if (payload.fps !== undefined) {
      task.fps = toFiniteInt(payload.fps)
    }

    task.updatedAt = nowIso()

    await this.persist()
    return { ...task }
  }

  async removeTask(id: string): Promise<boolean> {
    const config = this.getConfig()
    const previousLength = config.tasks.length
    config.tasks = config.tasks.filter((task) => task.id !== id)

    if (config.tasks.length === previousLength) {
      return false
    }

    await this.persist()
    return true
  }

  async updateTaskRuntimeState(id: string, status: StreamStatus, lastError?: string): Promise<StreamTask> {
    const config = this.getConfig()
    const task = config.tasks.find((item) => item.id === id)

    if (!task) {
      throw new Error(`Task ${id} not found`)
    }

    task.status = status
    task.lastError = lastError
    task.updatedAt = nowIso()

    await this.persist()
    return { ...task }
  }

  private getConfig(): AppConfig {
    if (!this.config) {
      throw new Error('SettingsStore is not initialized')
    }

    return this.config
  }

  private normalizeConfig(raw: Partial<AppConfig>): AppConfig {
    const settingsRaw: Partial<AppSettings> = raw.settings ?? {}

    const settings: AppSettings = {
      listenHost: settingsRaw.listenHost || '127.0.0.1',
      listenPort:
        Number.isInteger(settingsRaw.listenPort) && (settingsRaw.listenPort as number) > 0
          ? (settingsRaw.listenPort as number)
          : 8554,
      authUsername: settingsRaw.authUsername || 'rtspuser',
      authPassword: settingsRaw.authPassword || createPassword(),
      defaultHwAccelPolicy:
        settingsRaw.defaultHwAccelPolicy === 'cpu' ||
        settingsRaw.defaultHwAccelPolicy === 'qsv' ||
        settingsRaw.defaultHwAccelPolicy === 'videotoolbox' ||
        settingsRaw.defaultHwAccelPolicy === 'nvenc'
          ? settingsRaw.defaultHwAccelPolicy
          : 'auto'
    }

    const tasks = Array.isArray(raw.tasks)
      ? raw.tasks
          .map((task) => normalizeTask(task as Partial<StreamTask>))
          .filter((task): task is StreamTask => Boolean(task))
          .map((task) => {
            if (task.status === 'running' || task.status === 'starting') {
              return { ...task, status: 'stopped' as StreamStatus }
            }
            return task
          })
      : []

    return {
      version: CONFIG_VERSION,
      settings,
      tasks
    }
  }

  private async persist(): Promise<void> {
    const config = this.getConfig()

    const content = JSON.stringify(config, null, 2)

    this.saveQueue = this.saveQueue.then(async () => {
      await fs.writeFile(this.configPath, content, 'utf-8')
    })

    await this.saveQueue
  }
}
