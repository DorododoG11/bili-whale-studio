/**
 * 声音风格：从一条**别人的**视频里学她怎么说话，但不拿她的音频。
 *
 * 这是授权上的分界线：风格是公共的（语速、句长、语气词、口头禅），
 * 声纹不是。所以这里只做文本统计 + 摘录，产出一张「声音设定卡」，
 * 最后由自己的声音（系统 TTS 或自己训的引擎）去演。
 *
 * 统计是本地算的，不联网、不调模型：字/秒、句长分布、高频短语、标点习惯。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fetchVideo } from './learn.js'
import { VOICE_DIR } from './paths.js'
import { StudioError } from './bili.js'

const STYLE_DIR = () => path.join(VOICE_DIR, 'styles')

const isCJK = (ch) => /[\u4e00-\u9fff]/.test(ch)

function extractText(raw) {
  const candidates = [raw.transcript, raw.subtitle, raw.text, raw.subtitles]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c
    if (Array.isArray(c)) {
      const joined = c.map((x) => (typeof x === 'string' ? x : x?.text || x?.content || '')).join('\n')
      if (joined.trim()) return joined
    }
  }
  return ''
}

function countNgrams(text, n, min) {
  const counts = new Map()
  const clean = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '')
  for (let i = 0; i + n <= clean.length; i++) {
    const gram = clean.slice(i, i + n)
    if (![...gram].some(isCJK)) continue
    counts.set(gram, (counts.get(gram) || 0) + 1)
  }
  return [...counts.entries()]
    .filter(([, c]) => c >= min)
    .sort((a, b) => b[1] - a[1])
}

/** 太常见的虚词短语不算"口头禅" */
const STOP = new Set([
  '这个', '那个', '就是', '然后', '所以', '因为', '但是', '可以', '我们', '你们', '他们',
  '一个', '什么', '怎么', '这样', '那样', '不是', '没有', '还是', '已经', '现在', '时候',
])

export async function analyzeStyle(bv, { maxChars = 12000 } = {}) {
  const fetched = await fetchVideo(bv, { maxChars, comments: 5 })
  const raw = JSON.parse(fs.readFileSync(fetched.rawFile, 'utf8'))
  const text = extractText(raw)
  if (!text) {
    throw new StudioError(
      'no_transcript',
      '这条视频没有字幕/转写，读不出说话方式。',
      '可以先 `bili asr setup` 配好转写，或者换一条有字幕的。',
    )
  }

  const duration = Number(raw.duration) || 0
  const cjkCount = [...text].filter(isCJK).length
  const sentences = text
    .split(/[。！？!?…]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  const lengths = sentences.map((s) => [...s].filter(isCJK).length)
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0

  const exclaim = (text.match(/[！!]/g) || []).length
  const question = (text.match(/[？?]/g) || []).length
  const ellipsis = (text.match(/…{1,2}|\.{3,}/g) || []).length
  const emoji = (text.match(/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/gu) || []).length

  const catchphrases = countNgrams(text, 3, 3)
    .concat(countNgrams(text, 2, 4))
    .filter(([gram]) => !STOP.has(gram))
    .slice(0, 12)
    .map(([gram, count]) => ({ phrase: gram, count }))

  const samples = sentences
    .filter((s) => s.length >= 6 && s.length <= 40)
    .sort((a, b) => Math.abs(a.length - avg) - Math.abs(b.length - avg))
    .slice(0, 6)

  return {
    bvid: fetched.bvid,
    title: fetched.title,
    owner: fetched.owner,
    duration,
    style: {
      charsPerSecond: duration ? Number((cjkCount / duration).toFixed(2)) : null,
      totalChars: cjkCount,
      sentence: {
        count: sentences.length,
        avg: Number(avg.toFixed(1)),
        shortest: lengths.length ? Math.min(...lengths) : 0,
        longest: lengths.length ? Math.max(...lengths) : 0,
      },
      punctuation: {
        exclaim,
        question,
        ellipsis,
        emoji,
        perHundredChars: cjkCount
          ? {
              exclaim: Number(((exclaim / cjkCount) * 100).toFixed(2)),
              question: Number(((question / cjkCount) * 100).toFixed(2)),
            }
          : null,
      },
      catchphrases,
    },
    samples,
    note: '这些是别人的原句，只用来理解语气，不要照抄进自己的作品；卡里写提炼后的特征。',
  }
}

export function saveStyle({ name, card, basedOn = [], tags = [] }) {
  if (!name || !String(name).trim()) throw new StudioError('empty_name', '给这张设定卡起个名字。', '')
  if (!card || !String(card).trim()) throw new StudioError('empty_card', '设定卡是空的。', '')
  fs.mkdirSync(STYLE_DIR(), { recursive: true })
  const slug = String(name)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || `style-${Date.now().toString(36)}`
  const file = path.join(STYLE_DIR(), `${slug}.md`)
  const head = [
    '---',
    `name: ${name}`,
    `basedOn: ${(basedOn || []).join(', ')}`,
    `tags: ${(tags || []).join(', ')}`,
    `created: ${new Date().toISOString()}`,
    '---',
    '',
    '> 风格参考，不是声纹复制。演的时候用自己的声音。',
    '',
  ].join('\n')
  fs.writeFileSync(file, head + String(card).trim() + '\n', 'utf8')
  return { slug, name, file, basedOn }
}

export function listStyles() {
  const dir = STYLE_DIR()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const text = fs.readFileSync(path.join(dir, f), 'utf8')
      const meta = {}
      const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
      if (m) {
        for (const line of m[1].split('\n')) {
          const i = line.indexOf(':')
          if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
        }
      }
      return { slug: f.replace(/\.md$/, ''), name: meta.name || f, basedOn: meta.basedOn || '', created: meta.created || '' }
    })
}
