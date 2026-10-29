// 最轻的自检：不需要 DSH、不需要 B 站、不碰网络。
// 它守的是一条踩过的坑：工具参数不能是空对象 —— 注册不经过 defineTool 编译，
// 空参数会被渲染成 "type": null，模型方会以 "Invalid schema for function" 拒收整个请求。
import assert from 'node:assert/strict'
import { defineStudioTools } from '../lib/tools.js'

const tools = defineStudioTools()

assert.equal(tools.length, 10, '工具数量变了？同步更新 README 和这个断言')
assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, '工具名不能重复')

for (const tool of tools) {
  assert.match(tool.name, /^studio_[a-z]+$/, `${tool.name} 命名不符`)
  assert.ok(tool.description?.length > 10, `${tool.name} 缺说明`)
  assert.equal(typeof tool.execute, 'function', `${tool.name} 没有 execute`)
  assert.ok(tool.output?.schema, `${tool.name} 没有 output.schema`)
  assert.equal(typeof tool.output.render, 'function', `${tool.name} 没有 output.render`)

  const params = tool.parameters || {}
  assert.ok(Object.keys(params).length > 0, `${tool.name} 的参数 schema 不能为空（会渲染成 type:null）`)
  for (const [key, spec] of Object.entries(params)) {
    assert.ok(['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(spec.type), `${tool.name}.${key} 类型非法`)
  }
}

assert.deepEqual(
  tools.map((t) => t.name),
  [
    'studio_status',
    'studio_learn',
    'studio_note',
    'studio_voice',
    'studio_style',
    'studio_say',
    'studio_video',
    'studio_queue',
    'studio_publish',
    'studio_history',
  ],
  '工具顺序/名称变了',
)

console.log(`ok — ${tools.length} 个工具通过 schema 自检`)
