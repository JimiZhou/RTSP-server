import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn, ChildProcessByStdio } from 'node:child_process'
import readline from 'node:readline'
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import {
  AppSettings,
  FFmpegCapabilities,
  StreamLogEvent,
  StreamStateChangedEvent,
  StreamTask,
  StreamTaskPayload
} from '../../shared/types'
import { ensureExecutable } from './binary-resolver'
import { buildFFmpegCommand } from './ffmpeg-command-builder'
import { SettingsStore } from './settings-store'

interface StreamJobManagerOptions {
  ffmpegPath: string
  store: SettingsStore
}

interface StreamJobManagerEvents {
  log: (event: StreamLogEvent) => void
  stateChanged: (event: StreamStateChangedEvent) => void
}

function timestamp(): string {
  return new Date().toISOString()
}

function shouldSuppressFfmpegLog(line: string): boolean {
  const noisyPatterns = [
    /invalid nal unit/i,
    /could not find codec parameters for stream .*unknown/i,
    /deprecated pixel format used/i,
    /this device does not support the qmin option/i,
    /this device does not support the qmax option/i
  ]

  return noisyPatterns.some((pattern) => pattern.test(line))
}

export class StreamJobManager extends EventEmitter {
  private readonly ffmpegPath: string

  private readonly store: SettingsStore

  private readonly jobs = new Map<string, ChildProcessByStdio<null, Readable, Readable>>()

  private readonly stopping = new Set<string>()

  constructor(options: StreamJobManagerOptions) {
    super()
    this.ffmpegPath = options.ffmpegPath
    this.store = options.store
  }

  override on<U extends keyof StreamJobManagerEvents>(event: U, listener: StreamJobManagerEvents[U]): this {
    return super.on(event, listener)
  }

  listTasks(): StreamTask[] {
    return this.store.getTasks()
  }

  async createTask(payload: StreamTaskPayload): Promise<StreamTask> {
    return this.store.createTask(payload)
  }

  async updateTask(id: string, payload: Partial<StreamTaskPayload>): Promise<StreamTask> {
    if (this.jobs.has(id)) {
      throw new Error('Stop the task before editing')
    }

    return this.store.updateTask(id, payload)
  }

  async removeTask(id: string): Promise<boolean> {
    if (this.jobs.has(id)) {
      await this.stopTask(id)
    }

    return this.store.removeTask(id)
  }

  async startTask(id: string, settings: AppSettings, capabilities: FFmpegCapabilities): Promise<StreamTask> {
    if (this.jobs.has(id)) {
      const task = this.store.getTasks().find((item) => item.id === id)
      if (!task) {
        throw new Error(`Task ${id} not found`)
      }
      return task
    }

    await this.ensureBinaryAvailable()

    const task = this.store.getTasks().find((item) => item.id === id)
    if (!task) {
      throw new Error(`Task ${id} not found`)
    }

    await access(task.inputFile, constants.R_OK)

    const built = buildFFmpegCommand(task, settings, capabilities)

    const starting = await this.store.updateTaskRuntimeState(id, 'starting')
    this.emitState(starting)

    const processRef = spawn(this.ffmpegPath, built.args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    this.jobs.set(id, processRef)

    processRef.once('spawn', async () => {
      const running = await this.store.updateTaskRuntimeState(id, 'running')
      this.emitLog({ taskId: id, line: `Started stream to ${built.outputUrl} via ${built.videoEncoder}`, timestamp: timestamp() })
      this.emitState(running)
    })

    processRef.once('error', async (error) => {
      this.jobs.delete(id)
      this.stopping.delete(id)

      const failed = await this.store.updateTaskRuntimeState(id, 'error', `Failed to start ffmpeg: ${error.message}`)
      this.emitLog({ taskId: id, line: `Process spawn error: ${error.message}`, timestamp: timestamp() })
      this.emitState(failed)
    })

    processRef.once('close', async (code, signal) => {
      this.jobs.delete(id)
      const wasStopping = this.stopping.has(id)
      this.stopping.delete(id)

      if (wasStopping || code === 0) {
        const stopped = await this.store.updateTaskRuntimeState(id, 'stopped')
        this.emitState(stopped)
        this.emitLog({ taskId: id, line: `Stopped (code=${code ?? 'null'}, signal=${signal ?? 'null'})`, timestamp: timestamp() })
        return
      }

      const failed = await this.store.updateTaskRuntimeState(
        id,
        'error',
        `Exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
      )
      this.emitState(failed)
      this.emitLog({
        taskId: id,
        line: `Exited unexpectedly (code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
        timestamp: timestamp()
      })
    })

    const stdoutReader = readline.createInterface({ input: processRef.stdout })
    const stderrReader = readline.createInterface({ input: processRef.stderr })

    stdoutReader.on('line', (line) => {
      if (shouldSuppressFfmpegLog(line)) {
        return
      }
      this.emitLog({ taskId: id, line: `[stdout] ${line}`, timestamp: timestamp() })
    })

    stderrReader.on('line', (line) => {
      if (shouldSuppressFfmpegLog(line)) {
        return
      }
      this.emitLog({ taskId: id, line: `[stderr] ${line}`, timestamp: timestamp() })
    })

    return this.store.getTasks().find((item) => item.id === id) ?? starting
  }

  async stopTask(id: string): Promise<StreamTask> {
    const task = this.store.getTasks().find((item) => item.id === id)

    if (!task) {
      throw new Error(`Task ${id} not found`)
    }

    const processRef = this.jobs.get(id)
    if (!processRef) {
      if (task.status !== 'stopped') {
        const stopped = await this.store.updateTaskRuntimeState(id, 'stopped')
        this.emitState(stopped)
        return stopped
      }

      return task
    }

    this.stopping.add(id)
    processRef.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (processRef.exitCode === null) {
          processRef.kill('SIGKILL')
        }
        resolve()
      }, 3000)

      processRef.once('close', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    return this.store.getTasks().find((item) => item.id === id) ?? task
  }

  async stopAll(): Promise<void> {
    const runningIds = [...this.jobs.keys()]
    for (const id of runningIds) {
      await this.stopTask(id)
    }
  }

  private emitLog(event: StreamLogEvent): void {
    this.emit('log', event)
  }

  private emitState(task: StreamTask): void {
    this.emit('stateChanged', { task })
  }

  private async ensureBinaryAvailable(): Promise<void> {
    try {
      await access(this.ffmpegPath, constants.R_OK)
      await ensureExecutable(this.ffmpegPath)
    } catch {
      throw new Error(`FFmpeg binary not found: ${this.ffmpegPath}`)
    }
  }
}
