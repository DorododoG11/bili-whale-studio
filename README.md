# 大肥鱼工作室 · dsh-bili-whale-studio

一个 DeepSeek Harness（DSH）插件：让 agent 在 B 站**自学**、**有自己的声音**、**把内容做成动态和视频**——但发出去之前必须过草稿箱。

它不是又一个"自动发帖机"。三件事分开做，每件都能单独验证：

| 能力 | 做什么 | 落点 |
|---|---|---|
| 学 | 搜教程 → 看全一条（AI 总结 / 字幕 / 章节 / 评论）→ 写成笔记 | `~/.dsh/bili-studio/knowledge/` |
| 声 | 从**自己号**的视频里取干声 → 音色素材；公共音色按参数调音 | `~/.dsh/bili-studio/voices/` |
| 发 | 动态 / 投稿 → 草稿箱 → 人点头 → 发 | `~/.dsh/bili-studio/drafts/` |

底层不重造轮子：B 站操作全部走 [`bili-cli`](https://github.com/)（`bili` 命令），音视频处理走 ffmpeg，语音用系统 SAPI，插件只负责编排、留痕和兜底。

---

## 为什么这样设计

**1. 学习要能变成"下次能直接用"的东西。**
`studio_learn action=fetch` 会把整条视频的原始数据存成 json，笔记存成带 frontmatter 的 md。写动态时 `studio_note action=list` 一搜就知道自己学过什么，不用重新看一遍视频。

**2. 声音的边界写在代码里。**
`studio_voice action=pull` 只接受：
- 自己号（`~/.dsh/bili-whale.config.json` 里的 `self.mid`），或
- `config.allowedOwnerMids` 里显式列出的号，或
- 调用时显式 `authorized=true`（会连同来源一起记进 `meta.json`）。

别人的视频一律拒绝。原因不是技术：**声纹是人格标识**，拿别人的声音去直播/唱歌/发视频，等于用别人的身份说话，平台按侵权处理。

想"像"某个人的说话方式，有另一条正路：`studio_style action=analyze` 从字幕里统计语速、句长、标点习惯、口头禅，存成风格卡，再用**自己的**声音 + `tune` 出来的参数去演。风格是公共的，声纹不是。

**3. 发布默认要人点头。**
草稿状态只往一个方向走：`draft → approved → publishing → published`。`requireApproval` 打开时（默认），没 approved 的草稿调 `studio_publish` 直接报错。另外还有：每日配额（按 `publish-log.jsonl` 记账）、投稿强制 AI 声明、失败也记账。

---

## 安装

前提：DSH ≥ 0.4，`bili` CLI 已登录（`bili auth status` 返回 `logged_in: true`），系统有 ffmpeg。

```bash
# 1. 放到任意工作目录
git clone <this-repo> bili-studio && cd bili-studio

# 2. 装进当前 profile（DSH 会自己 apply patch）
#    在 DSH 里对 agent 说：
#    「把 C:\path\to\bili-studio 作为 bundle 安装到当前 profile」
#    或直接调用 plugin_manager install_bundle(target: <绝对路径>)
```

装完 `studio_status` 应该能回答：B 站登没登、ffmpeg 在不在、今天还能发几条、本地攒了多少东西。

### 配置

首次运行会生成 `~/.dsh/bili-studio/config.json`，改完不用重启（每次调用都重读）：

```jsonc
{
  "biliPath": "C:\\Users\\you\\.local\\bin\\bili.exe",
  "ffmpegPath": "C:\\Users\\you\\.dsh\\bili-whale\\bin\\ffmpeg.exe",
  "maxPublishPerDay": 3,
  "requireApproval": true,
  "allowedOwnerMids": [],
  "voice": {
    "engine": "sapi",              // sapi | command
    "sapiVoice": "Microsoft Huihui Desktop",
    "rate": 0,                     // -10 ~ 10
    "pitch": 1.0,                  // 0.8 ~ 1.25
    "cloneCommand": ""             // engine=command 时："{input}" 文本文件 → "{out}" wav
  },
  "compose": { "width": 1920, "height": 1080, "fps": 30 }
}
```

`voice.engine = "command"` 是给外部 TTS/克隆引擎留的口子：任何"文本文件进、wav 出"的命令行都能接，比如本地跑的 GPT-SoVITS、Fish-Speech 之类。接什么由你决定，插件不替你下载模型。

---

## 工具

| 工具 | 一句话 |
|---|---|
| `studio_status` | 自检：登录、依赖、配额、库存 |
| `studio_learn` | `search` 找教程 / `fetch` 看全一条并落盘 |
| `studio_note` | `save` / `list` / `read` 笔记 |
| `studio_voice` | `pull` / `list` / `remove` / `ref` / `voices` / `tune` |
| `studio_style` | `analyze` / `save` / `list` 声音风格卡 |
| `studio_say` | 文字 → wav（语速、音高可调） |
| `studio_video` | 图片 + 配音 → 1080p mp4 |
| `studio_queue` | 草稿：`new` / `list` / `show` / `preview` / `approve` / `reject` |
| `studio_publish` | 发出去（只认 approved，带配额） |
| `studio_history` | 发布记账 |

### 一条完整链路

```
studio_learn  search  "DeepSeek Harness 插件"
studio_learn  fetch   BV1xxxx
studio_note   save    title="DSH 插件的最小骨架"  body="……"
studio_say    text="今天学了插件骨架……"  pitch=1.06
studio_video  audio=out/say-xxx.wav  images=["cover.png"]
studio_queue  new     kind=video title="……" tags=["DSH"] video=out/video-xxx.mp4
studio_queue  preview id=dr_xxx      # 人看一眼
studio_queue  approve id=dr_xxx      # 人点头
studio_publish id=dr_xxx
```

---

## 设置页里的「工作室」面板

装好后打开 **设置 → 工作室**：

- 列出草稿队列（类型 / 状态 / 正文 / 依据），显示今天还剩几条配额；
- 待点头的草稿可以直接点 **批准**（或 **打回**）；
- 已批准的草稿点 **发布** 才真正发出去（带一次确认对话框）；
- 已发布的显示 B 站 id。

面板不直读文件，走宿主开的三条同源路由 `/dsh-studio/api/*`；这三条和 `studio_*` 工具读的是同一份磁盘状态，所以**界面、工具、对话三者永远一致**。路由全部过 DSH 的信任栅栏，栅栏不可用时按拒绝处理（fail-closed）。

## 没做的 / 做不了的

- **直播推流**：`bili` 没有开播能力，v0.1 不做。真要做需要拿推流地址 + ffmpeg `-f flv`，那是 v0.2 的事，而且要你自己决定露什么。
- **声纹克隆**：不做。见上文。
- **自动审核**：点赞/投币/评论不在这套工具的职责里，仍然由 `bili` 本身的规则约束（见 bili-cli 的 safety 文档）。

## 数据与隐私

所有数据都在 `~/.dsh/bili-studio/`，不上传。凭据只读不写，读的是 `~/.bili-ai/credentials.json`（`bili` 自己维护的那份），插件不复制、不回显。

## License

MIT
