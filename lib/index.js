/**
 * 大肥鱼工作室 · 宿主插件
 *
 * 两件事：把 studio_* 工具注册给 agent；给设置页的工作室面板开三条同源路由。
 * 状态永远在磁盘（~/.dsh/bili-studio/），工具和面板读的是同一份，
 * 重启、换会话、换机器都能接着干。
 */
import fs from 'node:fs'
import path from 'node:path'
import { defineStudioTools } from './tools.js'
import { registerStudioRoutes } from './api.js'
import { ensureDirs, STUDIO_DIR } from './paths.js'

export const name = 'dsh-bili-whale-studio'
export const inject = ['tools', 'webServer', 'connection']

export function apply(ctx, _config) {
  ensureDirs()

  ctx.effect(() => {
    const disposers = []
    const failed = []
    for (const definition of defineStudioTools()) {
      try {
        disposers.push(ctx.tools.register(definition))
      } catch (error) {
        failed.push({ tool: definition.name, message: error?.message || String(error), stack: error?.stack || '' })
      }
    }

    // 注册过程写进日志：插件坏掉时，诊断信息不能只活在控制台里
    try {
      fs.writeFileSync(
        path.join(STUDIO_DIR, 'register.log'),
        JSON.stringify({ at: new Date().toISOString(), registered: disposers.length, failed }, null, 2),
        'utf8',
      )
    } catch {
      /* 写不了日志也不能让插件挂掉 */
    }

    if (failed.length) console.warn(`[studio] ${failed.length} 个工具没注册上`, failed.map((f) => f.message).join(' | '))
    console.log(`[studio] 已注册 ${disposers.length} 个工具，数据目录 ${STUDIO_DIR}`)

    return () => {
      for (const dispose of disposers) {
        try {
          dispose()
        } catch {
          /* 卸载时不该再抛 */
        }
      }
    }
  })

  // 设置页「工作室」面板用的同源接口（读队列 / 批准 / 打回 / 发布）
  ctx.effect(() => registerStudioRoutes(ctx), 'studio: routes')
}
