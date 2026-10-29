/**
 * 学习：从 B 站搜教程 → 一条视频看全（AI 总结 / 字幕全文 / 章节 / 评论）→ 落成笔记。
 *
 * 两段式是为了留下人和模型都能读的东西：
 *   learn_fetch 存原始数据（knowledge/raw/BVxxx.json），模型据此写笔记；
 *   learn_note  存提炼结果（knowledge/notes/<id>.md），以后写稿直接翻。
 * "学了"不是把视频看完，是把可复用的结论留下来了。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { bili, StudioError } from './bili.js'
import { NOTES_DIR, RAW_DIR, loadConfig } from './paths.js'

const shortId = (prefix) => `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`

export async function searchTutorials(keyword, size) {
  const cfg = loadConfig()
  const n = Math.max(1, Math.min(Number(size) || cfg.learn.defaultSize, 20))
  const data = await bili(['search', 'video', keyword, '--size', String(n)])
  return (data.items || []).map((it) => ({
    bvid: it.bvid,
    title: it.title,
    author: it.author?.name || '',
    mid: it.author?.mid ?? null,
    duration: it.duration || '',
    play: it.play ?? 0,
    pubdate: it.pubdate || '',
    desc: (it.desc || '').slice(0, 200),
  }))
}

/** 一条视频看全并落盘。返回精简视图 + raw 文件位置。 */
export async function fetchVideo(bv, { maxChars, comments } = {}) {
  const cfg = loadConfig()
  const chars = Math.max(500, Math.min(Number(maxChars) || cfg.learn.maxChars, 20000))
  const cmt = Math.max(0, Math.min(Number(comments ?? cfg.learn.includeComments), 20))
  const data = await bili(['video', 'watch', bv, '--max-chars', String(chars), '--comments', String(cmt)], {
    timeoutMs: 300_000,
  })

  const record = {
    ...data,
    fetchedAt: new Date().toISOString(),
  }
  const file = path.join(RAW_DIR, `${String(data.bvid || bv).replace(/[^\w-]/g, '')}.json`)
  fs.writeFileSync(file, JSON.stringify(record, null, 2), 'utf8')

  const transcript = data.transcript || data.subtitle || data.text || ''
  return {
    bvid: data.bvid || bv,
    title: data.title || '',
    owner: data.owner?.name || '',
    duration: data.duration ?? null,
    summary: data.summary || data.aiSummary || '',
    chapters: Array.isArray(data.chapters) ? data.chapters.slice(0, 12) : [],
    transcriptChars: typeof transcript === 'string' ? transcript.length : 0,
    transcriptHead: typeof transcript === 'string' ? transcript.slice(0, 1200) : '',
    comments: Array.isArray(data.comments) ? data.comments.slice(0, 3) : [],
    rawFile: file,
  }
}

function noteFile(id) {
  return path.join(NOTES_DIR, `${id}.md`)
}

function frontmatter(note) {
  const tags = (note.tags || []).map((t) => String(t).replace(/\s+/g, '-')).join(', ')
  const bvids = (note.bvids || []).join(', ')
  return [
    '---',
    `id: ${note.id}`,
    `title: ${note.title}`,
    `tags: ${tags}`,
    `bvids: ${bvids}`,
    `created: ${note.createdAt}`,
    '---',
    '',
  ].join('\n')
}

export function saveNote({ title, body, tags = [], bvids = [] }) {
  if (!title || !String(title).trim()) {
    throw new StudioError('empty_note', '笔记得有个标题。', '标题写清楚"学到了什么"，以后好翻。')
  }
  if (!body || !String(body).trim()) {
    throw new StudioError('empty_note', '笔记正文是空的。', '把结论、步骤、坑写成别人能照着做的样子。')
  }
  const note = {
    id: shortId('kn'),
    title: String(title).trim().slice(0, 120),
    tags: Array.isArray(tags) ? tags.slice(0, 8) : [],
    bvids: Array.isArray(bvids) ? bvids.slice(0, 10) : [],
    createdAt: new Date().toISOString(),
    body: String(body).trim(),
  }
  const file = noteFile(note.id)
  fs.writeFileSync(file, frontmatter(note) + note.body + '\n', 'utf8')
  return { ...note, file }
}

function parseNote(file) {
  const text = fs.readFileSync(file, 'utf8')
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!m) return null
  const meta = {}
  for (const line of m[1].split('\n')) {
    const idx = line.indexOf(':')
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return {
    id: meta.id || path.basename(file, '.md'),
    title: meta.title || '',
    tags: meta.tags ? meta.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
    bvids: meta.bvids ? meta.bvids.split(',').map((t) => t.trim()).filter(Boolean) : [],
    createdAt: meta.created || '',
    body: m[2].trim(),
    file,
  }
}

export function listNotes(query = '', limit = 30) {
  const files = fs.existsSync(NOTES_DIR) ? fs.readdirSync(NOTES_DIR).filter((f) => f.endsWith('.md')) : []
  const q = String(query || '').toLowerCase()
  const notes = []
  for (const file of files) {
    const note = parseNote(path.join(NOTES_DIR, file))
    if (!note) continue
    if (q) {
      const hay = `${note.title} ${note.tags.join(' ')} ${note.body}`.toLowerCase()
      if (!hay.includes(q)) continue
    }
    notes.push({
      id: note.id,
      title: note.title,
      tags: note.tags,
      bvids: note.bvids,
      createdAt: note.createdAt,
      excerpt: note.body.slice(0, 160),
    })
  }
  notes.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return notes.slice(0, Math.max(1, Math.min(Number(limit) || 30, 200)))
}

export function readNote(id) {
  const file = noteFile(String(id || '').replace(/[^\w-]/g, ''))
  if (!fs.existsSync(file)) {
    throw new StudioError('note_missing', `没有这条笔记：${id}`, '用 studio_knowledge 列一下现有的 id。')
  }
  const note = parseNote(file)
  return note || { id, title: '', body: '', tags: [], bvids: [], createdAt: '' }
}
