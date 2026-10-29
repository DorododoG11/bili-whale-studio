# 踩过的坑（给下一个改这个插件的人）

这四条都是真的把插件搞挂过、或者让整轮对话直接失败的，写下来省得再踩。

## 1. 工具参数不能是空对象

```js
// ✗ 会渲染成 "type": null，模型方拒收整个请求：
//   Invalid schema for function 'xxx': schema must be a JSON Schema of 'type: "object"', got 'type: null'
parameters: {}

// ✓ 至少给一个可选参数
parameters: { verbose: bool('附带完整配置') }
```

DSH 自带的 `get_goal` 能写 `parameters: {}`，是因为它经过 `defineTool` 编译；本插件不 import `@deepseek-ai/dsh-tools`（安装目录里解析不到），直接把定义对象交给注册表，空参数不会被补成 `{type:'object',properties:{},required:[]}`。

`test/smoke.mjs` 把这条钉住了，CI 会跑。

## 2. 改了 lib/*.js，必须重启 DSH 才能生效

Host 进程用 ESM 缓存模块。关掉插件再打开、`set_bundle`、HMR 都**不会**重新执行已经 import 过的文件。判断方法：

```powershell
Get-Item ~\.dsh\bili-studio\register.log | Select-Object LastWriteTime
```

时间戳没变 = 跑的还是旧模块。改代码 → 重启 → 再验证。

## 3. 插件激活失败会被回滚成 `disabled`

`plugin_manager` 的 `install_bundle` / `set_bundle` 会往 profile patch 里写 `- id: <row> disabled: true`，同时把 bundle 从 `dsh.profile.bundles` 里摘掉。表现是"明明 enabled 了，工具却不在"。先看 `list_bundles` 里的 `enabled`，再决定要不要重开。

## 4. B 站音频 CDN 校验 Referer / UA

直接 `ffmpeg -i <audio url>` 会 403。必须：

```
-headers "Referer: https://www.bilibili.com\r\nUser-Agent: <正常浏览器 UA>\r\n"
```

playurl 接口本身还要 Cookie（SESSDATA），否则拿不到高码率流。凭据只读 `~/.bili-ai/credentials.json`，不复制、不回显。

## 5. SAPI 合成中文：文本走 base64

PowerShell 命令行里塞中文和引号会被吃掉/转义错。做法是把文本 base64 后传进去，脚本里 `[Text.Encoding]::UTF8.GetString(...)` 还原。见 `lib/voice.js` 的 `speakWithSapi`。
