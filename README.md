# RTSP Streamer (Electron)

A cross-platform Electron desktop app to stream local video files as RTSP streams using bundled FFmpeg + MediaMTX.

## Features

- GUI-based local video selection
- Multi-stream concurrent tasks
- Built-in RTSP server (MediaMTX)
- Built-in FFmpeg process orchestration
- Hardware acceleration policies: `auto`, `cpu`, `qsv`, `nvenc`
- LAN-friendly binding option (`0.0.0.0`) for local network access
- Optional username/password auth (can be disabled for anonymous plain RTSP)
- Task config persistence (without auto-start on app relaunch)

## Tech Stack

- Electron + React + TypeScript
- `electron-vite` for development/build
- `electron-builder` for packaging (`dmg` / `nsis` / `AppImage`)

## Quick Start

1. Install dependencies:

```bash
npm install
```

2. Put binaries under `resources/bin/<platform-arch>/`:

```text
resources/bin/
  darwin-arm64/
    ffmpeg
    mediamtx
  darwin-x64/
    ffmpeg
    mediamtx
  win32-x64/
    ffmpeg.exe
    mediamtx.exe
  linux-x64/
    ffmpeg
    mediamtx
```

3. Start in dev mode:

```bash
npm run dev
```

4. Build distributables:

```bash
npm run dist
```

## Notes

- Capability scan is based on `ffmpeg -encoders` and `ffmpeg -hwaccels`.
- In `auto` mode, video encoder fallback order is `NVENC -> QSV -> CPU`.
- App settings are persisted in Electron `userData/config.json`.

## IPC Surface

Main channels include:

- `settings:get`, `settings:set`
- `rtspServer:start`, `rtspServer:stop`, `rtspServer:status`
- `stream:list`, `stream:create`, `stream:update`, `stream:remove`, `stream:start`, `stream:stop`
- `capability:scan`
- `dialog:openVideoFile`

Events:

- `stream:stateChanged`
- `stream:log`
- `rtspServer:stateChanged`
- `rtspServer:log`
