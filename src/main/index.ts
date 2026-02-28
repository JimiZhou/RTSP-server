import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import {
  AppSettings,
  FFmpegCapabilities,
  RTSPServerStatus,
  ServerLogEvent,
  StreamLogEvent,
  StreamStateChangedEvent,
  StreamTask,
  StreamTaskPayload
} from '../shared/types'
import { resolveBinaryPaths } from './services/binary-resolver'
import { FFmpegCapabilityDetector } from './services/ffmpeg-capability-detector'
import { RTSPServerManager } from './services/rtsp-server-manager'
import { SettingsStore } from './services/settings-store'
import { StreamJobManager } from './services/stream-job-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let mainWindow: BrowserWindow | null = null
let store: SettingsStore
let rtspServerManager: RTSPServerManager
let streamJobManager: StreamJobManager
let capabilityDetector: FFmpegCapabilityDetector
let cachedCapabilities: FFmpegCapabilities | null = null

function timestamp(): string {
  return new Date().toISOString()
}

function emitToRenderers(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, payload)
    }
  }
}

async function createServices(): Promise<void> {
  store = new SettingsStore(app.getPath('userData'))
  await store.init()

  const binaries = resolveBinaryPaths()

  rtspServerManager = new RTSPServerManager({
    mediamtxPath: binaries.mediamtxPath,
    runtimeDir: path.join(app.getPath('userData'), 'runtime')
  })

  streamJobManager = new StreamJobManager({
    ffmpegPath: binaries.ffmpegPath,
    store
  })

  capabilityDetector = new FFmpegCapabilityDetector(binaries.ffmpegPath)

  rtspServerManager.on('log', (line) => {
    const event: ServerLogEvent = {
      line,
      timestamp: timestamp()
    }
    emitToRenderers('rtspServer:log', event)
  })

  rtspServerManager.on('stateChanged', (status) => {
    emitToRenderers('rtspServer:stateChanged', status)
  })

  streamJobManager.on('log', (event: StreamLogEvent) => {
    emitToRenderers('stream:log', event)
  })

  streamJobManager.on('stateChanged', (event: StreamStateChangedEvent) => {
    emitToRenderers('stream:stateChanged', event)
  })
}

async function ensureServerRunning(): Promise<RTSPServerStatus> {
  const current = rtspServerManager.getStatus()
  if (current.state === 'running' || current.state === 'starting') {
    return current
  }

  return rtspServerManager.start(store.getSettings())
}

async function scanCapabilities(force = false): Promise<FFmpegCapabilities> {
  if (cachedCapabilities && !force) {
    return cachedCapabilities
  }

  cachedCapabilities = await capabilityDetector.scan(force)
  return cachedCapabilities
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 980,
    minHeight: 700,
    title: 'RTSP Streamer',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
    return store.getSettings()
  })

  ipcMain.handle('settings:set', async (_event, payload: Partial<AppSettings>): Promise<AppSettings> => {
    const settings = await store.updateSettings(payload)

    const status = rtspServerManager.getStatus()
    if (status.state === 'running' || status.state === 'starting') {
      await rtspServerManager.restart(settings)
    }

    return settings
  })

  ipcMain.handle('rtspServer:status', async (): Promise<RTSPServerStatus> => {
    return rtspServerManager.getStatus()
  })

  ipcMain.handle('rtspServer:start', async (): Promise<RTSPServerStatus> => {
    return rtspServerManager.start(store.getSettings())
  })

  ipcMain.handle('rtspServer:stop', async (): Promise<RTSPServerStatus> => {
    return rtspServerManager.stop()
  })

  ipcMain.handle('stream:list', async (): Promise<StreamTask[]> => {
    return streamJobManager.listTasks()
  })

  ipcMain.handle('stream:create', async (_event, payload: StreamTaskPayload): Promise<StreamTask> => {
    return streamJobManager.createTask(payload)
  })

  ipcMain.handle('stream:update', async (_event, id: string, payload: Partial<StreamTaskPayload>): Promise<StreamTask> => {
    return streamJobManager.updateTask(id, payload)
  })

  ipcMain.handle('stream:remove', async (_event, id: string): Promise<boolean> => {
    return streamJobManager.removeTask(id)
  })

  ipcMain.handle('stream:start', async (_event, id: string): Promise<StreamTask> => {
    await ensureServerRunning()
    const capabilities = await scanCapabilities()
    return streamJobManager.startTask(id, store.getSettings(), capabilities)
  })

  ipcMain.handle('stream:stop', async (_event, id: string): Promise<StreamTask> => {
    return streamJobManager.stopTask(id)
  })

  ipcMain.handle('capability:scan', async (_event, force?: boolean): Promise<FFmpegCapabilities> => {
    return scanCapabilities(Boolean(force))
  })

  ipcMain.handle('dialog:openVideoFile', async (): Promise<string | null> => {
    const response = await dialog.showOpenDialog({
      title: 'Select local video file',
      properties: ['openFile'],
      filters: [
        {
          name: 'Video files',
          extensions: ['mp4', 'mkv', 'mov', 'avi', 'flv', 'webm', 'm4v', 'ts', 'mpeg']
        },
        {
          name: 'All files',
          extensions: ['*']
        }
      ]
    })

    if (response.canceled || response.filePaths.length === 0) {
      return null
    }

    return response.filePaths[0]
  })
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  await createServices()
  registerIpcHandlers()
  await createWindow()

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow()
    }
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  void streamJobManager?.stopAll()
  void rtspServerManager?.stop()
})

void bootstrap()
