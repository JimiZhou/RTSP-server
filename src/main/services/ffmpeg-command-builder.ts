import {
  AppSettings,
  FFmpegCapabilities,
  HwAccelPolicy,
  StreamTask,
  VideoCodec
} from '../../shared/types'

export interface BuiltFFmpegCommand {
  args: string[]
  outputUrl: string
  selectedPolicy: HwAccelPolicy | 'copy'
  videoEncoder: string
}

function codecPrefix(codec: VideoCodec): 'h264' | 'hevc' {
  if (codec === 'hevc') {
    return 'hevc'
  }

  return 'h264'
}

function cpuEncoder(codec: VideoCodec): string {
  if (codec === 'hevc') {
    return 'libx265'
  }

  return 'libx264'
}

function selectEncoder(task: StreamTask, settings: AppSettings, caps: FFmpegCapabilities): { policy: HwAccelPolicy | 'copy'; encoder: string } {
  if (task.videoCodec === 'copy') {
    return { policy: 'copy', encoder: 'copy' }
  }

  const prefix = codecPrefix(task.videoCodec)

  const qsvEncoder = `${prefix}_qsv`
  const nvencEncoder = `${prefix}_nvenc`
  const videoToolboxEncoder = `${prefix}_videotoolbox`

  const canUseQsv = task.videoCodec === 'hevc' ? caps.hasQsvHevc : caps.hasQsvH264
  const canUseNvenc = task.videoCodec === 'hevc' ? caps.hasNvencHevc : caps.hasNvencH264
  const canUseVideoToolbox = task.videoCodec === 'hevc' ? caps.hasVideoToolboxHevc : caps.hasVideoToolboxH264

  const requested = task.hwAccel === 'auto' ? settings.defaultHwAccelPolicy : task.hwAccel

  if (requested === 'qsv') {
    if (!canUseQsv) {
      throw new Error(`Requested QSV encoder is unavailable: ${qsvEncoder}`)
    }

    return {
      policy: 'qsv',
      encoder: qsvEncoder
    }
  }

  if (requested === 'nvenc') {
    if (!canUseNvenc) {
      throw new Error(`Requested NVENC encoder is unavailable: ${nvencEncoder}`)
    }

    return {
      policy: 'nvenc',
      encoder: nvencEncoder
    }
  }

  if (requested === 'cpu') {
    return {
      policy: 'cpu',
      encoder: cpuEncoder(task.videoCodec)
    }
  }

  if (requested === 'videotoolbox') {
    if (!canUseVideoToolbox) {
      throw new Error(`Requested VideoToolbox encoder is unavailable: ${videoToolboxEncoder}`)
    }

    return {
      policy: 'videotoolbox',
      encoder: videoToolboxEncoder
    }
  }

  if (canUseNvenc) {
    return {
      policy: 'nvenc',
      encoder: nvencEncoder
    }
  }

  if (canUseQsv) {
    return {
      policy: 'qsv',
      encoder: qsvEncoder
    }
  }

  if (canUseVideoToolbox) {
    return {
      policy: 'videotoolbox',
      encoder: videoToolboxEncoder
    }
  }

  return {
    policy: 'cpu',
    encoder: cpuEncoder(task.videoCodec)
  }
}

function safeSegment(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\s+/g, '-')
}

function isWildcardHost(host: string): boolean {
  const normalized = host.trim().toLowerCase()
  return normalized === '0.0.0.0' || normalized === '::' || normalized === '[::]'
}

export function buildFFmpegCommand(
  task: StreamTask,
  settings: AppSettings,
  caps: FFmpegCapabilities
): BuiltFFmpegCommand {
  const { policy, encoder } = selectEncoder(task, settings, caps)

  const pathSegment = safeSegment(task.path)
  if (!pathSegment) {
    throw new Error('Task path is empty')
  }

  const publishHost = isWildcardHost(settings.listenHost) ? '127.0.0.1' : settings.listenHost.trim()
  const authPrefix = settings.enableAuth
    ? `${encodeURIComponent(settings.authUsername)}:${encodeURIComponent(settings.authPassword)}@`
    : ''
  const outputUrl = `rtsp://${authPrefix}${publishHost}:${settings.listenPort}/${pathSegment}`

  const args: string[] = ['-hide_banner', '-loglevel', 'info', '-re']

  if (task.loop) {
    args.push('-stream_loop', '-1')
  }

  args.push('-i', task.inputFile)

  if (task.videoCodec === 'copy') {
    args.push('-c:v', 'copy')
  } else {
    args.push('-c:v', encoder)

    if (task.bitrateKbps) {
      args.push('-b:v', `${task.bitrateKbps}k`)
    }

    if (task.fps) {
      args.push('-r', String(task.fps))
    }

    if (policy === 'nvenc') {
      args.push('-preset', 'p4')
    }

    if (policy === 'cpu') {
      args.push('-preset', 'veryfast')
    }
  }

  if (task.audioCodec === 'none') {
    args.push('-an')
  } else if (task.audioCodec === 'copy') {
    args.push('-c:a', 'copy')
  } else if (task.audioCodec === 'aac') {
    args.push('-c:a', 'aac', '-b:a', '128k')
  } else {
    args.push('-c:a', 'libopus', '-b:a', '96k')
  }

  args.push('-rtsp_transport', task.transport)
  args.push('-muxdelay', '0.1')
  args.push('-f', 'rtsp', outputUrl)

  return {
    args,
    outputUrl,
    selectedPolicy: policy,
    videoEncoder: encoder
  }
}
