# 项目完整度评估（2026-11-07 全面刷新）

> 上一次评估是 2026-10-27（22 个 lib/xml / 1183 测试），之后又做了 20 多个里程碑，这份是当前真实状态。

## 一、体量

| 项目 | 数值 |
|---|---|
| 源码文件 | 204 个（不含测试） |
| 源码行数 | ~59,700 行 |
| 测试文件 | 270 个 |
| 测试用例 | 2,396 通过 / 1 skip |
| lib/xml 纯逻辑模块 | 131 个 |
| components 组件/样式 | 58 个 |
| 控件目录 | 95 个（Android 61 / AndroidX 14 / Material 20） |
| 设备预设 | 16 个（手机/横屏/平板/折叠/电视/手表） |
| APK | 12.06 MB（versionCode 225 / 1.16.7） |
| i18n | EN 字典 2,093 条，5 种语言（zh-Hans / zh-Hant / en / ja…） |

## 二、已经完整的能力（可直接用）

### 1. 布局编辑与预览
- 12 种布局容器（Linear/Frame/Relative/Constraint/Grid/Table/Scroll/Nested/Horizontal/Coordinator/Drawer/Flow/MotionLayout）
- ConstraintLayout：四向约束、0dp、bias、margin、chain、Guideline、Barrier、拖手柄连线、自动推断约束
- 控件目录 95 个，插入到父/兄弟、跨父级拖拽排序、图层树
- 属性面板：尺寸/颜色/枚举/文本/权重/可见性/内外边距/重力，`?attr/` 主题属性展开
- 画布：设备外壳、状态栏、缩放、选中高亮、几何手柄
- 代码 ↔ 画布双向：改属性回写文本、改文本重渲染（保留注释与缩进）
- 实时 lint：标签未闭合、CL 子项未约束、缺 id 等
- 撤销/重做（合并窗口）、历史快照、自动保存 localStorage
- 多设备并排对比（9 台设备各自独立求解）

### 2. 资源体系（这块最近补齐最多）
- 扫描真实项目 `res/`：layout / drawable / drawable-xml / values / styles / mipmap
- 资源值编辑器：strings/colors/dimens 读写真实文件（写盘 + 找不到就提示）
- drawable 编辑器：shape / selector / layer-list / ripple / inset / clip，14 个预设（含 seekbar-track、input-field、checkbox 等控件样式），真预览
- 图标编辑器：矢量图标画布（GenAssets 面板）、56 个内置图标库、SVG 粘贴、文字转路径
- 应用图标生成：adaptive-icon 四件套（前景 vector + 背景 shape + mipmap-anydpi-v26 ×2）、三种遮罩预览、参数持久化 + 从项目反读
- Manifest 编辑器：application/activity 属性、图标规范检查 + 一键修复
- 资源引用检查 + **一键修复**（M179：@drawable/@string/@color/@dimen/@layout/@id/@style 拼错，唯一最近名直接替换，可撤销）
- Java 侧 `R.id/R.string/...` 与 `findViewById` 类型校验 + 方法名拼错（setTxt→setText）+ 一键修复

### 3. 项目与文件
- 新建 Android 项目骨架（可填包名，自动生成目录/namespace/applicationId/主题/manifest）
- 项目改名（目录 + app_name + Theme 定义与引用 + settings.gradle 同步）
- 打开/浏览工作区、多项目列表、最近项目
- 多文件编辑（布局 + Java/Kotlin + values + drawable），文件树
- 保存：浏览器 File System Access / APK 原生目录写入，另存到文件夹

### 4. 真机渲染（差异化亮点）
- 手机端 aapt2 现场编资源 → 生成 `hasCode=false` 的资源 APK → PreviewActivity 用 AssetManager 挂载 inflate，**全程不安装**
- 自动补占位资源、同名去重、adaptive-icon 归位、include 命名空间修正、图片格式嗅探
- framework 桩（164KB）解决手机 aapt2 读不到 framework-res 的问题

### 5. 运行调试（仿真）
- 点击/长按/涟漪、输入框可输入、勾选/开关/单点切换、SeekBar 拖动、Spinner 弹窗、列表注入演示数据
- 事件日志、震动反馈；纯前端仿真，不执行 Java

### 6. AI 助手
- 5 家 OpenAI 兼容服务商预设，key 只存 localStorage
- 8 个工具（list/read/outline/find_usages/check_java/write/apply_patch/search），支持原生 function calling 与 `axv-tool` 文本协议双通道
- 暂存模式（改动先暂存、用户点应用才落盘）、差异预览、调用日志

