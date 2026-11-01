# AI 助手：提示词设计与文件读写能力适配方案

> 文档目的：M17 的 AI 面板已经从「只能聊天」走到「能调工具读写文件」，但**提示词是一坨拼接**、**文件能力只覆盖 APK 且根路径算错**。
> 这份文档先把两件事想清楚，再动手改代码。写完不立刻改产品代码，等确认。
>
> ⚠️ **可打勾的执行清单在 `AI助手问题清单（待办）.md`**（含 Java/Kotlin 专属问题 C1–C7）。本文只讲设计思路，进度以清单为准。

---

## 一、现状盘点（照实记录，含已知坑）

### 1.1 提示词现状

| 位置 | 内容 | 问题 |
|---|---|---|
| `lib/xml/ai.ts` → `AI_SYSTEM_PROMPT` | 5 条硬性要求：只输出一个 ```xml 代码块、根节点带 xmlns、不用第三方库、尺寸用 dp、保持 id | 与「可以调工具」直接冲突：模型被要求「只输出 XML」，就不会先 `read_file` 侦察 |
| `lib/xml/ai-tools.ts` → `AI_TOOL_PROMPT` | 手写「用 ```axv-tool 代码块包一行 JSON」+ 4 个工具说明 + 最多 2 个调用 | 协议靠自然语言约束，模型经常写成多行 JSON / 加注释 / 混在中文字里 → `JSON.parse` 失败被静默丢弃 |
| `AiPanel.send()` 拼装 | `system + 历史(最近 8 条) + user(选中路径/资源/整份 XML/问题)` | ① 整份 XML 每轮都塞，200 控件 ~250KB 的布局直接超预算；② 历史里**不含工具结果**，第二轮起模型「读过又忘」；③ 前缀不稳定，prompt caching 完全命中不了 |
| 快捷指令 `AI_QUICK_ACTIONS` | 4 条：解释/改 ConstraintLayout/修 lint/加控件 | 都是「整份重写」导向，模型倾向输出全量 XML 而不是改几行 —— 大文件必然截断/丢控件 |

### 1.2 文件能力现状

`AiPanel` 里只有一条路：

```ts
const io = createNativeIo(projectName || undefined);   // 只有 APK 有；浏览器 = null
```

问题清单（按严重度）：

1. **浏览器完全没有 AI 文件能力**：`createNativeIo` 要求 `window.AxvNative`，网页版直接 null → 工具全部不生效，但 prompt 里还在教模型怎么用（模型试了没反应，开始瞎猜）。
2. **APK 根路径算错**：`rootPath = getDefaultWorkspace() + "/" + projectName`。项目若是通过「打开项目目录」授权的**自定义目录**（`wsState.custom`）或 SAF 目录，这个路径根本不存在 → 所有 list/read 报「读不到」。
3. **写文件没有任何闸门**：`write_file` 直接整文件覆盖。模型幻觉出半份布局 → 原文件废了，且**不进撤销栈**。
4. **路径校验太弱**：`safeRel` 只挡 `..` 和绝对路径。`sub/../../x`、`./a/./b`、Windows 盘符大小写、软链都没处理。
5. **搜索代价不可控**：`search_files` 递归 depth 6、每个文本文件整份 `readText` 再 `includes`。手机上一个 `res/` 就能读几百个文件，同步 JNI 直接卡住 UI。
6. **写入不刷新编辑器**：AI 改了当前打开的布局，画布/代码还是旧的，用户以为没生效，再点保存反而把 AI 的改动覆盖回去。
7. **工具结果没进历史**：`msgs` 里塞了工具结果，但 `setChat` 只存了模型那轮的说明文字；下一句用户追问，模型对上一次读到的内容毫无记忆。

### 1.3 已有的、可以复用的东西（不要重复造）

| 能力 | 现成件 | 说明 |
|---|---|---|
| 双端文件抽象 | `ProjectSource`（`listChildren` / `readText`）、`FileOpsCtx`（`root` = Web DirHandle 或绝对路径，`backend: "web" \| "native"`） | `XmlEditor` 里已经有 `activeProject.source` 和 `fileOpsCtxOf(activeProject)`，**AI 面板只需要接进来** |
| 写文件（web） | `file-ops.ts` 的 `getFileHandle(..., {create}) → createWritable()` | 浏览器是能写的，只是不能 rename/delete |
| 写文件（native） | bridge `writeText(target, base64)`、`createEntry` / `renameEntry` / `deleteEntry` / `copyEntry` | 全都有 |
| 异步（不卡 UI） | `native-async.ts`：`listDirAsyncCached` / `readTextAsync` / `listDirQueued` | AI 读文件必须走异步版 |
| 结构/语法校验 | `lintXml`（M57 已优化到 3.9ms/800 控件）、`attr-catalog.ts` 属性白名单、`widget-docs.ts` 控件说明 | 写回前可以本地校验，不用烧 token |
| 撤销栈 | `setXmlAndTrack(xml, "")` | AI 替换画布已经进栈；文件级写入还没有 |

