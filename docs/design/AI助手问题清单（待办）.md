# AI 助手问题清单（待办 / 逐个解决）

> 用法：这是唯一的待办台账。每解决一项，把它标成 ✅ 并写上 commit；不做完一项不往下开。
> 配套方案见 `AI助手提示词与文件能力适配方案.md`（设计思路），本文件是**可打勾的清单**。
> 量级：S ≈ 半天内，M ≈ 1 天，L ≈ 2 天以上。
> 进度：**A1 ✅ M64a**、**B2 ✅ + D3 ✅ M64b**、**B4 ✅ + C5 ✅ M64c**、**B1 ✅ + B6 ✅ M64d**、**B3 ✅ M64e**、**B5 ✅ M64f**、**D4 ✅ M64g**、**A2 ✅ + A4 ✅ M64h**、**A6 ✅ M64i**。

---

## A. 提示词 / 上下文（不分文件类型）

| 编号 | 问题（现状） | 改法 | 验收 | 量级 |
|---|---|---|---|---|
| **A1** ✅ | ~~**当前文件身份错乱（真 bug）**~~ **已修（M64a）**：新增 `lib/xml/ai-doc-context.ts`（resolveAiDocKind / aiDocContextOf / buildAiSystemPrompt / docPreamble / quickActionsFor），AiPanel 接 `docRel`；Java 文件不再收到「只输出布局 XML」的契约，代码块也不再能一键写进画布。 | 让 AiPanel 知道 `openRel` + `editorLang`；上下文块按类型换标题与说明（布局 XML / Java 源码 / values 资源）；system prompt 里「输出契约」按类型切换 | 打开 MainActivity.java 问「这个方法干什么」→ 回复不出现布局 XML；打开 layout 问同样问题仍是布局逻辑 | S |
| **A2** ✅ | ~~system 自相矛盾~~ **已修（M64h）**：`buildAiSystemPrompt(ctx, {intent, canWrite})` 改成四段式（角色 → 决策规则 → 输出契约 → 禁止项）；「只输出 XML」降级为**只在 `intent="xml"`（用户点 wantsXml 快捷指令 / 明说要整份）时**；默认 auto 教它「先判断你要什么」，改文件一律 apply_patch；只读项目明确写「没有写权限、只能给片段」。 | 拆成「角色/契约/禁止项」三段；「只输出 XML」降级为**仅当用户明确要 XML 时**；改文件一律走 patch | 让它「给标题加 4dp 上边距」→ 走 apply_patch，不吐整份 XML | S |
| **A3** | 每轮都把整份文档塞进 user 消息，且前缀不稳定 → prompt cache 一次不命中，费用/首字延迟双高 | 当前文档挪到消息**最后**；system 只放不变事实；大文件（>20K 字符）换成结构摘要 | 同一会话第二轮起 usage 里 cached tokens > 0（DeepSeek 有返回）；800 控件文件不超预算 | M |
| **A4** ✅ | ~~工具协议靠自然语言约束~~ **已修（M64h）**：协议改 `{"tool":名称,"args":{...}}` 单行（旧扁平写法仍兼容）；新增 `parseToolReply` 返回 `{calls, errors, blocks}`，逐条校验（JSON 语法 / 未知工具 / 缺 path·query·content·edits / edits>20）；AiPanel 首次失败**把错误原文喂回去重问一次**，二次失败降级成普通回答并在气泡里注明「本轮未改动文件」。 | 改成 `{tool, args}` 单行 JSON；严格 schema 校验；解析失败**重问一次**并把错误原文喂回去；二次失败降级为「直接回答 + 提示能力不可用」 | 构造 5 种坏格式，4 种能被重问救回，1 种走降级不崩 | S |
| **A5** | 快捷指令全是「整份重写」导向（改 ConstraintLayout / 修 lint / 加控件）→ 模型必吐全量 XML → 大文件截断丢控件 | 把动作分两类：`wantsXml`（替换画布）与 `wantsEdit`（走 patch，例如「修 lint」「加控件」） | 300 控件文件点「修 lint」→ 只产生 patch，不重写全文 | S |
| **A6** ✅ | ~~没送项目事实~~ **已修（M64i）**：`lib/xml/ai-facts.ts` 发请求前扫 res（预算 40 次 IO / 60 名字 / 6 个 values 文件，单次 800ms 超时），把真实 `@drawable`/`@color`/`@string`/`@dimen` 名单、库类型（androidx vs support）、可用控件白名单塞进 system prompt；拿不到清单时**明确禁止引用 @ 资源**。面板显示「事实 N」角标，同一项目只扫一次。 | 注入项目真实资源清单 + 库类型 + 控件白名单 | 让它加圆角背景 → 只会用 `bg_card` 这类真实存在的名字，不会瞎编 | M |
| **A7** | 工具结果不进对话历史：`setChat` 只存模型那轮说明，下一句追问时「读过什么全忘」 | 工具结果按裁剪策略入历史（最近 2 条全文，更早压成一行 `read a.xml(120行)`） | 连续两轮追问同一文件内容，第二轮不需要再 read | S |

