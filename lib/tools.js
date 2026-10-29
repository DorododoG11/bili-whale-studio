/**
 * 模型面向的工具定义。
 *
 * 每个工具只做一件可被验证的事，返回值都收得很紧（列表只给摘要，正文用 id 再取）——
 * 上下文是给下一步用的，不是给日志用的。
 */
import { say, listVoices, pullVoice, removeVoice, buildVoiceRef, listSapiVoices, tuneVoice, whoami } from './voice.js'
import { searchTutorials, fetchVideo, saveNote, listNotes, readNote } from './learn.js'
import { analyzeStyle, saveStyle, listStyles } from './style.js'
import { composeVideo } from './compose.js'
import { createDraft, getDraft, listDrafts, approveDraft, rejectDraft, summarize, quotaState } from './drafts.js'
import { publishDraft, previewDraft, publishHistory } from './publish.js'
import { loadConfig, configPath, STUDIO_DIR, ensureDirs } from './paths.js'
import { StudioError } from './bili.js'

const text = (s) => [{ type: 'text', text: s }]

const show = (e) => (e instanceof StudioError ? `${e.message}${e.hint ? `（${e.hint}）` : ''}` : String(e?.message || e))
const wrap = (fn) => async (args, exec) => {
  try {
    return await fn(args, exec)
  } catch (error) {
    throw new Error(show(error))
  }
}

const str = (description, extra = {}) => ({ type: 'string', description, ...extra })
const num = (description, extra = {}) => ({ type: 'number', description, ...extra })
const bool = (description, extra = {}) => ({ type: 'boolean', description, ...extra })
const arr = (description, items, extra = {}) => ({ type: 'array', description, items, ...extra })

function makeTool({ name, description, parameters = {}, output = { type: 'object' }, run, render }) {
  return {
    name,
    description,
    parameters,
    output: { schema: output, render: render || ((_a, v) => text(JSON.stringify(v).slice(0, 4000))) },
    execute: wrap(run),
  }
}

