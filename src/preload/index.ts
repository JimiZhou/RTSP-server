import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  FFmpegCapabilities,
  RTSPDesktopApi,
  RTSPServerStatus,
  ServerLogEvent,
  StreamLogEvent,
  StreamStateChangedEvent,
  StreamTask,
  StreamTaskPayload
} from '../shared/types'

function subscribe<T>(channel: string, callback: (event: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => {
    callback(payload)
  }

  ipcRenderer.on(channel, listener)

  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: RTSPDesktopApi = {
  getSettings: async (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  setSettings: async (payload: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke('settings:set', payload),
  getTasks: async (): Promise<StreamTask[]> => ipcRenderer.invoke('stream:list'),
  createTask: async (payload: StreamTaskPayload): Promise<StreamTask> => ipcRenderer.invoke('stream:create', payload),
  updateTask: async (id: string, payload: Partial<StreamTaskPayload>): Promise<StreamTask> =>
    ipcRenderer.invoke('stream:update', id, payload),
  removeTask: async (id: string): Promise<boolean> => ipcRenderer.invoke('stream:remove', id),
  startTask: async (id: string): Promise<StreamTask> => ipcRenderer.invoke('stream:start', id),
  stopTask: async (id: string): Promise<StreamTask> => ipcRenderer.invoke('stream:stop', id),
  openVideoFileDialog: async (): Promise<string | null> => ipcRenderer.invoke('dialog:openVideoFile'),
  scanCapabilities: async (force?: boolean): Promise<FFmpegCapabilities> => ipcRenderer.invoke('capability:scan', force),
  getServerStatus: async (): Promise<RTSPServerStatus> => ipcRenderer.invoke('rtspServer:status'),
  startServer: async (): Promise<RTSPServerStatus> => ipcRenderer.invoke('rtspServer:start'),
  stopServer: async (): Promise<RTSPServerStatus> => ipcRenderer.invoke('rtspServer:stop'),
  onStreamStateChanged: (cb: (event: StreamStateChangedEvent) => void): (() => void) =>
    subscribe<StreamStateChangedEvent>('stream:stateChanged', cb),
  onStreamLog: (cb: (event: StreamLogEvent) => void): (() => void) => subscribe<StreamLogEvent>('stream:log', cb),
  onServerLog: (cb: (event: ServerLogEvent) => void): (() => void) => subscribe<ServerLogEvent>('rtspServer:log', cb),
  onServerStateChanged: (cb: (event: RTSPServerStatus) => void): (() => void) =>
    subscribe<RTSPServerStatus>('rtspServer:stateChanged', cb)
}

contextBridge.exposeInMainWorld('rtspApp', api)