---

## B. 文件读写能力（XML + Java 都受影响）

| 编号 | 问题（现状） | 改法 | 验收 | 量级 |
|---|---|---|---|---|
| **B1** ✅ | ~~**浏览器版完全没有 AI 文件能力**~~ **已修（M64d）**：`lib/xml/ai-fs.ts` 已有 web/native 两套实现，本轮补上 web 写：有项目根 `DirHandle` 时 `getDirectoryHandle(create)` + `getFileHandle(create)` + `createWritable`；AiPanel 头部新增能力角标（读写 / 只读）；`canWrite=false` 时 prompt 明说“只能读”（不再教模型写）。 | 新建 `AiFs` 抽象（web FSA / native bridge 两实现），后端按 `source` → `nativeIo` → 不可用 选路；不可用时 prompt **不出现**工具段 | Chrome 里能 list/read/grep 真项目；面板角标显示当前能力 | L |
| **B2** ✅ | ~~**APK 根路径拼错**~~ **已修（M64b）**：新增 `lib/xml/ai-fs.ts`（`ioFromProjectSource` / `ioFromRootPath` / `ioForProject`），AiPanel 改接 `fileIo`，XmlEditor 传 `ioForProject(activeProject)`；再也不用「默认工作目录 + 项目名」拼路径。 | 不拼名字：直接用 `ProjectSource` / `FileOpsCtx` 的根（`XmlEditor` 里已有 `activeProject.source` 和 `fileOpsCtxOf(activeProject)`） | 自定义目录项目里 AI 能读到自己的 layout | S |
| **B3** ✅ | ~~**写文件没有闸门**~~ **已修（M64e）**：整文件覆盖、不备份、不进撤销栈、写后不刷新编辑器（画布还是旧的，用户再保存把 AI 改动覆盖回去） | staging → diff 卡片（应用/放弃）→ 落盘前备份 → 写后 `invalidateNativeProjectCache()` + 刷新当前文档 + 进撤销栈（lib/xml/ai-staging.ts + lib/xml/ai-diff.ts；runTool 写只进 overlay，卡片显示 -/+ 行数，应用时先写 .axv_backup/<rel>.<时间>） | 改打开中的 layout：卡片出 diff → 应用后画布立刻变、Ctrl+Z 可退 | L |
| **B4** ✅ | ~~路径校验太弱~~ **已修（M64c）**：新增 `lib/xml/ai-paths.ts` —— `normalizeAiRel`（去 ./ 、折叠 // 、收敷 a/../b）、`checkAiPath`（越界/保护区/扩展名闸门）、`isUnder`（拼完绝对路径再验前缀）；runTool 与 ai-fs 全部改走它。 | 规范化后前缀校验：`normalize(join(root, rel)).startsWith(root + sep)`；再叠扩展名白名单、保护区、大小上限 | 构造 10 条越界路径，全部被拒且报人话错误 | S |
| **B5** ✅ | ~~`search_files` 无预算~~ **已修（M64f）**：新增 `lib/xml/ai-search.ts` —— 访次 600 / 命中 40 / 深度 6 / 内容只匹配前 4KB；跳过 `build/.gradle/.git/.idea/node_modules/.next/.cxx`；每 25 次访问 `setTimeout(0)` 让出主线程；`createNativeIo` 的 list/read 也改走 `native-async` 串行队列。 | 访次 600 / 命中 40 / 只搜白名单扩展名 / 内容匹配只读前 4KB；全部走 `native-async` 并串行 | 搜一个 3000 文件的项目 < 2s，UI 不卡 | M |
| **B6** ✅ | ~~只能整份覆盖~~ **已修（M64d）**：`apply_patch({path, edits:[{old,new}]})` —— `old` 必须唯一命中（不唯一/找不到都报错不猜），最多 20 处，改完写回并报【n 处】；`write_file` 只允许新建，文件已存在直接拒绝并指向 apply_patch；prompt 同步改。 | 新增 `apply_patch({path, edits:[{old,new}]})`，`old` 必须唯一匹配，否则报错让模型重写；`write_file` 仅限新建 | 1000 行文件改 3 处，diff 干净，token 不爆 | M |

---

## C. Java / Kotlin 专属（本次重点补的范围）

