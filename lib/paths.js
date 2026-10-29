/**
 * 路径与配置。
 *
 * 所有本地产物都在 ~/.dsh/bili-studio/ 下，和工作目录无关：
 *   config.json     用户可改的配置（bili / ffmpeg 路径、配额、TTS 音色）
 *   knowledge/      学到的东西：raw/ 原始视频数据，notes/ 整理后的笔记
 *   voices/         音色素材库（每个音色一个目录）
 *   drafts/         草稿箱，一条草稿一个 json
 *   out/            合成出来的视频、音频
 *   publish-log.jsonl  记账：发过什么，什么时候
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const HOME = os.homedir()
export const DSH_HOME = process.env.DSH_HOME || path.join(HOME, '.dsh')
export const STUDIO_DIR = process.env.BILI_STUDIO_DIR || path.join(DSH_HOME, 'bili-studio')

export const CONFIG_FILE = path.join(STUDIO_DIR, 'config.json')
export const KNOWLEDGE_DIR = path.join(STUDIO_DIR, 'knowledge')
export const RAW_DIR = path.join(KNOWLEDGE_DIR, 'raw')
export const NOTES_DIR = path.join(KNOWLEDGE_DIR, 'notes')
export const VOICE_DIR = path.join(STUDIO_DIR, 'voices')
export const DRAFT_DIR = path.join(STUDIO_DIR, 'drafts')
export const OUT_DIR = path.join(STUDIO_DIR, 'out')
export const CACHE_DIR = path.join(STUDIO_DIR, 'cache')
export const LOG_FILE = path.join(STUDIO_DIR, 'publish-log.jsonl')
export const CRED_FILE = process.env.BILI_CREDENTIALS || path.join(HOME, '.bili-ai', 'credentials.json')

const DEFAULT_BILI = path.join(HOME, '.local', 'bin', 'bili.exe')
const DEFAULT_FFMPEG = path.join(DSH_HOME, 'bili-whale', 'bin', 'ffmpeg.exe')

export const DEFAULTS = {
  /** 留空则自动找：~/.local/bin/bili.exe → PATH 里的 bili */
  biliPath: fs.existsSync(DEFAULT_BILI) ? DEFAULT_BILI : '',
  /** 留空则自动找：bili-whale 自带的 ffmpeg → PATH 里的 ffmpeg */
  ffmpegPath: fs.existsSync(DEFAULT_FFMPEG) ? DEFAULT_FFMPEG : '',
  credentialsPath: CRED_FILE,
  /** 每天最多真正发出去几条（动态 + 投稿合计） */
  maxPublishPerDay: 3,
  /** 草稿必须 approved 才能发；关掉它也不会绕过 publish_log 配额 */
  requireApproval: true,
  perVideoCommentLimit: 1,
  voice: {
    /** sapi = 系统自带语音；command = 外部克隆/TTS 命令行 */
    engine: 'sapi',
    sapiVoice: 'Microsoft Huihui Desktop',
    rate: 0,
    /** 音高倍数：1 = 原声，>1 更亮更年轻，<1 更沉。8% 以内听不出机械感 */
    pitch: 1.0,
    /** command 引擎的模板：{input} 文本文件 {out} 输出 wav */
    cloneCommand: '',
  },
  learn: {
    defaultSize: 5,
    maxChars: 6000,
    includeComments: 3,
  },
  compose: {
    width: 1920,
    height: 1080,
    fps: 30,
  },
  /** 允许的音频来源账号（自己的号）。留空 = 只允许 self mid 与显式授权 */
  allowedOwnerMids: [],
}

const clone = (o) => JSON.parse(JSON.stringify(o))

function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(base[k] ?? {}, v) : v
  }
  return out
}

export function ensureDirs() {
  for (const dir of [STUDIO_DIR, KNOWLEDGE_DIR, RAW_DIR, NOTES_DIR, VOICE_DIR, DRAFT_DIR, OUT_DIR, CACHE_DIR]) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export function loadConfig() {
  ensureDirs()
  let user = {}
  try {
    user = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
  } catch {
    /* 没有配置文件就全用默认值 */
  }
  return merge(clone(DEFAULTS), user)
}

export function saveConfig(next) {
  ensureDirs()
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n', 'utf8')
  return next
}

/** 改了某一层就落盘，返回合并后的完整配置 */
export function patchConfig(patch) {
  return saveConfig(merge(loadConfig(), patch))
}

export function configPath() {
  return CONFIG_FILE
}

export function relToStudio(file) {
  const rel = path.relative(STUDIO_DIR, file)
  return rel.startsWith('.') ? file : rel.split(path.sep).join('/')
}
