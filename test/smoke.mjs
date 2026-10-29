// 最轻的自检：不需要 DSH、不需要 B 站、不碰网络。
//
// 守的是这次真踩到的坑：注册给模型的 parameters 必须是**标准 JSON Schema**
// （外层要有 type:"object"），不是 { 参数名: {...} } 那层 DSL。
// 少了这层编译，模型侧会报：
//   Invalid schema for function 'xxx': schema must be a JSON Schema of 'type: "object"', got 'type: null'
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

  const params = tool.parameters
  assert.equal(params?.type, 'object', `${tool.name}.parameters 必须是 type:"object" 的 JSON Schema`)
  assert.equal(typeof params.properties, 'object', `${tool.name}.parameters 缺 properties`)
  assert.ok(Array.isArray(params.required), `${tool.name}.parameters.required 必须是数组`)

  for (const [key, spec] of Object.entries(params.properties)) {
    assert.ok(
      ['string', 'number', 'integer', 'boolean', 'array', 'object'].includes(spec.type),
      `${tool.name}.${key} 类型非法：${spec.type}`,
    )
    assert.equal(spec.required, undefined, `${tool.name}.${key} 的 required 应该提到外层数组里，不能留在属性上`)
    if (spec.type === 'array') assert.ok(spec.items, `${tool.name}.${key} 数组缺 items`)
  }

  for (const name of params.required) {
    assert.ok(params.properties[name], `${tool.name} 的 required 里有不存在的参数：${name}`)
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

// 反向用例：DSL 编译必须把 required 提出来，而不是留在属性上
const sample = tools.find((t) => t.name === 'studio_learn').parameters
assert.deepEqual(sample.required, ['action'], 'studio_learn 只有 action 是必填')
assert.equal(sample.properties.action.type, 'string')
assert.deepEqual(sample.properties.action.enum, ['search', 'fetch'])

console.log(`ok — ${tools.length} 个工具的 parameters 都是合法 JSON Schema`)
