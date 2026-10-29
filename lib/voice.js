/**
 * 声音：把**自己账号**视频里的大肥鱼声音拉下来，切成干净的小段，攒成音色素材库。
 *
 * 边界写在代码里，不写在文档里：
 *   - 来源必须是自己号（self mid）或 allowedOwnerMids 里显式列出的号；
 *   - 否则必须显式传 authorized=true，并且会把授权这件事记进 meta.json；
 *   - 每条素材都留 bvid / 片段区间 / 拉取时间，删不掉来源就删不掉这段素材。
 *
 * 合成（说/唱）走可插拔引擎：默认系统语音（SAPI，Windows 自带中文音色），
 * 换成克隆引擎就改 config.voice.cloneCommand —— 引擎只管"文本进、wav 出"。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { resolveFfmpeg, runProgram, fetchAudioStream, ffmpegHeaders, bili, StudioError } from './bili.js'
import { VOICE_DIR, OUT_DIR, DSH_HOME, loadConfig, patchConfig } from './paths.js'

const shortId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`

function slugify(label) {
  const base = String(label || 'voice')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'voice'
}

/** 自己账号的 mid：优先 bili-whale 的配置，其次问 bili 自己 */
function selfMid() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DSH_HOME, 'bili-whale.config.json'), 'utf8'))
    if (cfg?.self?.mid) return String(cfg.self.mid)
  } catch {
    /* 没装 bili-whale 也能用 */
  }
  return ''
}

async function assertAuthorized(owner, authorized) {
  const cfg = loadConfig()
  const mid = owner?.mid != null ? String(owner.mid) : ''
  const self = selfMid()
  const allowed = (cfg.allowedOwnerMids || []).map(String)
  if (self && mid === self) return { ok: true, reason: 'self' }
  if (mid && allowed.includes(mid)) return { ok: true, reason: 'allowlist' }
  if (authorized === true) return { ok: true, reason: 'user-authorized' }
  throw new StudioError(
    'voice_not_authorized',
    `这条视频属于 ${owner?.name || mid || '未知账号'}，不是你的号，也没拿到授权。`,
    '如果确实是你自己的号：把它加进 config.json 的 allowedOwnerMids；如果只是口头同意过：调用时传 authorized=true，这会被记进素材的 meta。别人的声音不能拿来当自己的用。',
  )
}

function voiceDir(slug) {
  return path.join(VOICE_DIR, slug)
}

function readMeta(slug) {
  try {
    return JSON.parse(fs.readFileSync(path.join(voiceDir(slug), 'meta.json'), 'utf8'))
  } catch {
    return null
  }
}

/**
 * 拉一段自己的声音。
 * @param {object} input { bv, label, start, end, authorized }
 */
export async function pullVoice({ bv, label, start = 0, end = null, authorized = false }) {
  if (!bv || !/^BV[\w]+$/.test(String(bv).trim())) {
    throw new StudioError('bad_bv', `BV 号不对：${bv}`, '形如 BV1xx411c7xx。')
  }
  const cfg = loadConfig()
  const stream = await fetchAudioStream(String(bv).trim(), cfg)
  const gate = await assertAuthorized(stream.owner, authorized)

  const from = Math.max(0, Number(start) || 0)
  const dur = Number(end) > from ? Number(end) - from : Math.min(20, Math.max(6, Number(stream.duration) || 20))
  const slug = slugify(label || `${stream.owner?.name || 'me'}-${stream.bvid}`)
  const dir = voiceDir(slug)
  fs.mkdirSync(dir, { recursive: true })

  const wav = path.join(dir, 'sample.wav')
  const ffmpeg = resolveFfmpeg(cfg)
  const args = [
    '-y',
    '-hide_banner',
    '-loglevel',
    'error',
    '-headers',
    ffmpegHeaders(),
    '-ss',
    String(from.toFixed(2)),
    '-t',
    String(dur.toFixed(2)),
    '-i',
    stream.url,
    '-af',
    // 去掉低频噪声、压掉底噪、统一响度：一段能直接喂给克隆引擎的干声
    'highpass=f=80,afftdn=nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100',
    '-ac',
    '1',
    '-ar',
    '44100',
    wav,
  ]
  const res = await runProgram(ffmpeg, args, { timeoutMs: 300_000 })
  if (res.code !== 0 || !fs.existsSync(wav) || fs.statSync(wav).size < 1024) {
    throw new StudioError('extract_failed', 'ffmpeg 没织出音频。', (res.stderr || '').trim().slice(0, 500) || '试试换一段起点。')
  }

  const bytes = fs.statSync(wav).size
  const meta = {
    id: shortId('vc'),
    slug,
    label: String(label || `${stream.owner?.name || ''} ${stream.bvid}`).slice(0, 60),
    source: {
      bvid: stream.bvid,
      title: stream.title,
      owner: stream.owner || null,
      segment: { start: from, duration: dur },
      authorized: gate.reason !== 'self' ? true : false,
      authorization: gate.reason,
    },
    fetchedAt: new Date().toISOString(),
    files: { wav },
    bytes,
    duration: dur,
  }
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8')
  return meta
}

