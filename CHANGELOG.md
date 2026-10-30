# Changelog

## 0.2.0 — 2026-10-30

### 新增

- 设置页「工作室」面板（客户端插件）：看草稿队列、点批准 / 打回 / 发布，显示今日配额与已发布 id
- 宿主侧同源接口 `/dsh-studio/api/queue`、`/dsh-studio/api/action`，全部过 DSH 信任栅栏
- 面板与 `studio_*` 工具读同一份磁盘状态，界面上看到的就是草稿箱真实状态

## 0.1.0 — 2026-10-29

首个可用版本。三块能力各自闭环，发布必须人点头。

### 新增

- `studio_status`：登录 / bili / ffmpeg / 配额 / 库存自检
- `studio_learn` + `studio_note`：搜教程、看全一条、落原始数据、写笔记库
- `studio_voice`：从自己号的视频里取干声（highpass + afftdn + loudnorm）、音色列表、参考音频拼接、`tune` 调语速音高
- `studio_style`：从字幕统计语速 / 句长 / 标点 / 口头禅，产出风格卡（不取音频）
- `studio_say`：SAPI 合成 + 音高微调（可接外部引擎）
- `studio_video`：图片 + 配音合成 1920×1080 H.264/AAC
- `studio_queue` + `studio_publish` + `studio_history`：草稿箱、审批、配额、记账

### 已知限制

- 不做声纹克隆；`studio_voice pull` 只接受自己号或显式授权来源
- 不做直播推流
- 投稿 AI 声明强制打开，不提供关闭项

### 修复

- 工具注册失败时不再静默：注册结果写进 `~/.dsh/bili-studio/register.log`
