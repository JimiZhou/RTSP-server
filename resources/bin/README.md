# Binary Placement

Place FFmpeg and MediaMTX binaries in this folder by `platform-arch`.

Example:

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

The app resolves binaries from:

- Dev: `<repo>/resources/bin/<platform-arch>/...`
- Packaged: `<process.resourcesPath>/bin/<platform-arch>/...`