export function listVoices() {
  const dirs = fs.existsSync(VOICE_DIR) ? fs.readdirSync(VOICE_DIR, { withFileTypes: true }) : []
  const out = []
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const meta = readMeta(d.name)
    if (meta) out.push(meta)
  }
  out.sort((a, b) => String(b.fetchedAt).localeCompare(String(a.fetchedAt)))
  return out
}

export function removeVoice(slug) {
  const dir = voiceDir(slugify(slug))
  if (!fs.existsSync(dir)) {
    throw new StudioError('voice_missing', `没有这个音色：${slug}`, '用 studio_voice (action=list) 看现有的。')
  }
  const meta = readMeta(slugify(slug))
  fs.rmSync(dir, { recursive: true, force: true })
  return { removed: slugify(slug), source: meta?.source || null }
}

/**
 * 文本 → 语音。默认用系统 SAPI（Windows 自带中文音色），
 * 也可以接任何"命令行进文本、出 wav"的克隆引擎。
 */
export async function say({ text, out, voice, rate, pitch }) {
  const cfg = loadConfig()
  if (!text || !String(text).trim()) {
    throw new StudioError('empty_text', '要念的文字是空的。', '');
  }
  const picked = voice || cfg.voice.sapiVoice
  const speed = Number.isFinite(Number(rate)) ? Number(rate) : cfg.voice.rate
  const shift = Math.max(0.8, Math.min(1.25, Number.isFinite(Number(pitch)) ? Number(pitch) : (cfg.voice.pitch ?? 1)))
  const file = out ? path.resolve(out) : path.join(OUT_DIR, `${shortId('say')}.wav`)
  fs.mkdirSync(path.dirname(file), { recursive: true })

  if (cfg.voice.engine === 'command' && cfg.voice.cloneCommand) {
    const textFile = file.replace(/\.wav$/i, '') + '.txt'
    fs.writeFileSync(textFile, String(text), 'utf8')
    const [cmd, ...rest] = cfg.voice.cloneCommand.split(/\s+/)
    const argv = rest.map((a) => a.replace(/\{input\}/g, textFile).replace(/\{out\}/g, file))
    const res = await runProgram(cmd, argv, { timeoutMs: 300_000 })
    if (res.code !== 0 || !fs.existsSync(file)) {
      throw new StudioError('tts_failed', '外部语音引擎没有产出文件。', (res.stderr || '').slice(0, 500))
    }
  } else {
    await speakWithSapi(String(text), file, picked, speed)
  }
  if (Math.abs(shift - 1) > 0.005) await pitchShift(file, shift)
  return {
    file,
    bytes: fs.statSync(file).size,
    engine: cfg.voice.engine === 'command' ? 'command' : 'sapi',
    voice: picked,
    rate: speed,
    pitch: shift,
  }
}

/**
 * 把公共音色的音高往上/往下挪一点，让它更接近想要的"年龄感"。
 * 只动音高不改时长：asetrate 提速后 atempo 再拉回来。
 * 8% 以内几乎听不出处理痕迹；超过 15% 会有明显的塑料感。
 */
async function pitchShift(file, ratio) {
  const cfg = loadConfig()
  const ffmpeg = resolveFfmpeg(cfg)
  const tmp = file.replace(/\.wav$/i, '') + '.pitch.wav'
  const filters = `aresample=44100,asetrate=44100*${ratio.toFixed(4)},aresample=44100,atempo=${(1 / ratio).toFixed(4)}`
  const res = await runProgram(ffmpeg, ['-y', '-hide_banner', '-loglevel', 'error', '-i', file, '-af', filters, tmp], {
    timeoutMs: 120_000,
  })
  if (res.code !== 0 || !fs.existsSync(tmp)) {
    throw new StudioError('pitch_failed', '音高处理失败。', (res.stderr || '').trim().slice(0, 400))
  }
  fs.renameSync(tmp, file)
}

