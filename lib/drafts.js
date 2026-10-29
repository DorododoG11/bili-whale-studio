/**
 * 草稿箱。
 *
 * 一条草稿就是一个 json 文件。状态是单向的：
 *   draft → approved → publishing → published
 *              ↘ rejected
 * 只有 approved 能被发出去；publish 之后不会自动退回可编辑状态 —— 重发要新建草稿，
 * 这样日志和实际发布对得上。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DRAFT_DIR, loadConfig } from './paths.js'
import { StudioError } from './bili.js'

const shortId = () => `dr_${Date.now().toString(36)}${crypto.randomBytes(2).toString('hex')}`

const KINDS = ['dynamic', 'video']
export const STATUSES = ['draft', 'approved', 'publishing', 'published', 'rejected', 'failed']

function file(id) {
  return path.join(DRAFT_DIR, `${String(id).replace(/[^\w-]/g, '')}.json`)
}

function read(id) {
  try {
    return JSON.parse(fs.readFileSync(file(id), 'utf8'))
  } catch {
    return null
  }
}

function write(draft) {
  fs.writeFileSync(file(draft.id), JSON.stringify(draft, null, 2), 'utf8')
  return draft
}

export function createDraft(input) {
  const kind = String(input.kind || '').toLowerCase()
  if (!KINDS.includes(kind)) {
    throw new StudioError('bad_kind', `草稿类型只能是 ${KINDS.join(' / ')}。`, '动态是 dynamic，投稿是 video。')
  }
  const text = String(input.text || '').trim()
  if (kind === 'dynamic' && !text) {
    throw new StudioError('empty_text', '动态没有正文。', '先想清楚要说什么，再进草稿箱。')
  }
  if (kind === 'video' && !input.video) {
    throw new StudioError('no_video', '投稿草稿没有视频文件。', '先用 studio_video 合成，再把路径写进来。')
  }
  const draft = {
    id: shortId(),
    kind,
    status: 'draft',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    text,
    title: String(input.title || '').slice(0, 80),
    tags: Array.isArray(input.tags) ? input.tags.slice(0, 10) : [],
    images: Array.isArray(input.images) ? input.images.slice(0, 9) : [],
    video: input.video ? String(input.video) : '',
    cover: input.cover ? String(input.cover) : '',
    audio: input.audio ? String(input.audio) : '',
    /** 内容依据：哪条笔记 / 哪个 BV，方便以后回答"这话从哪来的" */
    basedOn: Array.isArray(input.basedOn) ? input.basedOn.slice(0, 10) : [],
    note: String(input.note || ''),
    log: [],
  }
  return write(draft)
}

export function getDraft(id) {
  const draft = read(id)
  if (!draft) throw new StudioError('draft_missing', `没有这条草稿：${id}`, '用 studio_queue 列一下。')
  return draft
}

export function listDrafts(status) {
  const files = fs.existsSync(DRAFT_DIR) ? fs.readdirSync(DRAFT_DIR).filter((f) => f.endsWith('.json')) : []
  const all = files.map((f) => read(path.basename(f, '.json'))).filter(Boolean)
  const filtered = status ? all.filter((d) => d.status === status) : all
  filtered.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return filtered
}

export function setStatus(id, status, patch = {}) {
  if (!STATUSES.includes(status)) {
    throw new StudioError('bad_status', `未知状态：${status}`, `可用：${STATUSES.join(' / ')}`)
  }
  const draft = getDraft(id)
  draft.status = status
  draft.updatedAt = new Date().toISOString()
  Object.assign(draft, patch)
  draft.log.push({ at: draft.updatedAt, status })
  return write(draft)
}

export function approveDraft(id, { by = 'user', note = '' } = {}) {
  const draft = getDraft(id)
  if (draft.status !== 'draft') {
    throw new StudioError('bad_transition', `草稿是 ${draft.status}，不能再批一次。`, '只有 draft 能变成 approved。')
  }
  return setStatus(id, 'approved', { approvedBy: by, approvedAt: new Date().toISOString(), approvalNote: note })
}

export function rejectDraft(id, reason = '') {
  const draft = getDraft(id)
  if (draft.status === 'published') {
    throw new StudioError('bad_transition', '已经发出去的东西不能回退成 rejected。', '要撤就去 B 站删，然后新建一条草稿。')
  }
  return setStatus(id, 'rejected', { rejectReason: String(reason).slice(0, 200) })
}

/** 给人看的摘要：别把整个 json 塞回会话里 */
export function summarize(draft) {
  return {
    id: draft.id,
    kind: draft.kind,
    status: draft.status,
    title: draft.title || draft.text.slice(0, 40),
    text: draft.text.slice(0, 200),
    assets: { images: draft.images.length, video: draft.video || '', audio: draft.audio || '' },
    createdAt: draft.createdAt,
    approvedBy: draft.approvedBy || '',
  }
}

export function quotaState() {
  const cfg = loadConfig()
  const today = new Date().toISOString().slice(0, 10)
  let used = 0
  try {
    const lines = fs.readFileSync(path.join(path.dirname(DRAFT_DIR), 'publish-log.jsonl'), 'utf8').split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const rec = JSON.parse(line)
        if (rec.ok && String(rec.at).slice(0, 10) === today) used++
      } catch {
        /* 坏行不影响计数 */
      }
    }
  } catch {
    /* 还没发过 */
  }
  return { used, limit: cfg.maxPublishPerDay, remaining: Math.max(0, cfg.maxPublishPerDay - used), day: today }
}
