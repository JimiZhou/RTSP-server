import { useEffect, useMemo, useState } from 'react'
import type {
  AppSettings,
  FFmpegCapabilities,
  RTSPServerStatus,
  StreamLogEvent,
  StreamTask,
  StreamTaskPayload,
  StreamStatus
} from '../../shared/types'

interface UILogLine {
  id: string
  source: string
  line: string
  timestamp: string
}

interface TaskFormState {
  name: string
  inputFile: string
  path: string
  transport: 'tcp' | 'udp'
  loop: boolean
  hwAccel: 'auto' | 'cpu' | 'qsv' | 'videotoolbox' | 'nvenc'
  videoCodec: 'copy' | 'h264' | 'hevc'
  audioCodec: 'copy' | 'aac' | 'opus' | 'none'
  bitrateKbps: string
  fps: string
}

const DEFAULT_SETTINGS: AppSettings = {
  listenHost: '127.0.0.1',
  listenPort: 8554,
  authUsername: 'rtspuser',
  authPassword: '',
  defaultHwAccelPolicy: 'auto'
}

const DEFAULT_TASK_FORM: TaskFormState = {
  name: '',
  inputFile: '',
  path: '',
  transport: 'tcp',
  loop: true,
  hwAccel: 'auto',
  videoCodec: 'h264',
  audioCodec: 'aac',
  bitrateKbps: '2500',
  fps: ''
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function statusClass(status: string): string {
  if (status === 'running') {
    return 'pill pill-green'
  }
  if (status === 'starting') {
    return 'pill pill-yellow'
  }
  if (status === 'error') {
    return 'pill pill-red'
  }
  return 'pill pill-gray'
}

function statusText(status: StreamStatus | RTSPServerStatus['state']): string {
  if (status === 'running') {
    return '运行中'
  }

  if (status === 'starting') {
    return '启动中'
  }

  if (status === 'stopped') {
    return '已停止'
  }

  if (status === 'error') {
    return '异常'
  }

  return '已创建'
}

function hwPolicyText(policy: TaskFormState['hwAccel'] | AppSettings['defaultHwAccelPolicy']): string {
  if (policy === 'auto') {
    return '自动'
  }

  if (policy === 'cpu') {
    return 'CPU'
  }

  if (policy === 'qsv') {
    return 'QSV'
  }

  if (policy === 'nvenc') {
    return 'NVENC'
  }

  return 'VideoToolbox'
}

function boolText(value: boolean): string {
  return value ? '支持' : '不可用'
}

function toTaskPayload(form: TaskFormState): StreamTaskPayload {
  const payload: StreamTaskPayload = {
    name: form.name.trim(),
    inputFile: form.inputFile.trim(),
    path: form.path.trim(),
    transport: form.transport,
    loop: form.loop,
    hwAccel: form.hwAccel,
    videoCodec: form.videoCodec,
    audioCodec: form.audioCodec
  }

  const bitrate = Number(form.bitrateKbps)
  if (Number.isFinite(bitrate) && bitrate > 0) {
    payload.bitrateKbps = Math.floor(bitrate)
  }

  const fps = Number(form.fps)
  if (Number.isFinite(fps) && fps > 0) {
    payload.fps = Math.floor(fps)
  }

  return payload
}

function derivePathFromFilename(filePath: string): string {
  const base = filePath.split('/').pop()?.split('\\').pop() || 'stream'
  const name = base.replace(/\.[^.]+$/, '')
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function upsertTask(list: StreamTask[], task: StreamTask): StreamTask[] {
  const index = list.findIndex((item) => item.id === task.id)
  if (index < 0) {
    return [task, ...list]
  }

  const next = [...list]
  next[index] = task
  return next
}

function shortTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('zh-CN')
  } catch {
    return iso
  }
}

