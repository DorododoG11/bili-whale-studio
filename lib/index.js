/**
 * 大肥鱼工作室 · 宿主插件
 *
 * 只做一件事：把 studio_* 工具注册给 agent。
 * 所有能力都在 lib/ 里，工具层只负责参数校验和"把结果说人话"。
 *
 * 设计上故意不碰 DSH 的内部服务（session / projections / slots）：
 * 工作室的状态是文件，重启、换会话、换机器都能接着干；
 * 模型看到的东西永远能从磁盘重新读出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { defineStudioTools } from './tools.js'
import { ensureDirs, STUDIO_DIR } from './paths.js'

export const name = 'dsh-bili-whale-studio'
export const inject = ['tools']

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
}
