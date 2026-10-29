/**
 * 发布：草稿 → 真正发出去。
 *
 * 这里的每一条限制都是"发出去就收不回"换来的：
 *   - 必须 approved（除非 config.requireApproval 被关掉，那是你自己的选择）；
 *   - 每天有配额，按 publish-log.jsonl 记账，不按内存计数；
 *   - 投稿永远带 AI 声明（bili upload 默认行为，代码里不传 --no-ai-declare）；
 *   - 发完把结果写进日志，失败也写 —— 不然明天配额会算错。
 */
import fs from 'node:fs'
import path from 'node:path'
import { bili, StudioError } from './bili.js'
import { LOG_FILE, loadConfig } from './paths.js'
import { getDraft, setStatus, quotaState } from './drafts.js'

function log(record) {
  fs.appendFileSync(LOG_FILE, JSON.stringify(record) + '\n', 'utf8')
}

/** 给人在发之前看一眼：会执行什么、带什么素材 */
export function previewDraft(id) {
  const draft = getDraft(id)
  const cfg = loadConfig()
  const small = {
    id: draft.id,
    kind: draft.kind,
    status: draft.status,
    text: draft.text,
    title: draft.title,
    tags: draft.tags,
    images: draft.images,
    video: draft.video,
    cover: draft.cover,
    basedOn: draft.basedOn,
  }
  const command =
    draft.kind === 'dynamic'
      ? ['bili', 'dynamic', 'post', draft.text, ...draft.images.flatMap((i) => ['--image', i])]
      : ['bili', 'upload', 'video', draft.video, '--title', draft.title, ...draft.tags.flatMap((t) => ['--tag', t]), '--desc', draft.text]
  return {
    ...small,
    wouldRun: command,
    quota: quotaState(),
    needsApproval: cfg.requireApproval,
    ready: draft.status === 'approved' || !cfg.requireApproval,
  }
}

export async function publishDraft(id, { dryRun = false } = {}) {
  const cfg = loadConfig()
  const draft = getDraft(id)

  if (cfg.requireApproval && draft.status !== 'approved') {
    throw new StudioError(
      'not_approved',
      `草稿 ${id} 还是 ${draft.status}，没经过你点头我不能发。`,
      '先把内容给人看，他说可以了，再 studio_queue action=approve。',
    )
  }
  if (draft.status === 'published') {
    throw new StudioError('already_published', '这条已经发过了。', '要改动就去 B 站改，或者新建草稿。')
  }

  const quota = quotaState()
  if (quota.remaining <= 0) {
    throw new StudioError(
      'quota_exhausted',
      `今天的 ${quota.limit} 条已经用完了。`,
      '限额在 ~/.dsh/bili-studio/config.json 的 maxPublishPerDay；改它之前先想想账号的安全。',
    )
  }

  if (dryRun) {
    return { dryRun: true, ...previewDraft(id), quota }
  }

  setStatus(id, 'publishing')
  const at = new Date().toISOString()

  try {
    let result
    if (draft.kind === 'dynamic') {
      const args = ['dynamic', 'post', draft.text]
      for (const image of draft.images) args.push('--image', image)
      result = await bili(args, { timeoutMs: 180_000 })
    } else {
      if (!draft.title) throw new StudioError('no_title', '投稿要有标题。', '在草稿里补 title。')
      if (!draft.tags.length) throw new StudioError('no_tags', '投稿至少要有 1 个标签。', '在草稿里补 tags。')
      const args = ['upload', 'video', draft.video, '--title', draft.title, '--desc', draft.text]
      for (const tag of draft.tags) args.push('--tag', tag)
      if (draft.cover) args.push('--cover', draft.cover)
      result = await bili(args, { timeoutMs: 30 * 60_000 })
    }

    log({ at, ok: true, id, kind: draft.kind, result })
    setStatus(id, 'published', { publishedAt: at, resultId: result?.bvid || result?.dynamic_id || result?.id || '' })
    return { ok: true, id, kind: draft.kind, result, quota: quotaState() }
  } catch (error) {
    log({
      at,
      ok: false,
      id,
      kind: draft.kind,
      code: error.code || 'unknown',
      message: error.message,
    })
    setStatus(id, 'failed', { error: { code: error.code || 'unknown', message: error.message } })
    throw error
  }
}

/** 发过什么 —— 复盘用，也用来回答"这条到底发出去了没有" */
export function publishHistory(limit = 20) {
  let lines = []
  try {
    lines = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(Boolean).slice(-500)
  } catch {
    return []
  }
  return lines
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
    .slice(-Math.max(1, Math.min(Number(limit) || 20, 200)))
    .reverse()
}