export function defineStudioTools() {
  const tools = []

  tools.push(
    makeTool({
      name: 'studio_status',
      description: '工作室自检：B 站登录、bili / ffmpeg 可用性、今天还能发几条、本地攒了多少东西。开始干任何活之前先跑它。',
      run: async () => {
        ensureDirs()
        const cfg = loadConfig()
        let auth = { loggedIn: false, user: null }
        let biliError = ''
        try {
          auth = await whoami()
        } catch (error) {
          biliError = show(error)
        }
        return {
          studioDir: STUDIO_DIR,
          configFile: configPath(),
          bili: { ok: !biliError, error: biliError, loggedIn: auth.loggedIn, user: auth.user?.name || '', selfMid: auth.selfMid || '' },
          ffmpeg: cfg.ffmpegPath || 'PATH',
          quota: quotaState(),
          counts: {
            notes: listNotes('', 200).length,
            voices: listVoices().length,
            styles: listStyles().length,
            drafts: listDrafts().length,
          },
          tts: { engine: cfg.voice.engine, sapiVoice: cfg.voice.sapiVoice },
        }
      },
      render: (_a, v) =>
        text(
          [
            `工作室：${v.studioDir}`,
            `B 站：${v.bili.ok ? (v.bili.loggedIn ? `已登录 ${v.bili.user}（${v.bili.selfMid}）` : '未登录，先 bili auth login') : v.bili.error}`,
            `今天还能发：${v.quota.remaining}/${v.quota.limit} 条`,
            `已有：笔记 ${v.counts.notes} · 音色 ${v.counts.voices} · 风格卡 ${v.counts.styles} · 草稿 ${v.counts.drafts}`,
          ].join('\n'),
        ),
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_learn',
      description:
        '在 B 站学东西。action=search 按关键词找教程；action=fetch 把一条视频看全并落原始数据，返回 AI 总结、章节和字幕开头——看完用 studio_note 存成笔记。',
      parameters: {
        action: str('search 找视频；fetch 看一条视频并落盘', { required: true, enum: ['search', 'fetch'] }),
        query: str('search 的关键词，比如 "DeepSeek Harness 插件"'),
        bvid: str('fetch 的 BV 号'),
        size: num('search 返回几条，1–20，默认 5'),
        maxChars: num('fetch 返回的字幕字符上限，默认 6000'),
      },
      run: async (args) => {
        if (args.action === 'search') {
          if (!args.query) throw new StudioError('no_query', '搜索得有关键词。', '')
          const items = await searchTutorials(args.query, args.size)
          return { action: 'search', query: args.query, count: items.length, items }
        }
        if (!args.bvid) throw new StudioError('no_bvid', 'fetch 需要 BV 号。', '')
        const video = await fetchVideo(args.bvid, { maxChars: args.maxChars })
        return { action: 'fetch', ...video }
      },
      render: (_a, v) => {
        if (v.action === 'search') {
          if (!v.count) return text(`没搜到「${v.query}」的结果，换个词。`)
          return text(
            [`搜「${v.query}」找到 ${v.count} 条：`].concat(
              v.items.map((it) => `- ${it.bvid} · ${it.title} · ${it.author} · ${it.play} 播放`),
            ).join('\n'),
          )
        }
        return text(
          [
            `已看全 ${v.bvid}《${v.title}》${v.owner ? ` / ${v.owner}` : ''}`,
            `字幕 ${v.transcriptChars} 字，原始数据在 ${v.rawFile}`,
            v.summary ? `\nAI 总结：\n${String(v.summary).slice(0, 1200)}` : '',
            v.chapters?.length ? `\n章节：\n${v.chapters.map((c) => `- ${c.title || c.name || c}`).join('\n')}` : '',
            v.transcriptHead ? `\n字幕开头：\n${v.transcriptHead}` : '',
          ].filter(Boolean).join('\n'),
        )
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_note',
      description: '笔记库。action=save 把学到的东西写成笔记；action=list 找笔记（可按关键词）；action=read 读全文。写稿前先 list 一下，别重复造轮子。',
      parameters: {
        action: str('save / list / read', { required: true, enum: ['save', 'list', 'read'] }),
        title: str('save 的标题，写清"学到了什么"'),
        body: str('save 的正文（结论、步骤、坑）'),
        tags: arr('save 的标签', { type: 'string' }),
        bvids: arr('来源 BV 号', { type: 'string' }),
        query: str('list 的关键词'),
        id: str('read 的笔记 id'),
      },
      run: async (args) => {
        if (args.action === 'save') {
          const note = saveNote({ title: args.title, body: args.body, tags: args.tags, bvids: args.bvids })
          return { action: 'save', id: note.id, title: note.title, file: note.file }
        }
        if (args.action === 'list') return { action: 'list', notes: listNotes(args.query || '', 30) }
        if (!args.id) throw new StudioError('no_id', 'read 需要笔记 id。', '')
        return { action: 'read', ...readNote(args.id) }
      },
      render: (_a, v) => {
        if (v.action === 'save') return text(`笔记已存：${v.id}《${v.title}》`)
        if (v.action === 'list') {
          if (!v.notes.length) return text('笔记库还是空的，先去 studio_learn 学点东西。')
          return text(['笔记：'].concat(v.notes.map((n) => `- ${n.id} · ${n.title} ${n.tags.length ? `[${n.tags.join('/')}]` : ''}`)).join('\n'))
        }
        return text(`# ${v.title}\n\n${v.body}`)
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_voice',
      description:
        '音色库与调音。action=pull 从自己的视频里拉一段音频切成干声；action=list 看素材；action=remove 删；action=ref 把素材拼成参考音频；action=voices 列系统可用音色；action=tune 把语速/音高写进配置（调的是参数，不是别人的声纹）。只接受自己号或明确授权的来源。',
      parameters: {
        action: str('pull / list / remove / ref / voices / tune', { required: true, enum: ['pull', 'list', 'remove', 'ref', 'voices', 'tune'] }),
        bvid: str('pull 的来源 BV（必须是自己号的视频）'),
        label: str('pull 的素材名，比如 "班会-生气"'),
        start: num('pull 从第几秒开始，默认 0'),
        end: num('pull 到第几秒结束；不填取 6–20 秒'),
        authorized: bool('仅当来源是口头授权时传 true，会记进 meta'),
        slug: str('remove 的素材 slug'),
        slugs: arr('ref 用哪些素材，不填用全部', { type: 'string' }),
        rate: num('tune 的语速 -10~10，0 正常'),
        pitch: num('tune 的音高倍数 0.8~1.25，1 原声，1.06 左右明显更年轻'),
      },
      run: async (args) => {
        if (args.action === 'pull') {
          const meta = await pullVoice({ bv: args.bvid, label: args.label, start: args.start, end: args.end, authorized: args.authorized })
          return { action: 'pull', ...meta }
        }
        if (args.action === 'remove') return { action: 'remove', ...removeVoice(args.slug) }
        if (args.action === 'ref') return { action: 'ref', ...(await buildVoiceRef(args.slugs)) }
        if (args.action === 'voices') return { action: 'voices', voices: await listSapiVoices() }
        if (args.action === 'tune') return { action: 'tune', ...tuneVoice({ rate: args.rate, pitch: args.pitch }) }
        return {
          action: 'list',
          voices: listVoices().map((v) => ({
            slug: v.slug,
            label: v.label,
            from: v.source?.bvid,
            owner: v.source?.owner?.name || '',
            duration: v.duration,
            authorization: v.source?.authorization,
          })),
        }
      },
      render: (_a, v) => {
        if (v.action === 'pull') return text(`拉好了：${v.slug}（${v.duration}s，来源 ${v.source.bvid}）→ ${v.files.wav}`)
        if (v.action === 'remove') return text(`已删 ${v.removed}`)
        if (v.action === 'ref') return text(`参考音频：${v.file}（拼了 ${v.parts} 段）`)
        if (v.action === 'voices') return text(v.voices.map((x) => `- ${x.name} · ${x.culture} · ${x.gender}`).join('\n'))
        if (v.action === 'tune') return text(`已调音：语速 ${v.rate}、音高 ×${v.pitch}（${v.sapiVoice}）`)
        if (!v.voices.length) return text('还没有音色素材。')
        return text(v.voices.map((x) => `- ${x.slug} · ${x.label} · ${x.duration}s · ${x.authorization}`).join('\n'))
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_style',
      description:
        '声音风格卡：从一条视频的字幕里统计语速、句长、标点习惯、高频口头禅，产出风格素材（不取音频）。action=analyze 分析；action=save 存卡；action=list 看现有卡。',
      parameters: {
        action: str('analyze / save / list', { required: true, enum: ['analyze', 'save', 'list'] }),
        bvid: str('analyze 的 BV 号'),
        name: str('save 的卡名'),
        card: str('save 的正文：怎么说话、用什么词、什么脾气'),
        basedOn: arr('save 的参考来源 BV', { type: 'string' }),
        tags: arr('save 的标签', { type: 'string' }),
      },
      run: async (args) => {
        if (args.action === 'analyze') return { action: 'analyze', ...(await analyzeStyle(args.bvid)) }
        if (args.action === 'save') return { action: 'save', ...saveStyle({ name: args.name, card: args.card, basedOn: args.basedOn, tags: args.tags }) }
        return { action: 'list', styles: listStyles() }
      },
      render: (_a, v) => {
        if (v.action === 'save') return text(`设定卡已存：${v.slug}`)
        if (v.action === 'list') return text(v.styles.length ? v.styles.map((s) => `- ${s.slug} · ${s.name}`).join('\n') : '还没有设定卡。')
        const s = v.style
        return text(
          [
            `《${v.title}》/${v.owner}  ${v.duration}s`,
            `语速 ${s.charsPerSecond} 字/秒 · 句长 均 ${s.sentence.avg}（${s.sentence.shortest}–${s.sentence.longest}）`,
            `标点：叹号 ${s.punctuation.exclaim} · 问号 ${s.punctuation.question} · 省略号 ${s.punctuation.ellipsis} · 表情 ${s.punctuation.emoji}`,
            s.catchphrases.length ? `口头禅：${s.catchphrases.map((c) => `${c.phrase}×${c.count}`).join('、')}` : '',
            v.samples?.length ? `\n语气样例（别人的原句，只看语气别照抄）：\n${v.samples.map((x) => `· ${x}`).join('\n')}` : '',
          ].filter(Boolean).join('\n'),
        )
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_say',
      description: '把文字念成语音（wav）。默认用系统中文音色；config.voice.engine=command 时改走外部克隆引擎。产出可直接给 studio_video 配音。',
      parameters: {
        text: str('要念的内容', { required: true }),
        voice: str('系统音色名，不填用配置里的'),
        rate: num('语速 -10~10，0 是正常'),
        pitch: num('音高倍数 0.8~1.25，不填用配置里的'),
        out: str('输出路径，不填落在 out/ 下'),
      },
      run: async (args) => ({ ...(await say(args)) }),
      render: (_a, v) => text(`语音好了：${v.file}（${Math.round(v.bytes / 1024)} KB，${v.engine}，语速 ${v.rate}，音高 ×${v.pitch}）`),
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_video',
      description: '把图片 + 配音合成为 1920x1080 的 mp4（图片按时长均分，没有图就用深色底）。产出的文件直接喂给投稿草稿。',
      parameters: {
        audio: str('配音 wav 路径', { required: true }),
        images: arr('封面/画面图片路径，会按顺序均分时长', { type: 'string' }),
        out: str('输出路径，不填落在 out/ 下'),
      },
      run: async (args) => ({ ...(await composeVideo(args)) }),
      render: (_a, v) => text(`视频好了：${v.file}（${v.duration}s，${v.slides} 张图，${Math.round(v.bytes / 1024 / 1024)} MB）`),
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_queue',
      description:
        '草稿箱。action=new 建草稿；list 看队列；show 看一条全文；preview 看发出去会执行什么；approve 是"人点头"这一步，只有人能拍板；reject 打回。',
      parameters: {
        action: str('new / list / show / preview / approve / reject', { required: true, enum: ['new', 'list', 'show', 'preview', 'approve', 'reject'] }),
        kind: str('new 的类型', { enum: ['dynamic', 'video'] }),
        text: str('new 的正文'),
        title: str('video 的标题'),
        tags: arr('video 的标签（1–12 个）', { type: 'string' }),
        images: arr('dynamic 的配图', { type: 'string' }),
        video: str('video 的视频文件'),
        cover: str('video 的封面'),
        audio: str('音频文件（可选）'),
        basedOn: arr('内容依据：笔记 id 或 BV', { type: 'string' }),
        id: str('show / preview / approve / reject 的草稿 id'),
        status: str('list 只看某个状态', { enum: ['draft', 'approved', 'published', 'rejected', 'failed'] }),
        reason: str('reject 的理由'),
      },
      run: async (args) => {
        if (args.action === 'new') return { action: 'new', draft: createDraft(args) }
        if (args.action === 'list') return { action: 'list', drafts: listDrafts(args.status).map(summarize) }
        if (!args.id) throw new StudioError('no_id', '这一步需要草稿 id。', '先 studio_queue action=list。')
        if (args.action === 'show') return { action: 'show', draft: getDraft(args.id) }
        if (args.action === 'preview') return { action: 'preview', ...previewDraft(args.id) }
        if (args.action === 'approve') return { action: 'approve', draft: summarize(approveDraft(args.id)) }
        return { action: 'reject', draft: summarize(rejectDraft(args.id, args.reason)) }
      },
      render: (_a, v) => {
        if (v.action === 'new') return text(`草稿 ${v.draft.id} 已进箱（${v.draft.kind}，状态 draft）。`)
        if (v.action === 'list') {
          if (!v.drafts.length) return text('草稿箱是空的。')
          return text(v.drafts.map((d) => `- ${d.id} · ${d.kind} · ${d.status} · ${d.title}`).join('\n'))
        }
        if (v.action === 'show') {
          const d = v.draft
          return text([`${d.id}（${d.kind}/${d.status}）`, d.title ? `标题：${d.title}` : '', d.text].filter(Boolean).join('\n'))
        }
        if (v.action === 'preview') {
          return text([`将要执行：${v.wouldRun.join(' ')}`, `配额：${v.quota.remaining}/${v.quota.limit}`, v.ready ? '状态：可以发' : '状态：还没点头'].join('\n'))
        }
        if (v.action === 'approve') return text(`已点头：${v.draft.id}。现在可以 studio_publish 了。`)
        return text(`已打回：${v.draft.id}`)
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_publish',
      description: '把已批准的草稿真正发出去（动态或投稿）。没 approved 会被拒；每天有配额；投稿自带 AI 声明。发完写日志。',
      parameters: {
        id: str('草稿 id', { required: true }),
        dryRun: bool('只做预演，不真发'),
      },
      run: async (args) => ({ ...(await publishDraft(args.id, { dryRun: args.dryRun })) }),
      render: (_a, v) => {
        if (v.dryRun) return text(`预演：会执行 ${v.wouldRun.join(' ')}`)
        return text(`发出去了：${v.id}（${v.kind}）${v.result?.bvid ? ` BV ${v.result.bvid}` : ''}`)
      },
    }),
  )

  tools.push(
    makeTool({
      name: 'studio_history',
      description: '发布记录：今天发了几条、最近发出去的是什么、有没有失败。用来回答"到底发没发"和算配额。',
      parameters: { limit: num('返回几条，默认 20') },
      run: async (args) => ({ quota: quotaState(), records: publishHistory(args.limit) }),
      render: (_a, v) =>
        text(
          [`记账：今天 ${v.quota.used}/${v.quota.limit} 条`]
            .concat(v.records.map((r) => `- ${r.at} ${r.ok ? '成功' : '失败'} ${r.kind} ${r.id}`))
            .join('\n'),
        ),
    }),
  )

  return tools
}