---

## 二、提示词怎么算「做好」

### 2.1 三条设计原则

1. **一个 system prompt 只放「不变的事实」，变的东西走消息**
   项目结构、控件清单、资源清单这类「本次会话不变」的进 system；当前选区、当前文件内容这类「每轮变」的进 user。这样消息前缀稳定，DeepSeek/通义的 prompt cache 能命中，费用和延迟都降一截。
2. **协议要能机器校验，不能靠礼貌**
   「请不要写多行 JSON」这种话模型听一半。改成：工具块必须单行、必须能过 schema、过不了就**重问一次**（把 parse 错误原文喂回去），第二次还错就降级成「直接回答 + 提示 AI 文件能力不可用」。
3. **改文件 ≠ 整份重写**
   强制：改已有文件用 `apply_patch`（{old, new} 片段替换），只有新建文件才允许 `write_file`。这一条能同时解决大文件截断、token 浪费、丢控件三个问题。

### 2.2 建议的 system prompt 结构（六块，顺序固定）

```
[1 角色与边界]     你是 Android 布局工程师，只改 XML，不碰 Java/Kotlin/Gradle，不新建控件库
[2 项目事实]       项目根 / lib kind（androidx|support|android）/ res 下有哪些目录
[3 可用资源清单]   drawable/color/string/dimen 的**真实名单**（截断到 N 个）
[4 控件白名单]     android.widget.* + androidx.* + material 里允许用的，其余不许自造
[5 工具协议]       工具名、参数、返回格式、什么时候必须调、最多几次
[6 输出契约]       有改动用工具（不输出整份 XML）；无改动给 3–5 行结论；
                   禁止猜文件内容、禁止引用清单外的资源、不确定就问一句
```

细节要点：

- **把「只输出 XML」从硬规则降级**：只有用户在**文本框**里明确要 XML（或者点了「替换画布」那条快捷指令）时，才要求输出代码块。否则一律走 `apply_patch`。
- **把「先读后写」写成硬约束**：`write_file`/`apply_patch` 之前必须有一次 `read_file`（agent 侧也校验：没读过就拒执行，回一句「请先 read_file」）。这条挡掉绝大多数「凭想象重写文件」。
- **给出反例**（比正面例子更管用）：
  - ❌ `android:layout_width="200dp"` 写死宽度 → ✅ `0dp` + 约束 / `match_parent`
  - ❌ 自造 `app:cornerRadius="8dp"` 在非 MaterialCardView 上
  - ❌ 引用 `@drawable/bg_card` 但清单里没有 → 用 `#FFFFFF` 或从清单里挑
- **资源清单必须是真的**：能从 `resExtras`（`drawables/colors/strings/dimens` 的 key）取，取不到就写「资源清单不可用，禁止引用 @ 资源，全部用内联值」。现在 prompt 里完全没这块，模型全靠编。

### 2.3 上下文预算（重要，手机上尤其）

| 内容 | 预算 | 超了怎么办 |
|---|---|---|
| system（角色+事实+清单+协议） | ≤ 2500 token | 资源清单按使用频率截断，控件白名单只放常用 60 个 |
| 当前文件 | ≤ 6000 token（约 20K 字符） | 超出→给「结构摘要」（每个节点 tag+id，缩进表示层级）+ 提示模型用 `read_file` 取局部 |
| 历史 | 最近 6 轮，工具结果只留最后 2 条全文，更早的压成一行 `read a.xml(120行) / write 成功` | 固定裁剪，不做摘要模型（省钱） |
| 单轮回复 | `maxTokens` 默认 2048（思考型模型 4096） | 已有逻辑，保持 |

> 结构摘要这个能力已经有半个了：`java-outline.ts`（代码大纲）和 layers 树的构建逻辑可以直接复用思路 —— 产出一份「每行 `LinearLayout#root`、缩进两级」的纯文本，比整份 XML 省 90% token。

### 2.4 自校验回环（省一次人工返工）

写文件之后、落盘之前，agent 侧跑一遍：
1. `lintXml`（未闭合标签、非法属性名）
2. `attr-catalog` 白名单校验（属性是否属于该控件）
3. 引用校验：`@drawable/xxx`、`@string/xxx` 是否在真实资源清单里（拿不到清单就跳过）

有错 → **不落盘**，把错误列表作为工具结果回给模型，允许它再改 1 次。这次改动通常能把「差一个 `/>`」「属性塞错控件」这类低级错挡在用户面前。