/**
 * 调音色：把语速和音高写进配置，之后所有 studio_say 都按这套参数念。
 * 这是"把公共音色调成接近某种感觉"的正路 —— 调的是参数，不是别人的声纹。
 */
export function tuneVoice({ rate, pitch }) {
  const cfg = loadConfig()
  const next = { ...cfg.voice }
  if (rate !== undefined && Number.isFinite(Number(rate))) next.rate = Math.max(-10, Math.min(10, Math.trunc(Number(rate))))
  if (pitch !== undefined && Number.isFinite(Number(pitch))) next.pitch = Math.max(0.8, Math.min(1.25, Number(pitch)))
  patchConfig({ voice: next })
  return { rate: next.rate, pitch: next.pitch, sapiVoice: next.sapiVoice, engine: next.engine }
}

function speakWithSapi(text, file, voiceName, rate) {
  // 文本走 base64，绕开 PowerShell 的引号地狱；任何字符都不会变成命令
  const b64 = Buffer.from(text, 'utf8').toString('base64')
  const esc = (s) => String(s).replace(/'/g, "''")
  const script = [
    "$ErrorActionPreference='Stop'",
    `$t=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${b64}'))`,
    'Add-Type -AssemblyName System.Speech',
    '$s=New-Object System.Speech.Synthesis.SpeechSynthesizer',
    `try { $s.SelectVoice(${JSON.stringify(voiceName)}) } catch { }`,
    `$s.Rate=${Math.max(-10, Math.min(10, Math.trunc(Number(rate) || 0)))}`,
    `$s.SetOutputToWaveFile('${esc(file)}')`,
    '$s.Speak($t)',
    '$s.Dispose()',
  ].join('; ')
  const res = runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    timeoutMs: 120_000,
  })
  return res.then((r) => {
    if (r.code !== 0 || !fs.existsSync(file)) {
      throw new StudioError('sapi_failed', '系统语音合成失败。', (r.stderr || '').slice(0, 400) || '换个音色试试。')
    }
    return { file }
  })
}

/** 系统里装了哪些声音 —— 让"换个音色"变成可选，而不是猜。 */
export async function listSapiVoices() {
  const script =
    "Add-Type -AssemblyName System.Speech; $s=New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name + '|' + $_.VoiceInfo.Culture + '|' + $_.VoiceInfo.Gender }; $s.Dispose()"
  const res = await runProgram('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 30_000 })
  return res.stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const [name, culture, gender] = l.split('|')
      return { name, culture, gender }
    })
}

/** 把音色素材拼成一条连续的参考音频（给克隆引擎当 prompt 用） */
export async function buildVoiceRef(slugs, { out } = {}) {
  const cfg = loadConfig()
  const picked = (slugs && slugs.length ? slugs : listVoices().map((v) => v.slug)).slice(0, 12)
  const files = picked.map((slug) => path.join(voiceDir(slugify(slug)), 'sample.wav')).filter((f) => fs.existsSync(f))
  if (!files.length) {
    throw new StudioError('no_voice', '没有可用的音色素材。', '先用 studio_voice (action=pull) 拉几段。')
  }
  const file = out ? path.resolve(out) : path.join(VOICE_DIR, `ref-${shortId('v')}.wav`)
  const list = path.join(VOICE_DIR, `concat-${shortId('v')}.txt`)
  fs.writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'), 'utf8')
  const res = await runProgram(resolveFfmpeg(cfg), ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-ac', '1', '-ar', '44100', file], {
    timeoutMs: 180_000,
  })
  fs.rmSync(list, { force: true })
  if (res.code !== 0 || !fs.existsSync(file)) {
    throw new StudioError('concat_failed', '拼接参考音频失败。', (res.stderr || '').slice(0, 400))
  }
  return { file, parts: files.length, bytes: fs.statSync(file).size }
}

/** 当前账号信息，用来判断"这是不是我自己的号" */
export async function whoami() {
  const me = await bili(['auth', 'status'])
  return { loggedIn: !!me?.logged_in, user: me?.user || null, selfMid: selfMid() }
}
