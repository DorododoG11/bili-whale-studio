/**
 * 大肥鱼工作室 · 客户端半边
 *
 * 往「设置」里加一页「工作室」：看草稿队列、点批准、点发布。
 * 数据全部走 /dsh-studio/api/*（同源 fetch）→ 与 studio_* 工具读同一份文件，
 * 界面上看到的就是草稿箱真实状态，不存在第二套。
 *
 * 用 inline style + 主题 token，不引第三方 CSS，也不 require 任何 DSH 客户端包。
 */
window.__ModuleLoader__.load({
  id: 'dsh-bili-whale-studio',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    const API = '/dsh-studio/api'

    const S = {
      root: { maxWidth: '760px', color: 'var(--dsw-alias-label-primary)', display: 'flex', flexDirection: 'column', gap: '10px' },
      title: { margin: 0, fontSize: '16px', fontWeight: 500, lineHeight: '24px' },
      intro: { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: '12.5px', lineHeight: '19px' },
      quota: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      badge: { display: 'inline-block', fontSize: '11px', lineHeight: '16px', padding: '1px 7px', borderRadius: '999px', background: 'rgba(127,127,127,.14)', color: 'var(--dsw-alias-label-secondary)' },
      list: { display: 'flex', flexDirection: 'column', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: '8px', overflow: 'hidden' },
      row: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '10px 12px', borderBottom: '.5px solid var(--dsw-alias-border-l2)' },
      rowHead: { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' },
      text: { margin: 0, fontSize: '12.5px', lineHeight: '19px', whiteSpace: 'pre-wrap', color: 'var(--dsw-alias-label-primary)' },
      meta: { fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      actions: { display: 'flex', gap: '8px', flexWrap: 'wrap' },
      btn: { border: '1px solid var(--dsw-alias-border-l2)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', borderRadius: '6px', height: '28px', padding: '0 10px', fontSize: '12px', cursor: 'pointer' },
      primary: { border: 'none', background: 'var(--dsw-alias-brand-primary)', color: 'var(--dsw-alias-label-primary-foreground,#fff)', borderRadius: '6px', height: '28px', padding: '0 12px', fontSize: '12px', cursor: 'pointer' },
      err: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' },
      ok: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' },
      empty: { padding: '16px 12px', color: 'var(--dsw-alias-label-tertiary)', fontSize: '12.5px' },
    }

    const STATUS_LABEL = {
      draft: '待点头',
      approved: '已批准',
      publishing: '发送中',
      published: '已发布',
      rejected: '已打回',
      failed: '失败',
    }
    const KIND_LABEL = { dynamic: '动态', video: '投稿' }

    function StudioSection() {
      const [data, setData] = useState({ loading: true, drafts: [], quota: null })
      const [busy, setBusy] = useState('')
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [showRejected, setShowRejected] = useState(false)

      const load = useCallback(async () => {
        setError('')
        try {
          const res = await fetch(API + '/queue', { headers: { Accept: 'application/json' } })
          const body = await res.json()
          if (!body.ok) throw new Error(body.error || '读取失败')
          setData({ loading: false, drafts: body.drafts || [], quota: body.quota || null })
        } catch (e) {
          setData((prev) => ({ ...prev, loading: false }))
          setError(String(e?.message || e))
        }
      }, [])

      useEffect(() => {
        load()
      }, [load])

      const act = useCallback(
        async (action, id) => {
          setBusy(action + ':' + id)
          setError('')
          setNotice('')
          try {
            const res = await fetch(API + '/action', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action, id }),
            })
            const body = await res.json()
            if (!body.ok) throw new Error(body.error || '操作失败')
            setNotice(
              action === 'approve' ? '已批准，可以发布了' : action === 'reject' ? '已打回' : body.result?.result?.bvid ? `已发布 ${body.result.result.bvid}` : '已发布',
            )
            await load()
          } catch (e) {
            setError(String(e?.message || e))
          } finally {
            setBusy('')
          }
        },
        [load],
      )

      const { drafts, quota } = data
      // 打回的是死稿，默认不占地方；想看历史再展开
      const rejectedCount = drafts.filter((d) => d.status === 'rejected').length
      const pending = drafts.filter((d) => d.status === 'draft').length
      const visible = showRejected ? drafts : drafts.filter((d) => d.status !== 'rejected')

      return h(
        'div',
        { style: S.root },
        h('h2', { style: S.title }, '工作室'),
        h('p', { style: S.intro }, '草稿箱。发布是不可撤销的公开动作，所以每条都要先点头；投稿会强制带 AI 声明。'),
        quota
          ? h(
              'div',
              { style: S.quota },
              h('span', null, `今天还能发 ${quota.remaining}/${quota.limit} 条`),
              h('span', { style: S.badge }, `${visible.length} 条`),
              pending ? h('span', { style: S.badge }, `待点头 ${pending}`) : null,
              rejectedCount && !showRejected ? h('span', { style: S.badge }, `已打回 ${rejectedCount} 条已收起`) : null,
            )
          : null,

        data.loading
          ? h('div', { style: S.empty }, '读取中…')
          : visible.length === 0
            ? h('div', { style: S.empty }, drafts.length ? '没有待处理的草稿，历史都在「显示已打回」里。' : '草稿箱是空的。让大肥鱼用 studio_queue 建一条试试。')
            : h(
                'div',
                { style: S.list },
                visible.map((draft) =>
                  h(
                    'div',
                    { key: draft.id, style: S.row },
                    h(
                      'div',
                      { style: S.rowHead },
                      h('span', { style: S.badge }, KIND_LABEL[draft.kind] || draft.kind),
                      h('span', { style: S.badge }, STATUS_LABEL[draft.status] || draft.status),
                      h('span', { style: S.meta }, draft.title || ''),
                      h('span', { style: { ...S.meta, marginLeft: 'auto' } }, draft.id),
                    ),
                    h('p', { style: S.text }, draft.text || '（无正文）'),
                    draft.basedOn?.length ? h('div', { style: S.meta }, '依据：' + draft.basedOn.join(' · ')) : null,
                    draft.error ? h('div', { style: S.err }, `${draft.error.code || 'error'}：${draft.error.message || ''}`) : null,
                    h(
                      'div',
                      { style: S.actions },
                      draft.status === 'draft'
                        ? h('button', { style: S.primary, disabled: busy !== '', onClick: () => act('approve', draft.id) }, busy === 'approve:' + draft.id ? '批准中…' : '批准')
                        : null,
                      draft.status === 'approved'
                        ? h(
                            'button',
                            {
                              style: S.primary,
                              disabled: busy !== '',
                              onClick: () => {
                                if (window.confirm('发出去就收不回，确定发布？')) act('publish', draft.id)
                              },
                            },
                            busy === 'publish:' + draft.id ? '发送中…' : '发布',
                          )
                        : null,
                      draft.status === 'draft' || draft.status === 'approved'
                        ? h('button', { style: S.btn, disabled: busy !== '', onClick: () => act('reject', draft.id) }, '打回')
                        : null,
                      draft.status === 'published' && draft.resultId
                        ? h('span', { style: S.meta }, 'B站 id：' + draft.resultId)
                        : null,
                    ),
                  ),
                ),
              ),

        h(
          'div',
          { style: S.actions },
          h('button', { style: S.btn, disabled: data.loading || busy !== '', onClick: load }, '刷新'),
          rejectedCount
            ? h(
                'button',
                { style: S.btn, onClick: () => setShowRejected((v) => !v) },
                showRejected ? `收起已打回（${rejectedCount}）` : `显示已打回（${rejectedCount}）`,
              )
            : null,
          notice ? h('span', { style: S.ok }, notice) : null,
        ),
        error ? h('div', { style: S.err }, error) : null,
      )
    }

    function apply(ctx) {
      ctx.effect(
        () =>
          ctx.slots.inject(
            'settings.section',
            () =>
              ctx.slots.register(
                { name: 'settings.section', id: 'whale-studio', order: 7, label: () => '工作室' },
                StudioSection,
              ),
            'whale-studio: settings section',
          ),
        'whale-studio: settings section',
      )
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.StudioSection = StudioSection
    return module.exports
  },
})
