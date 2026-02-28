import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { FFmpegCapabilities } from '../../shared/types'
import { ensureExecutable } from './binary-resolver'

interface CommandResult {
  stdout: string
  stderr: string
  code: number | null
}

function runCommand(binaryPath: string, args: string[], timeoutMs = 8000): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(binaryPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    })

    let stdout = ''
    let stderr = ''

    const timeoutId = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`Command timed out: ${binaryPath} ${args.join(' ')}`))
    }, timeoutMs)

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.once('error', (error) => {
      clearTimeout(timeoutId)
      reject(error)
    })

    child.once('close', (code) => {
      clearTimeout(timeoutId)
      resolve({ stdout, stderr, code })
    })
  })
}

function parseEncoders(text: string): string[] {
  const output = text.split('\n')
  const encoders = new Set<string>()

  for (const line of output) {
    const trimmed = line.trim()
    const match = trimmed.match(/^[A-Z\.]{6}\s+([^\s]+)/)
    if (match) {
      encoders.add(match[1])
    }
  }

  return [...encoders].sort()
}

function parseHwaccels(text: string): string[] {
  const lines = text.split('\n').map((line) => line.trim())
  const hwaccels: string[] = []

  let inList = false
  for (const line of lines) {
    if (!line) {
      continue
    }

    if (line.toLowerCase().includes('hardware acceleration methods')) {
      inList = true
      continue
    }

    if (inList) {
      hwaccels.push(line)
    }
  }

  return hwaccels
}

export class FFmpegCapabilityDetector {
  private cache: FFmpegCapabilities | null = null

  constructor(private readonly ffmpegPath: string) {}

  async scan(force = false): Promise<FFmpegCapabilities> {
    if (this.cache && !force) {
      return this.cache
    }

    try {
      await access(this.ffmpegPath, constants.R_OK)
      await ensureExecutable(this.ffmpegPath)
    } catch {
      const missing = this.unavailable(`FFmpeg binary not found: ${this.ffmpegPath}`)
      this.cache = missing
      return missing
    }

    try {
      const [encodersResult, hwaccelsResult] = await Promise.all([
        runCommand(this.ffmpegPath, ['-hide_banner', '-encoders']),
        runCommand(this.ffmpegPath, ['-hide_banner', '-hwaccels'])
      ])

      const encoderText = `${encodersResult.stdout}\n${encodersResult.stderr}`
      const hwText = `${hwaccelsResult.stdout}\n${hwaccelsResult.stderr}`

      const encoders = parseEncoders(encoderText)
      const hwaccels = parseHwaccels(hwText)

      const capability: FFmpegCapabilities = {
        available: true,
        ffmpegPath: this.ffmpegPath,
        encoders,
        hwaccels,
        hasQsvH264: encoders.includes('h264_qsv'),
        hasQsvHevc: encoders.includes('hevc_qsv'),
        hasVideoToolboxH264: encoders.includes('h264_videotoolbox'),
        hasVideoToolboxHevc: encoders.includes('hevc_videotoolbox'),
        hasNvencH264: encoders.includes('h264_nvenc'),
        hasNvencHevc: encoders.includes('hevc_nvenc')
      }

      this.cache = capability
      return capability
    } catch (error) {
      const failed = this.unavailable(error instanceof Error ? error.message : 'Capability scan failed')
      this.cache = failed
      return failed
    }
  }

  private unavailable(lastError: string): FFmpegCapabilities {
    return {
      available: false,
      ffmpegPath: this.ffmpegPath,
      hwaccels: [],
      encoders: [],
      hasQsvH264: false,
      hasQsvHevc: false,
      hasVideoToolboxH264: false,
      hasVideoToolboxHevc: false,
      hasNvencH264: false,
      hasNvencHevc: false,
      lastError
    }
  }
}