### 2.5 工具协议：自定义块 vs 原生 function calling

| 方案 | 优点 | 缺点 |
|---|---|---|
| A. 现在的 ```axv-tool``` JSON 块 | 任何 OpenAI 兼容服务商都能用；SSE 纯文本解析够用 | 靠 prompt 约束，格式错就见鬼；混在正文里要清洗；多轮时容易变成「一边说一边调」 |
| B. provider 原生 `tools` + `tool_calls` | 结构化，几乎不会格式错；模型知道「调工具时闭嘴」 | 各家流式 `tool_calls` 的 delta 拼装实现差异大；现有 `ai-transport` 是纯文本 SSE，要加解析；`finish_reason: "tool_calls"` 要处理 |

**建议：A 先收紧，B 后接**（分两个里程碑）。
- A 收紧：单行 JSON、`{tool, args}` 两层（参数集中到 `args`，避免顶层字段猜错）、严格 schema 校验、失败重问一次。
- B 接入：给 `streamChat` 加 `tools` 参数与 `tool_calls` delta 累积器，只在 `provider supports tools` 时启用（DeepSeek / 通义 / GLM / Kimi 都支持，OpenAI 当然支持）。开关放在 AI 设置里，默认开。

### 2.6 工具集建议（从 4 个扩到 6 个，别更多）

| 工具 | 参数 | 说明 |
|---|---|---|
| `list_dir` | `path=""`, `depth=1` | depth 上限 2；返回 `[目录]/[文件] 路径 大小` |
| `read_file` | `path`, `offset?`, `limit?` | 按行读，默认前 400 行 / 64KB；返回总行数，方便模型分段读 |
| `grep` | `pattern`, `path="."`, `glob?` | 文件名 + 内容（只在白名单扩展名里搜）；有访次/命中预算 |
| `apply_patch` | `path`, `edits:[{old,new}]` | **主用**；`old` 必须唯一匹配，否则报错让模型重写 |
| `write_file` | `path`, `content` | 只用于新建（`fileExists` 为 false 时才允许；已有文件必须走 patch） |
| `validate` | `path?` | 跑 lint + 属性白名单 + 资源引用校验，返回问题列表 |

刻意**不做**的：`delete`（AI 删文件太危险，让用户自己在树里删）、`rename`、`move`、`run_build`（没有构建环境）、网络请求。

---

## 三、文件能力怎么适配（三种运行环境一套接口）

### 3.1 目标接口

```ts
export interface AiFs {
  backend: "web" | "native";
  rootLabel(): string;                       // 给人看的根路径
  list(rel: string): Promise<AiFsEntry[]>;   // 一层；不递归
  read(rel: string, opts?: { offset?: number; limit?: number }): Promise<{ text: string; total: number }>;
  write(rel: string, text: string): Promise<void>;   // 只在 staging 里生效，落盘由 apply 触发
  exists(rel: string): Promise<boolean>;
  stat(rel: string): Promise<{ size: number; mtime: number } | null>;
  search(q: string, opts: { dir?: string; glob?: string; budget?: number }): Promise<AiFsHit[]>;
}
```

后端选路（按顺序，第一个可用的赢）：

1. `activeProject.source`（`ProjectSource`）+ `fileOpsCtxOf(activeProject)` —— **首选**，web/native 都对，根路径天然正确
2. `createNativeIo(dirPath)` —— 兜底：项目以绝对路径打开但 source 没建起来
3. 都没有 → `AiFs = null`，prompt 里**不出现**工具段（现在是无脑出现，误导模型）

### 3.2 双端能力矩阵

| 操作 | Web（File System Access） | APK（AxvNative bridge） | 不支持时 |
|---|---|---|---|
| 列目录 | `DirHandle.values()` | `listDirAsyncCached(path)` | 报「不可用」，让模型直接回答 |
| 读文件 | `FileHandle.getFile().text()` | `readTextAsync(id, path)` | 同上 |
| 写已有文件 | `createWritable()` ✅ | `writeText` ✅ | — |
| 新建文件 | `getFileHandle({create:true})` ✅ | `createEntry` ✅ | — |
| 删除/改名/移动 | ❌ 浏览器不允许 | ✅ | 提示「请用 APK」 |
| 大目录性能 | 原生 Promise，够快 | 必须走 async（否则卡 UI） | 加深度/条数上限 |

### 3.3 写入安全闸（三层，缺一不可）