export function App(): JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [notice, setNotice] = useState<string>('')
  const [error, setError] = useState<string>('')

  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS)
  const [serverStatus, setServerStatus] = useState<RTSPServerStatus>({ state: 'stopped' })
  const [tasks, setTasks] = useState<StreamTask[]>([])
  const [caps, setCaps] = useState<FFmpegCapabilities | null>(null)
  const [taskForm, setTaskForm] = useState<TaskFormState>(DEFAULT_TASK_FORM)
  const [logs, setLogs] = useState<UILogLine[]>([])

  const serverRunning = serverStatus.state === 'running' || serverStatus.state === 'starting'

  const streamCountLabel = useMemo(() => {
    const running = tasks.filter((task) => task.status === 'running' || task.status === 'starting').length
    return `${running}/${tasks.length}`
  }, [tasks])

  const capabilityHint = useMemo(() => {
    if (!caps) {
      return ''
    }

    const hasQsv = caps.hasQsvH264 || caps.hasQsvHevc
    const hasVideoToolbox = caps.hasVideoToolboxH264 || caps.hasVideoToolboxHevc

    if (hasQsv) {
      return '检测到 QSV，可使用 qsv 进行硬件编码。'
    }

    if (hasVideoToolbox) {
      return '当前 ffmpeg 检测到 VideoToolbox。macOS 上 Intel UHD630 通常走 VideoToolbox，而不是 qsv。建议选择“自动”或“videotoolbox”。'
    }

    return '未检测到 QSV/VideoToolbox/NVENC，当前将回退为 CPU 编码。'
  }, [caps])

  useEffect(() => {
    let alive = true

    if (!window.rtspApp) {
      setError('桌面 API 不可用：preload 初始化失败。')
      setLoaded(true)
      return () => undefined
    }

    const pushLog = (source: string, line: string, ts: string): void => {
      setLogs((prev) => {
        const next: UILogLine[] = [
          ...prev,
          {
            id: `${ts}-${Math.random().toString(16).slice(2)}`,
            source,
            line,
            timestamp: ts
          }
        ]

        return next.slice(-400)
      })
    }

    const boot = async (): Promise<void> => {
      try {
        const [loadedSettings, loadedTasks, loadedServerStatus, loadedCaps] = await Promise.all([
          window.rtspApp.getSettings(),
          window.rtspApp.getTasks(),
          window.rtspApp.getServerStatus(),
          window.rtspApp.scanCapabilities()
        ])

        if (!alive) {
          return
        }

        setSettings(loadedSettings)
        setTasks(loadedTasks)
        setServerStatus(loadedServerStatus)
        setCaps(loadedCaps)
      } catch (bootError) {
        if (!alive) {
          return
        }

        setError(toErrorMessage(bootError))
      } finally {
        if (alive) {
          setLoaded(true)
        }
      }
    }

    const offState = window.rtspApp.onStreamStateChanged((event) => {
      setTasks((prev) => upsertTask(prev, event.task))
    })

    const offStreamLog = window.rtspApp.onStreamLog((event: StreamLogEvent) => {
      pushLog(`任务:${event.taskId}`, event.line, event.timestamp)
    })

    const offServerLog = window.rtspApp.onServerLog((event) => {
      pushLog('服务', event.line, event.timestamp)
    })

    const offServerState = window.rtspApp.onServerStateChanged((event) => {
      setServerStatus(event)
    })

    void boot()

    return () => {
      alive = false
      offState()
      offStreamLog()
      offServerLog()
      offServerState()
    }
  }, [])

  const applyNotice = (text: string): void => {
    setNotice(text)
    setError('')
  }

  const applyError = (text: string): void => {
    setError(text)
    setNotice('')
  }

  const chooseFile = async (): Promise<void> => {
    try {
      const filePath = await window.rtspApp.openVideoFileDialog()
      if (!filePath) {
        return
      }

      setTaskForm((prev) => {
        const next = {
          ...prev,
          inputFile: filePath
        }

        if (!prev.path.trim()) {
          next.path = derivePathFromFilename(filePath)
        }

        if (!prev.name.trim()) {
          next.name = derivePathFromFilename(filePath)
        }

        return next
      })
    } catch (dialogError) {
      applyError(toErrorMessage(dialogError))
    }
  }

  const saveSettings = async (): Promise<void> => {
    try {
      setBusyKey('settings')
      const updated = await window.rtspApp.setSettings({
        ...settings,
        listenPort: Number(settings.listenPort)
      })
      setSettings(updated)
      applyNotice('设置已保存。若 RTSP 服务在运行，会自动重启生效。')
    } catch (saveError) {
      applyError(toErrorMessage(saveError))
    } finally {
      setBusyKey(null)
    }
  }

  const refreshCapabilities = async (): Promise<void> => {
    try {
      setBusyKey('capability')
      const scanned = await window.rtspApp.scanCapabilities(true)
      setCaps(scanned)
      applyNotice('硬件能力已刷新。')
    } catch (scanError) {
      applyError(toErrorMessage(scanError))
    } finally {
      setBusyKey(null)
    }
  }

  const startServer = async (): Promise<void> => {
    try {
      setBusyKey('server-start')
      const status = await window.rtspApp.startServer()
      setServerStatus(status)
      applyNotice('RTSP 服务已启动。')
    } catch (startError) {
      applyError(toErrorMessage(startError))
    } finally {
      setBusyKey(null)
    }
  }

  const stopServer = async (): Promise<void> => {
    try {
      setBusyKey('server-stop')
      const status = await window.rtspApp.stopServer()
      setServerStatus(status)
      applyNotice('RTSP 服务已停止。')
    } catch (stopError) {
      applyError(toErrorMessage(stopError))
    } finally {
      setBusyKey(null)
    }
  }

  const createTask = async (): Promise<void> => {
    try {
      if (!taskForm.inputFile.trim()) {
        throw new Error('请输入本地视频文件路径。')
      }

      if (!taskForm.path.trim()) {
        throw new Error('请输入 RTSP 路径。')
      }

      setBusyKey('task-create')
      const created = await window.rtspApp.createTask(toTaskPayload(taskForm))
      setTasks((prev) => [created, ...prev])
      setTaskForm((prev) => ({
        ...DEFAULT_TASK_FORM,
        hwAccel: prev.hwAccel,
        videoCodec: prev.videoCodec,
        audioCodec: prev.audioCodec,
        bitrateKbps: prev.bitrateKbps,
        fps: prev.fps
      }))
      applyNotice(`任务“${created.name}”创建成功。`)
    } catch (createError) {
      applyError(toErrorMessage(createError))
    } finally {
      setBusyKey(null)
    }
  }

  const startTask = async (id: string): Promise<void> => {
    try {
      setBusyKey(`task-start-${id}`)
      const updated = await window.rtspApp.startTask(id)
      setTasks((prev) => upsertTask(prev, updated))
    } catch (startError) {
      applyError(toErrorMessage(startError))
    } finally {
      setBusyKey(null)
    }
  }

  const stopTask = async (id: string): Promise<void> => {
    try {
      setBusyKey(`task-stop-${id}`)
      const updated = await window.rtspApp.stopTask(id)
      setTasks((prev) => upsertTask(prev, updated))
    } catch (stopError) {
      applyError(toErrorMessage(stopError))
    } finally {
      setBusyKey(null)
    }
  }

  const removeTask = async (id: string): Promise<void> => {
    try {
      setBusyKey(`task-remove-${id}`)
      await window.rtspApp.removeTask(id)
      setTasks((prev) => prev.filter((task) => task.id !== id))
    } catch (removeError) {
      applyError(toErrorMessage(removeError))
    } finally {
      setBusyKey(null)
    }
  }

  if (!loaded) {
    return <div className="loading-screen">正在加载 RTSP 推流器...</div>
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <h1>RTSP 推流器</h1>
        <p>Electron + FFmpeg + MediaMTX 本地视频 RTSP 推流工作台</p>
        <div className="hero-stats">
          <span className={statusClass(serverStatus.state)}>服务状态：{statusText(serverStatus.state)}</span>
          <span className="pill pill-gray">运行任务：{streamCountLabel}</span>
          <button className="btn btn-ghost" onClick={() => void refreshCapabilities()} disabled={busyKey === 'capability'}>
            重新检测硬件能力
          </button>
        </div>
      </header>

      {notice ? <div className="banner banner-success">{notice}</div> : null}
      {error ? <div className="banner banner-error">{error}</div> : null}

      <div className="grid-two">
        <section className="card">
          <h2>服务设置</h2>
          <div className="form-grid">
            <label>
              监听地址
              <input
                value={settings.listenHost}
                onChange={(event) => setSettings((prev) => ({ ...prev, listenHost: event.target.value }))}
              />
            </label>
            <label>
              监听端口
              <input
                type="number"
                min={1}
                max={65535}
                value={settings.listenPort}
                onChange={(event) => setSettings((prev) => ({ ...prev, listenPort: Number(event.target.value) }))}
              />
            </label>
            <label>
              鉴权用户名
              <input
                value={settings.authUsername}
                onChange={(event) => setSettings((prev) => ({ ...prev, authUsername: event.target.value }))}
              />
            </label>
            <label>
              鉴权密码
              <input
                value={settings.authPassword}
                onChange={(event) => setSettings((prev) => ({ ...prev, authPassword: event.target.value }))}
              />
            </label>
            <label>
              默认硬件策略
              <select
                value={settings.defaultHwAccelPolicy}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    defaultHwAccelPolicy: event.target.value as AppSettings['defaultHwAccelPolicy']
                  }))
                }
              >
                <option value="auto">自动（auto）</option>
                <option value="cpu">CPU</option>
                <option value="qsv">Intel QSV</option>
                <option value="videotoolbox">VideoToolbox (macOS)</option>
                <option value="nvenc">NVIDIA NVENC</option>
              </select>
            </label>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={() => void saveSettings()} disabled={busyKey === 'settings'}>
              保存设置
            </button>
            <button className="btn" onClick={() => void startServer()} disabled={serverRunning || busyKey === 'server-start'}>
              启动 RTSP 服务
            </button>
            <button className="btn btn-danger" onClick={() => void stopServer()} disabled={!serverRunning || busyKey === 'server-stop'}>
              停止 RTSP 服务
            </button>
          </div>
          {serverStatus.lastError ? <p className="error-text">{serverStatus.lastError}</p> : null}
        </section>

        <section className="card">
          <h2>新建推流任务</h2>
          <div className="form-grid">
            <label>
              任务名称
              <input
                value={taskForm.name}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, name: event.target.value }))}
                placeholder="例如：演示片头"
              />
            </label>
            <label>
              RTSP 路径
              <input
                value={taskForm.path}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, path: event.target.value }))}
                placeholder="例如：demo-stream"
              />
            </label>
            <label className="span-2">
              本地视频文件
              <div className="file-row">
                <input
                  value={taskForm.inputFile}
                  onChange={(event) => setTaskForm((prev) => ({ ...prev, inputFile: event.target.value }))}
                  placeholder="/path/to/video.mp4"
                />
                <button className="btn btn-ghost" onClick={() => void chooseFile()}>
                  浏览
                </button>
              </div>
            </label>
            <label>
              传输协议
              <select
                value={taskForm.transport}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, transport: event.target.value as 'tcp' | 'udp' }))}
              >
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
              </select>
            </label>
            <label>
              硬件策略
              <select
                value={taskForm.hwAccel}
                onChange={(event) =>
                  setTaskForm((prev) => ({ ...prev, hwAccel: event.target.value as TaskFormState['hwAccel'] }))
                }
              >
                <option value="auto">自动（auto）</option>
                <option value="cpu">CPU</option>
                <option value="qsv">Intel QSV</option>
                <option value="videotoolbox">VideoToolbox (macOS)</option>
                <option value="nvenc">NVIDIA NVENC</option>
              </select>
            </label>
            <label>
              视频编码
              <select
                value={taskForm.videoCodec}
                onChange={(event) =>
                  setTaskForm((prev) => ({ ...prev, videoCodec: event.target.value as TaskFormState['videoCodec'] }))
                }
              >
                <option value="h264">h264</option>
                <option value="hevc">hevc</option>
                <option value="copy">copy（直拷）</option>
              </select>
            </label>
            <label>
              音频编码
              <select
                value={taskForm.audioCodec}
                onChange={(event) =>
                  setTaskForm((prev) => ({ ...prev, audioCodec: event.target.value as TaskFormState['audioCodec'] }))
                }
              >
                <option value="aac">aac</option>
                <option value="opus">opus</option>
                <option value="copy">copy（直拷）</option>
                <option value="none">none（禁用音频）</option>
              </select>
            </label>
            <label>
              视频码率 (kbps)
              <input
                type="number"
                min={100}
                value={taskForm.bitrateKbps}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, bitrateKbps: event.target.value }))}
              />
            </label>
            <label>
              FPS
              <input
                type="number"
                min={1}
                value={taskForm.fps}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, fps: event.target.value }))}
              />
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={taskForm.loop}
                onChange={(event) => setTaskForm((prev) => ({ ...prev, loop: event.target.checked }))}
              />
              循环播放
            </label>
          </div>
          <div className="toolbar">
            <button className="btn" onClick={() => void createTask()} disabled={busyKey === 'task-create'}>
              添加任务
            </button>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>推流任务列表</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>状态</th>
                <th>输入文件</th>
                <th>RTSP 地址</th>
                <th>硬件策略</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {tasks.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty-row">
                    暂无任务。
                  </td>
                </tr>
              ) : (
                tasks.map((task) => {
                  const isRunning = task.status === 'running' || task.status === 'starting'
                  const streamUrl = `rtsp://${settings.listenHost}:${settings.listenPort}/${task.path}`
                  return (
                    <tr key={task.id}>
                      <td>
                        <strong>{task.name}</strong>
                        <div className="subtle">{task.path}</div>
                      </td>
                      <td>
                        <span className={statusClass(task.status)}>{statusText(task.status)}</span>
                        {task.lastError ? <div className="error-text">{task.lastError}</div> : null}
                      </td>
                      <td className="mono">{task.inputFile}</td>
                      <td className="mono">{streamUrl}</td>
                      <td>{hwPolicyText(task.hwAccel)}</td>
                      <td>
                        <div className="actions">
                          <button
                            className="btn"
                            onClick={() => void startTask(task.id)}
                            disabled={isRunning || busyKey === `task-start-${task.id}`}
                          >
                            启动
                          </button>
                          <button
                            className="btn"
                            onClick={() => void stopTask(task.id)}
                            disabled={!isRunning || busyKey === `task-stop-${task.id}`}
                          >
                            停止
                          </button>
                          <button
                            className="btn btn-danger"
                            onClick={() => void removeTask(task.id)}
                            disabled={busyKey === `task-remove-${task.id}`}
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>运行能力检测</h2>
        <div className="cap-grid">
          <div>
            <div className="label">FFmpeg 路径</div>
            <div className="mono">{caps?.ffmpegPath || '-'}</div>
          </div>
          <div>
            <div className="label">FFmpeg 可用</div>
            <div>{caps?.available ? '是' : '否'}</div>
          </div>
          <div>
            <div className="label">NVENC</div>
            <div>{boolText(Boolean(caps && (caps.hasNvencH264 || caps.hasNvencHevc)))}</div>
          </div>
          <div>
            <div className="label">QSV</div>
            <div>{boolText(Boolean(caps && (caps.hasQsvH264 || caps.hasQsvHevc)))}</div>
          </div>
          <div>
            <div className="label">VideoToolbox</div>
            <div>{boolText(Boolean(caps && (caps.hasVideoToolboxH264 || caps.hasVideoToolboxHevc)))}</div>
          </div>
          <div>
            <div className="label">默认策略</div>
            <div>{hwPolicyText(settings.defaultHwAccelPolicy)}</div>
          </div>
        </div>
        {capabilityHint ? <p className="subtle">{capabilityHint}</p> : null}
        {caps?.lastError ? <p className="error-text">{caps.lastError}</p> : null}
      </section>

      <section className="card log-card">
        <h2>实时日志</h2>
        <div className="log-box">
          {logs.length === 0 ? (
            <div className="subtle">暂无日志。</div>
          ) : (
            logs.map((line) => (
              <div key={line.id} className="log-line">
                <span className="log-ts">{shortTime(line.timestamp)}</span>
                <span className="log-source">{line.source}</span>
                <span className="log-text">{line.line}</span>
              </div>
            ))
          )}
        </div>
      </section>
    </div>
  )
}