| 编号 | 问题（现状） | 改法 | 验收 | 量级 |
|---|---|---|---|---|
| **C1** | **没有 Java 语义上下文**：不知道 package、已有 import、类名与现有方法签名 → 生成的代码必然编译不过（拼错 R.id、缺 import、重名方法） | 新增上下文块：`package`（从路径推）、类声明、已有 import 列表、方法签名清单（复用 `java-outline.ts`）；提示词要求「新增 import 必须用现有风格」 | 让它「给这个 Activity 加一个保存方法」→ 产出能对上 package/import/R.id 的片段 | M |
| **C2** | **没有编译验证**：布局有 `lintXml` + 属性白名单 + 资源引用校验，Java 一行校验都没有 | 轻量静态检查：括号/引号平衡、`R.id.xxx` 是否在对应 layout 里存在、`import` 是否缺（用到类名但无 import 时警告）、`@Override` 位置；并在回复里**明确写「未编译验证」** | 故意给它一个括号不配的片段 → 能被拦下并在回复里注明未验证 | M |
| **C3** | **跨文件联动缺失**：改 layout 的 id 不会提示同步 `findViewById(R.id.x)`；改 strings 不提示引用点 | 新增 `find_usages`（grep `R.id.x` / `R.string.x` / `@string/x`），patch 命中被引用资源时，在卡片上提示「还有 3 处引用」 | 改一个被引用的 id → 卡片能列出引用文件与行号 | M |
| **C4** | Java 文件普遍 500–2000 行，整份读/写都不可行；也没有「按方法定位」的能力 | `read_file` 支持 `offset/limit`；新增 `outline`（类/方法/行号，复用 M61 解析器）→ 让模型先看大纲再读局部 | 读 1500 行文件时只取 80 行目标方法 | M |
| **C5** ✅ | ~~保护区策略缺失~~ **已修（M64c）**：`isProtectedRel` 拦 `.git/.gradle/.idea/.next/node_modules/build` 目录与 `build.gradle*/settings.gradle*/gradle.properties/AndroidManifest.xml/proguard/local.properties` 等；默认只读，AiPanel 设置里一个「允许改构建/清单文件」开关才放开（localStorage `axv.ai.allowProtected`）。 | 默认只读：`.git/**`、`build/**`、`.next/**`、`gradle/**`、`AndroidManifest.xml`、`build.gradle*`、`settings.gradle*`、`gradle.properties`；设置里一个总开关才放开 | 让它改 build.gradle → 被拒并说明原因 | S |
| **C6** | Kotlin 差异没处理（属性访问、`?`/`!!`、lambda、`by lazy`），prompt 只有 Android XML 规则 | 按扩展名切换「语言规则块」（java / kotlin 两套，各 ≤10 行） | .kt 文件里让它加点击事件 → 产出 Kotlin 惯用写法（setOnClickListener / lambda） | S |
| **C7** | 写入绕过既有保存链路：xml 有四条保存路径收口到 `save-flow.ts`，AI 自己拼绝对路径写，编码/BOM/换行/备份策略都跟手动保存不一致 | AI 落盘统一走 `save-flow`（或它与 file-ops 的公共底层），不要另起一套写文件代码 | AI 写出的文件与手动保存的字节级一致（换行、编码） | M |

---

## D. 传输 / 体验

| 编号 | 问题（现状） | 改法 | 验收 | 量级 |
|---|---|---|---|---|
| **D1** | 没有原生 function calling，全靠自定义块 | `streamChat` 加 `tools` 参数 + `tool_calls` delta 累积器；provider 支持时启用，保留自定义块兜底 | DeepSeek/通义/GLM/Kimi 四个 provider 各跑一次工具调用 | L |
| **D2** | 「⏳ 读取 x.xml… / ✅」刷屏，信息量低 | 折叠成一行小灰字，点开看结果；错误状态单独标红 | 一轮 3 次工具调用，气泡只占 3 行 | S |
| **D3** ✅ | ~~中断只断流，不断工具循环~~ **已修（M64b）**：每轮开头、每个工具前、每个工具后都检查 `signal.aborted`；停止后气泡标「⏹ 已停止」，静默收尾不报超时。 | 工具循环每步检查 `signal.aborted`，立刻退出并清理 staging | 点停止后 200ms 内不再有任何 bridge 调用 | S |
| **D4** ✅ | ~~没有「AI 改动历史」~~ **已修（M64g）**：新增 `lib/xml/ai-history.ts` —— 每批「应用」成功后记一条（时间 + 文件 + **改动前内容**，内存最多 20 批）；面板「AI 改动历史」列出批次，一键把整批写回 before（AI 新建的文件清空内容并标注）；回滚成功后从列表移除。Ctrl+Z 之外多一条「这次 AI 干了啥」的路。 | 内存保留最近 20 次 AI 写入（文件+旧内容），面板里「回滚到本次之前」 | 一次改 3 个文件，一键全部回滚 | M |

---

## 建议顺序（依赖决定了先后）

1. **A1 + B2 + D3**（都是小改动，先止血：身份错乱、根路径错、停止不生效）
2. **B4 + C5**（安全底线：路径校验、保护区）
3. **B1 + B6**（能力可用：web 能读写、patch 代替整份覆盖）
4. **B3 + D4**（敢用：diff 确认、备份、撤销）
5. **A2/A3/A4/A5/A6/A7**（提示词重构，一次性做完，配 A6 的清单注入）
6. **C1 + C4 + C2**（Java 能干活：语义上下文、按方法读、静态校验）
7. **C3 + C6 + C7**（联动与一致性）
8. **D1 + D2**（体验升级）

> 第 5 步之前必须先把 3、4 做完，否则提示词写得再好，模型也只能「整份覆盖」一个 1000 行文件。