```
① 生成：apply_patch / write_file 只写进内存 staging（不落盘）
② 预览：面板出「改动卡片」——文件名、+n/-m 行、可展开的 unified diff，
        按钮：应用 / 放弃 / 应用并打开
③ 落盘：应用时才写；写前把原文件内容存进「AI 写入日志」（内存 20 条 + localStorage 最近 5 条）
        写后：invalidateNativeProjectCache()、刷新当前文档（若是打开中的文件）、进撤销栈
```

配套硬规则：

- 路径解析走**规范化后前缀校验**：`norm = normalize(join(root, rel))`，必须 `norm.startsWith(root + sep)`，且 `rel` 不含 `..`、不以 `/` 或盘符开头。不用 `includes("..")`。
- 扩展名白名单：`.xml .java .kt .kts .gradle .properties .json .md .txt .values`；图片/二进制一律拒（AI 不该写二进制）。
- 大小上限：单文件写入 ≤ 512KB，patch 后总大小 ≤ 1MB。
- 只读保护区（默认）：`.git/**`、`build/**`、`.next/**`、`app/build/**`、`gradle/wrapper/**`。要改必须用户在设置里开「允许 AI 改构建配置」。
- 写前必须读过：`staging` 记录 `readSet`，`write_file` 命中未读文件 → 拒执行。

### 3.4 性能与预算

- `grep`：访次上限 600、命中上限 40、只搜白名单扩展名、内容匹配只读前 4KB。
- `list_dir`：depth ≤ 2，条目 ≤ 300（超出提示「用更具体的子目录」）。
- 所有 native 调用走 `native-async`，并且串行（沿用 `analyzeProjects` 的串行 + `yieldToUi` 套路）。
- 整个工具循环：≤ 4 轮、≤ 8 次工具调用、累计工具输出 ≤ 12K 字符（超出截断并注明）。

---

## 四、落地步骤（每个里程碑独立可验收）

### M64a 提示词重构（不动 IO，先把话说清楚）
1. 把 `AI_SYSTEM_PROMPT` 拆成「角色/契约/禁止项」三段 + 新增 `projectFactsPrompt()`、`resourcePrompt()`、`widgetPrompt()`
2. 拼接顺序固定；当前 XML 从 user 消息挪到**最后**（前缀稳定，可缓存）
3. 工具段改成 `{tool, args}` 结构 + 单行 JSON + 校验失败重问
4. 快捷指令区分 `wantsXml` / `wantsEdit`（改 ConstraintLayout、修 lint、加控件 → 走 patch）
5. 验收：单测覆盖 prompt 拼装（列清单/预算/顺序）；手工：让它「给标题加 4dp 上边距」→ 必须调 `apply_patch` 而不是吐整份 XML

### M64b IO 统一（web 也能读写）
1. 新建 `lib/xml/ai-fs.ts` 实现 `AiFs`，后端按 §3.1 选路
2. `AiPanel` 接 `source` / `fileOps`（XmlEditor 已经有两个现成值，只是没传）
3. 修根路径：不再拼 `defaultWorkspace + name`，直接用 source/fileOps 的根
4. 不支持时：prompt 不出现工具段，面板角落显示「AI 文件能力：不可用」
5. 验收：web + APK 各跑一次 list/read/grep（真机 + Chrome）；自定义目录项目能读到自己

### M64c 写入安全闸
1. staging + diff 卡片 + 应用/放弃
2. 写入日志与撤销、写后刷新当前文档
3. 路径规范化校验、扩展名白名单、保护区、大小上限
4. 验收：让 AI 改 `activity_main.xml`（在编辑器里打开着）→ 卡片显示 diff → 应用后画布立即变、Ctrl+Z 能退；改 `.git` 被拒

### M64d 自校验 + 记忆
1. 写前 lint + 属性白名单 + 资源引用校验，错误回灌一次
2. 工具结果进历史（裁剪策略见 §2.3）
3. 大文件走结构摘要
4. 验收：故意让它写一个漏 `/>` 的布局 → 自动修好再落盘；800 控件文件不再超 token

---

## 五、需要你拍板的几个点

1. **改文件要不要每次都弹 diff 确认？** 我倾向「默认要确认，设置里可关」。手机上多一次点击，但换来不会莫名其妙丢代码。
2. **AI 允不允许写 Java/Kotlin/Gradle？** 我倾向默认只允许 XML（+ values），其余只读。写 gradle 一次就可能把项目搞崩。
3. **要不要接原生 function calling？** 我倾向 M64b 之后做，且保留自定义块做兜底。
4. **工具结果要不要显示在对话气泡里？** 现在显示「⏳ 读取 x.xml…/✅」，信息量低还刷屏。我倾向折叠成一行小灰字，点开看结果。
5. **浏览器版到底要不要给写能力？** FSA 能写但不能删/改名前，安全闸能兜住。给了体验完整，但和 APK 行为不完全一致。
