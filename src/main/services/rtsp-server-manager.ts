import { access, mkdir, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { spawn, ChildProcessByStdio } from 'node:child_process'
import readline from 'node:readline'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import { AppSettings, RTSPServerStatus } from '../../shared/types'
import { ensureExecutable } from './binary-resolver'

interface RTSPServerManagerOptions {
  mediamtxPath: string
  runtimeDir: string
}

interface RTSPServerEvents {
  log: (line: string) => void
  stateChanged: (status: RTSPServerStatus) => void
}

function yamlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function renderConfig(settings: AppSettings): string {
  const lines = [
    'logLevel: info',
    `rtspAddress: ${settings.listenHost}:${settings.listenPort}`,
    'rtspTransports: [tcp, udp]',
    'rtspEncryption: "no"'
  ]

  if (settings.enableAuth) {
    lines.push(
      'authMethod: internal',
      'authInternalUsers:',
      `  - user: ${yamlQuote(settings.authUsername)}`,
      `    pass: ${yamlQuote(settings.authPassword)}`,
      '    permissions:',
      '      - action: publish',
      '      - action: read'
    )
  } else {
    lines.push(
      'authMethod: internal',
      'authInternalUsers:',
      '  - user: any',
      '    permissions:',
      '      - action: publish',
      '      - action: read'
    )
  }

  lines.push('paths:', '  all_others:', '    source: publisher')

  return lines.join('\n')
}

export class RTSPServerManager extends EventEmitter {
  private process: ChildProcessByStdio<null, Readable, Readable> | null = null

  private status: RTSPServerStatus = {
    state: 'stopped'
  }

  private stopRequested = false

  private readonly mediamtxPath: string

  private readonly runtimeDir: string

  constructor(options: RTSPServerManagerOptions) {
    super()
    this.mediamtxPath = options.mediamtxPath
    this.runtimeDir = options.runtimeDir
  }

  override on<U extends keyof RTSPServerEvents>(event: U, listener: RTSPServerEvents[U]): this {
    return super.on(event, listener)
  }

  getStatus(): RTSPServerStatus {
    return { ...this.status }
  }

  async start(settings: AppSettings): Promise<RTSPServerStatus> {
    if (this.process && (this.status.state === 'running' || this.status.state === 'starting')) {
      return this.getStatus()
    }

    await this.ensureBinaryAvailable()
    await mkdir(this.runtimeDir, { recursive: true })

    const configPath = path.join(this.runtimeDir, 'mediamtx.yml')
    await writeFile(configPath, renderConfig(settings), 'utf-8')

    this.setStatus({ state: 'starting' })
    this.stopRequested = false

    const child = spawn(this.mediamtxPath, [configPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.process = child

    child.once('spawn', () => {
      this.setStatus({ state: 'running', pid: child.pid ?? undefined })
    })

    child.once('error', (error) => {
      this.setStatus({
        state: 'error',
        lastError: `MediaMTX failed to spawn: ${error.message}`
      })
      this.process = null
    })

    child.once('close', (code, signal) => {
      const normalStop = this.stopRequested

      if (normalStop) {
        this.setStatus({ state: 'stopped' })
      } else {
        this.setStatus({
          state: 'error',
          lastError: `MediaMTX exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
        })
      }

      this.process = null
      this.stopRequested = false
    })

    const stdoutReader = readline.createInterface({ input: child.stdout })
    const stderrReader = readline.createInterface({ input: child.stderr })

    stdoutReader.on('line', (line) => {
      this.emit('log', `[mediamtx:stdout] ${line}`)
    })

    stderrReader.on('line', (line) => {
      this.emit('log', `[mediamtx:stderr] ${line}`)
    })

    return this.getStatus()
  }

  async restart(settings: AppSettings): Promise<RTSPServerStatus> {
    await this.stop()
    return this.start(settings)
  }

  async stop(): Promise<RTSPServerStatus> {
    if (!this.process) {
      this.setStatus({ state: 'stopped' })
      return this.getStatus()
    }

    this.stopRequested = true

    const child = this.process
    child.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill('SIGKILL')
        }
        resolve()
      }, 3000)

      child.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    return this.getStatus()
  }

  private async ensureBinaryAvailable(): Promise<void> {
    try {
      await access(this.mediamtxPath, constants.R_OK)
      await ensureExecutable(this.mediamtxPath)
    } catch {
      throw new Error(`MediaMTX binary not found: ${this.mediamtxPath}`)
    }
  }

  private setStatus(status: RTSPServerStatus): void {
    this.status = status
    this.emit('stateChanged', this.getStatus())
  }
}
