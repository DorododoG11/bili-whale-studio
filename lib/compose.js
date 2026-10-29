/**
 * 合成：把图片 + 音频做成一个能投稿的 mp4。
 *
 * 故意做得笨：不调参、不做花哨转场。配音长度决定视频长度，
 * 图片按总时长均分，横屏 1920x1080、30fps、H.264 + AAC —— B 站最不容易翻车的组合。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveFfmpeg, runProgram, StudioError } from './bili.js'
import { OUT_DIR, loadConfig } from './paths.js'

/** 从 ffmpeg 的输出里读时长（不依赖 ffprobe） */
export async function mediaDuration(file) {
  const cfg = loadConfig()
  const ffmpeg = resolveFfmpeg(cfg)
  const res = await runProgram(ffmpeg, ['-hide_banner', '-i', file], { timeoutMs: 60_000 })
  const text = `${res.stderr}\n${res.stdout}`
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** concat 列表里用正斜杠，避免 ffmpeg 在 Windows 上把反斜杠当转义 */
function toFfmpegPath(file) {
  return path.resolve(file).replace(/\\/g, '/').replace(/'/g, "'\\''")
}

export async function composeVideo({ images = [], audio, out, title = '' } = {}) {
  const cfg = loadConfig()
  if (!audio || !fs.existsSync(audio)) {
    throw new StudioError('no_audio', '没有配音文件，做不出视频。', '先用 studio_voice_say 生成一段 wav。')
  }
  const pics = (images || []).filter((p) => p && fs.existsSync(p)).slice(0, 12)
  const { width, height, fps } = cfg.compose
  const file = out ? path.resolve(out) : path.join(OUT_DIR, `video-${Date.now().toString(36)}.mp4`)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  const total = (await mediaDuration(audio)) || 10
  const ffmpeg = resolveFfmpeg(cfg)
  const args = ['-y', '-hide_banner', '-loglevel', 'error']

  if (pics.length === 0) {
    args.push('-f', 'lavfi', '-i', `color=c=0x04121F:s=${width}x${height}:r=${fps}`, '-i', audio)
  } else if (pics.length === 1) {
    args.push('-loop', '1', '-i', pics[0], '-i', audio)
  } else {
    const per = Math.max(1.5, total / pics.length)
    const list = path.join(path.dirname(file), `concat-${Date.now().toString(36)}.txt`)
    const lines = []
    for (const pic of pics) {
      lines.push(`file '${toFfmpegPath(pic)}'`, `duration ${per.toFixed(3)}`)
    }
    lines.push(`file '${toFfmpegPath(pics[pics.length - 1])}'`)
    fs.writeFileSync(list, lines.join('\n'), 'utf8')
    args.push('-f', 'concat', '-safe', '0', '-i', list, '-i', audio)
  }

  args.push(
    '-vf',
    `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=0x04121F,format=yuv420p`,
    '-r',
    String(fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-shortest',
    '-movflags',
    '+faststart',
    file,
  )

  const res = await runProgram(ffmpeg, args, { timeoutMs: 900_000 })
  if (res.code !== 0 || !fs.existsSync(file) || fs.statSync(file).size < 10_000) {
    throw new StudioError('compose_failed', '视频合成失败。', (res.stderr || '').trim().slice(0, 600) || '检查图片/音频格式。')
  }
  return {
    file,
    title: title || '',
    bytes: fs.statSync(file).size,
    duration: Math.round((await mediaDuration(file)) || total),
    slides: Math.max(1, pics.length),
  }
}
