/**
 * 外部进程层：bili CLI、ffmpeg、powershell。
 *
 * 这里只做三件事：找到程序、跑起来、把 stdout 变成对象。
 * 任何"要不要做"的判断都不在这一层 —— 免得业务逻辑散进 shell 调用。
 */
import fs from 'node:fs'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { loadConfig } from './paths.js'

export class StudioError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'StudioError'
    this.code = code
    this.hint = hint
  }
}

function whichOnPath(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  const dirs = (process.env.PATH || '').split(path.delimiter).filter(Boolean)
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = path.join(dir, name + ext)
      try {
        if (fs.statSync(candidate).isFile()) return candidate
      } catch {
        /* 不是它 */
      }
    }
  }
  return ''
}

export function resolveBili(cfg = loadConfig()) {
  if (cfg.biliPath && fs.existsSync(cfg.biliPath)) return cfg.biliPath
  const onPath = whichOnPath('bili')
  if (onPath) return onPath
  throw new StudioError(
    'bili_missing',
    '找不到 bili CLI，工作室没法操作 B 站。',
    '装好 bili-cli 后在 ~/.dsh/bili-studio/config.json 里把 biliPath 写成绝对路径。',
  )
}

export function resolveFfmpeg(cfg = loadConfig()) {
  if (cfg.ffmpegPath && fs.existsSync(cfg.ffmpegPath)) return cfg.ffmpegPath
  const onPath = whichOnPath('ffmpeg')
  if (onPath) return onPath
  throw new StudioError(
    'ffmpeg_missing',
    '找不到 ffmpeg，处理不了音频和视频。',
    '把 ffmpeg.exe 路径写进 config.json 的 ffmpegPath（bili-whale 自带一份在 ~/.dsh/bili-whale/bin/）。',
  )
}

/**
 * 跑一个外部程序，收集 stdout / stderr。
 * @returns {Promise<{ code:number, stdout:string, stderr:string }>}
 */
export function runProgram(file, args, { timeoutMs = 180_000, cwd = undefined, env = undefined } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: timeoutMs,
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: 'utf8',
        env: { ...process.env, ...(env || {}) },
      },
      (error, stdout, stderr) => {
        const out = String(stdout ?? '')
        const err = String(stderr ?? '')
        if (error && typeof error.code !== 'number') {
          // 超时 / 找不到可执行文件 / 被杀 —— 这些不是"业务失败"，直接抛
          reject(
            new StudioError(
              'spawn_failed',
              `${path.basename(file)} 没能跑起来：${error.message}`,
              '检查路径是否正确、程序是否被占用。',
            ),
          )
          return
        }
        resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout: out, stderr: err })
      },
    )
  })
}

/**
 * 调 bili 子命令并解析它那唯一一行 JSON。
 * 失败统一抛 StudioError，code 用 bili 自己的错误码（risk_control / rate_limited …）。
 */
export async function bili(args, { timeoutMs = 180_000, dryRun = false } = {}) {
  const cfg = loadConfig()
  const bin = resolveBili(cfg)
  const argv = [...args]
  if (dryRun && !argv.includes('--dry-run')) argv.push('--dry-run')
  const { code, stdout, stderr } = await runProgram(bin, argv, { timeoutMs })
  let parsed
  try {
    parsed = JSON.parse(stdout.trim().split('\n').filter(Boolean).pop())
  } catch {
    throw new StudioError(
      'bili_bad_output',
      `bili ${args.slice(0, 2).join(' ')} 的输出不是 JSON（退出码 ${code}）。`,
      (stderr || stdout).trim().slice(0, 600) || '没有更多信息。',
    )
  }
  if (!parsed?.ok) {
    const error = parsed?.error || {}
    throw new StudioError(
      error.code || `bili_exit_${code}`,
      error.message || 'bili 调用失败',
      error.hint || stderr.trim().slice(0, 600) || undefined,
    )
  }
  return parsed.data
}

/** 只读凭据，不做任何回显。B 站 playurl 需要 SESSDATA。 */
export function readCredentials(cfg = loadConfig()) {
  try {
    const raw = JSON.parse(fs.readFileSync(cfg.credentialsPath, 'utf8'))
    return { sessdata: raw.sessdata || '', biliJct: raw.bili_jct || '' }
  } catch {
    return { sessdata: '', biliJct: '' }
  }
}

/** 平台默认 UA —— B 站 CDN 会校验 Referer，UA 太怪也会 403 */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

/**
 * 直接用 B 站公开接口拿音频流地址。
 * bili CLI 没有"下载音频"的命令，所以我们自己调 playurl（只读，不带任何写操作）。
 */
export async function fetchAudioStream(bv, cfg = loadConfig()) {
  const info = await bili(['video', 'info', bv])
  const cid = info?.pages?.[0]?.cid
  if (!cid) throw new StudioError('no_cid', `${bv} 没有拿到 cid。`, '换一个 BV 号再试。')

  const cred = readCredentials(cfg)
  const params = new URLSearchParams({
    bvid: info.bvid || bv,
    cid: String(cid),
    fnval: '4048',
    fourk: '1',
  })
  const res = await fetch(`https://api.bilibili.com/x/player/playurl?${params}`, {
    headers: {
      Referer: 'https://www.bilibili.com',
      'User-Agent': BROWSER_UA,
      Cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.biliJct}`,
    },
  })
  const json = await res.json()
  if (json?.code !== 0) {
    throw new StudioError(
      'playurl_failed',
      `拿不到 ${bv} 的音频流（code ${json?.code}）。`,
      json?.message === '账号未登录' ? '先 `bili auth login`，没登录拿不到高码率音频。' : json?.message || undefined,
    )
  }
  const audios = json.data?.dash?.audio || []
  if (!audios.length) {
    throw new StudioError('no_audio', `${bv} 没有可用的音频流。`, '这条视频可能是纯音乐/无音轨的直播回放。')
  }
  const best = [...audios].sort((a, b) => (b.bandwidth || 0) - (a.bandwidth || 0))[0]
  return {
    bvid: info.bvid || bv,
    cid,
    title: info.title,
    duration: info.duration,
    owner: info.owner,
    url: best.baseUrl || best.base_url,
    backup: best.backupUrl?.[0] || best.backup_url?.[0] || '',
    bandwidth: best.bandwidth,
  }
}

/** ffmpeg 的 -headers 要一个字面量换行分隔的字符串 */
export function ffmpegHeaders() {
  return `Referer: https://www.bilibili.com\r\nUser-Agent: ${BROWSER_UA}\r\n`
}