### 7. 导出
- 布局 XML 下载/复制、导出 res.zip、导出预览图（PNG/SVG）、真机渲染
- 打包成本身就是一个 APK（离线可用）

## 三、半成品 / 有明显缺口的

| 项 | 现状 | 缺口 |
|---|---|---|
| **Java 代码执行** | 只有静态检查（10 类规则：括号/引号/R.id 存在性/import/@Override 位置/方法名拼错/类型不符） | **不能运行**。真跑要 ECJ(3MB)+d8(4.6~15.8MB)+android.jar 桩，minSdk 24 与 `java.nio.file` 冲突；浏览器版无 JVM 完全不可行 |
| **Kotlin** | 按 Java 语法高亮 + 部分 lint（方法名检查刻意跳过，扩展函数误报多） | 无 Kotlin 专属解析/补全 |
| **预览保真度** | CSS 近似渲染 | WebView/VideoView/SurfaceView/TextureView 只画占位；RecyclerView/GridView 是条纹占位；字体度量与真机有偏差 |
| **Gradle** | 只读 build.gradle/settings.gradle，项目改名会同步 | 不能编辑依赖、不能构建 APK |
| **i18n** | `tt()` 调用覆盖 1465/1595（91%），EN 字典 2093 条 | 130 个唯一中文串还没英文；`widget-docs.ts`（1393 行控件文档正文）、AI 提示词、drawable-schema 校验消息未翻；还有未包 `tt()` 的硬编码中文 |
| **资源面板** | 能看能改 | 没有搜索、重命名不同步引用、没按类型分组折叠（队列 D） |
| **大文件性能** | 无上限 | 1000+ 节点解析/渲染会卡；无虚拟滚动 |
| **测试** | 270 文件 / 2396 用例，纯函数层覆盖好 | e2e 只有 1 个 spec（editor.spec.ts）；UI 交互大多靠手测 |

## 四、完全没做的

1. **构建/编译用户项目**：不能产出可安装的 APK，只能预览 + 导出资源
2. **Java 执行/免安装调试逻辑**（M177 已论证：浏览器不可能；APK 版可行但 +3MB 且要 API 26）
3. **图标选择器填充 ImageView src**（旧 COMPLETENESS 列为远期；现在有图标库但没有「选中即填 src」的一步）
4. **组件外观自定义面板**（Material Button 填充/圆角/描边预设）
5. **第三方控件**（PhotoView 等，无官方 XML 文档，不收录）
6. **Kotlin 代码补全/重构**、Java 重构（重命名变量跨文件）

## 五、成熟度判断（按模块打分）

| 模块 | 完整度 | 说明 |
|---|---|---|
| 布局 XML 编辑 + 预览 | 95% | 主力功能，日常布局够用 |
| 资源编辑（drawable/icon/values/manifest） | 85% | 缺搜索/重命名同步 |
| 项目生命周期 | 85% | 建/改名/打开/保存都有；缺 Gradle 编辑 |
| 真机渲染 | 90% | 反复踩坑后已稳定（include/资源去重/图片格式/缓存在内） |
| Java 支持 | 45% | 编辑 + lint 完善，**不执行**，Kotlin 弱 |
| AI 助手 | 80% | 工具链完整，缺「自然语言生成整页布局」的成品入口 |
| 运行调试 | 60% | 交互仿真可用，逻辑不执行 |
| i18n | 90% | 主要界面已翻，文档类长文与部分新功能未翻 |
| 工程化 | 90% | tsc 0 错、2396 测试、next build 通过、APK 签名 v2+v3 |
| 性能 | 60% | 无大文件优化 |

**综合：作为「Android 布局可视化 IDE」，核心链路（写 XML / 拖控件 / 改属性 / 管资源 / 真机看效果 / 导出）已经是可用产品，约 85%；作为「完整 Android 开发环境」还差编译与运行（那是另一个量级的工程）。**

## 六、建议下一步（按性价比排序）

1. **资源面板：搜索 + 重命名同步引用**（队列 D，半天，日常最高频痛点）
2. **i18n 收尾**（130 个串 + widget-docs 分批，1 天）
3. **「选中图标 → 填入 ImageView src」一步到位**（半天，补上 COMPLETENESS 里的老缺口）
4. **大布局性能**（虚拟化 / 增量解析，1~2 天）
5. **e2e 补关键路径**（打开项目 → 改属性 → 保存 → 真机渲染，1 天）
6. 想清楚要不要碰「内嵌编译」（2~3 周、+3MB、API 26 起）
