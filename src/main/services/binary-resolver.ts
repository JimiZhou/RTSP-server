import { promises as fs } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

export interface BinaryBundlePaths {
  ffmpegPath: string
  mediamtxPath: string
  platformArch: string
}

function getBinRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'bin')
  }

  return path.resolve(app.getAppPath(), 'resources', 'bin')
}

function executableName(base: string): string {
  if (process.platform === 'win32') {
    return `${base}.exe`
  }

  return base
}

export function resolveBinaryPaths(): BinaryBundlePaths {
  const platformArch = `${process.platform}-${process.arch}`
  const binRoot = getBinRoot()

  return {
    ffmpegPath: path.join(binRoot, platformArch, executableName('ffmpeg')),
    mediamtxPath: path.join(binRoot, platformArch, executableName('mediamtx')),
    platformArch
  }
}

export async function ensureExecutable(filePath: string): Promise<void> {
  if (process.platform === 'win32') {
    return
  }

  try {
    await fs.chmod(filePath, 0o755)
  } catch {
    // Best effort: if chmod fails here spawn will surface a clear error.
  }
}
