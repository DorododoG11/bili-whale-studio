/**
 * 工作室的浏览器接口。
 *
 * 设置页里的「工作室」面板不直接读文件——它走这三条同源路由，
 * 和 studio_* 工具读的是同一份数据（drafts.js / publish.js），不存在第二套状态。
 *
 * 所有路由都过 DSH 的信任栅栏：Web 端口在回环上，但浏览器里任何网页都能往回环发请求，
 * 不加栅栏等于把「批准 / 发布」这种写操作开放给任意页面。
 */
import { listDrafts, summarize, quotaState, approveDraft, rejectDraft } from './drafts.js'
import { publishDraft } from './publish.js'

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

export function registerStudioRoutes(ctx) {
  const disposers = []

  /** 栅栏不可用时按拒绝处理（fail-closed），写操作尤其不能放行 */
  function trusted(req) {
    try {
      const conn = ctx.get('connection') || ctx.connection
      if (!conn || typeof conn.requestRejection !== 'function') return false
      const code = conn.requestRejection(req)
      return code === undefined || code === null || code === false
    } catch {
      return false
    }
  }

  function route(path, handler) {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path,
        handler: async (req, res) => {
          if (!trusted(req)) {
            json(res, 403, { ok: false, error: '不受信任的访问来源' })
            return
          }
          try {
            await handler(req, res)
          } catch (error) {
            json(res, 500, { ok: false, error: String(error?.message ?? error) })
          }
        },
      }),
    )
  }

  route('/dsh-studio/api/queue', async (req, res) => {
    if (req.method !== 'GET') return json(res, 405, { ok: false, error: '只支持 GET' })
    const drafts = listDrafts().map((draft) => ({
      ...summarize(draft),
      text: String(draft.text || '').slice(0, 240),
      tags: draft.tags || [],
      basedOn: draft.basedOn || [],
      publishedAt: draft.publishedAt || '',
      resultId: draft.resultId || '',
      error: draft.error || null,
    }))
    json(res, 200, { ok: true, quota: quotaState(), drafts })
  })

  route('/dsh-studio/api/action', async (req, res) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: '只支持 POST' })
    const body = JSON.parse((await readBody(req)) || '{}')
    const { action, id, reason } = body || {}
    if (!id) return json(res, 400, { ok: false, error: '缺少草稿 id' })

    if (action === 'approve') {
      return json(res, 200, { ok: true, draft: summarize(approveDraft(id)), quota: quotaState() })
    }
    if (action === 'reject') {
      return json(res, 200, { ok: true, draft: summarize(rejectDraft(id, reason || '')), quota: quotaState() })
    }
    if (action === 'publish') {
      const result = await publishDraft(id)
      return json(res, 200, { ok: true, result, quota: quotaState() })
    }
    json(res, 400, { ok: false, error: `未知操作：${action}` })
  })

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        /* 卸载时不抛 */
      }
    }
  }
}
