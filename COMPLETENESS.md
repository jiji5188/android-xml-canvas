# 项目完整度评估（2026-11-09 刷新）

> 上一版是 2026-11-07（打包还没打通、2396 测试）。这份按当前代码实测重写。
> 2026-11-09 晚再刷：补上 Java/Kotlin 轻量仿真（M199/M200）、分享 APK、导出可编译项目、e2e 第 2 个 spec。
> 数据均可在仓库里复现，命令写在文末。

## 一、体量

| 项目 | 数据 |
|---|---|
| 源码文件 | 218 个（lib/ + components/ + app/，不含测试） |
| 源码行数 | ~64,700 行 |
| 测试文件 | 294 个 / 2,614 通过 / 1 skip |
| lib/xml 纯逻辑模块 | 145 个 |
| components 组件 | 52 个 .tsx + 样式 |
| 控件目录 | 98 条（Android / AndroidX / Material 三库） |
| 设备预设 | 18 个（手机 / 横屏 / 平板 / 折叠 / 电视 / 手表） |
| e2e | 2 个 spec / 9 条（editor、flows） |
| APK | 12.00 MB（versionCode 265 / 1.16.47） |
| i18n | EN 字典 2,388 条；`tt("中文")` 1,768 处调用 **全部覆盖，缺 0** |

## 二、已经完整的能力（可直接用）

### 1. 布局编辑与预览
- 12 种布局容器（Linear/Frame/Relative/Constraint/Grid/Table/Scroll/Nested/Horizontal/Coordinator/Drawer/Flow/MotionLayout）
- ConstraintLayout：四向约束、dp、bias、margin、chain、Guideline、Barrier、拖手柄连线、自动推断约束
- 控件目录 98 个，插入到父/兄弟、跨父级拖拽排序、图层树、树内搜索
- 属性面板：尺寸/颜色/枚举/文本/权重/可见性/内外边距/重力，`?attr/` 主题属性展开
- 画布：设备外壳、状态栏、缩放、选中高亮、几何手柄、检查器（实测尺寸 + 相对坐标）
- 代码 ↔ 画布双向：改属性回写文本、改文本重渲染（保留注释与缩进）
- 实时 lint：标签未闭合、CL 子项未约束、缺 id、命名空间误用、manifest 规范
- 撤销/重做（合并窗口）、历史快照、自动保存 localStorage
- 多设备并排对比（多台设备各自独立求解）

### 2. 资源体系
- 扫描真实项目 `res/`：layout / drawable / values / styles / mipmap / menu / anim
- 资源值编辑器：strings / colors / dimens 读写真实文件
- drawable 编辑器：shape / selector / layer-list / ripple / inset / clip，14 个预设（含 seekbar-track、input-field、checkbox 等控件样式），真预览
- 图标编辑器：矢量画布、6 个内置图标库、SVG 粘贴、文字转路径
- 应用图标生成：adaptive-icon 四件套（前景 vector + 背景 shape + mipmap-anydpi-v26 ×2）、三种遮罩预览、参数持久化 + 从项目反读
- Manifest 编辑器：application/activity 属性、图标规范检查 + 一键修复
- 资源引用检查 + 一键修复（@drawable/@string/@color/@dimen/@layout/@id/@style 拼错）
- **资源改名同步引用**：XML 的 `@type/name` + Java/Kotlin 的 `R.type.name` 一起改（含 drawable↔mipmap 互通）
- Java 静态检查 12 类规则：括号/引号/R.id 与 R.layout 存在性/findViewById 类型/方法名拼错/import/@Override 位置…（都可一键修）

### 3. 项目与文件
- 新建 Android 项目骨架（可填包名，自动生成目录 / namespace / applicationId / 主题 / manifest）
- 项目改名（目录 + app_name + Theme 定义与引用 + settings.gradle 同步）
- 项目属性弹窗（项目名/应用名/包名/依赖库增删/jar 列表/图标）
- 项目列表长按菜单（打开 / 删除 / 属性）
- 多文件编辑（布局 + Java/Kotlin + values + drawable），文件树
- 保存：浏览器 File System Access / APK 原生目录写入，另存到文件系统

### 4. 真机渲染（差异化亮点）
- 手机端 aapt2 现场编资源 → 生成 `hasCode=false` 的资源 APK → PreviewActivity 用 AssetManager 挂载 inflate，**全程不安装**
- 自动补占位资源、同名去重、adaptive-icon 归位、include 命名空间修正、图片格式嗅探
- framework 桩（164KB）解决手机 aapt2 读不到 framework-res 的问题

### 5. 打包成可安装 APK（M192 打通，2026-11-09）
- 设备端全链路：aapt2 编译资源 → 注入壳 dex（ShellActivity） → 手写 zip 对齐 → apksig 签名 → 调系统安装器
- keystore 设备端生成（纯 Java PKCS#12，不依赖 keytool）
- 签名配置写进 `app/build.gradle` 的 signingConfigs，并按项目记到本机
- assets 里的 shell/signer 载荷 gzip 存放，规避厂商安装扫描
- 修过的硬骨头：Android 14 禁写可写 dex（落地文件置只读）、aapt2 syntax error（复用渲染的资源洗白）、Java 文档误当布局写盘

### 6. 运行调试（Java/Kotlin 轻量仿真）
- 点击/长按/涟漪、输入框可输入、勾选/开关/单点切换、SeekBar 拖动、Spinner 弹窗、列表注入演示数据
- 事件日志、震动反馈；纯前端，**不编译、不执行真 Java**
- Java/Kotlin 逻辑仿真（M199/M200）：读项目里的 `.java/.kt`，按布局名找 Activity，跑 `onCreate` 里的 `setContentView` / `findViewById` / `setText` / `setVisibility` / `setEnabled` / `Toast` / `Log` / `startActivity`
- 支持 `if / else` 条件（变量比较、`getVisibility() == View.GONE`、Kotlin `isVisible`）、成员变量初值、`count++` / `+=`、`String.valueOf(n)` / `"前缀" + n + "后缀"` / Kotlin 模板串
- 点按钮优先执行代码里的 `setOnClickListener`（跟安卓真实行为一致），换屏时按目标布局加载对应 Activity 的 `onCreate`；认不出的语句记「暂不支持」日志，不假装成功

### 7. AI 助手
- 5 家 OpenAI 兼容服务商预设，key 只存 localStorage
- 8 个工具（list/read/outline/find_usages/check_java/write/apply_patch/search），原生 function calling + `axv-tool` 文本协议双通道
- 暂存模式、差异预览、调用日志

### 8. 导出
- 布局 XML 下载/复制、导出 res.zip、导出预览图（PNG/SVG）、真机渲染预览、打包成 APK、**打包后直接分享（系统分享面板，content:// 授权）**、导出可编译项目 zip

## 三、半成品 / 有明显缺口的

| 项 | 现状 | 缺口 |
|---|---|---|
| **Java 代码执行** | 静态检查（12 类规则）+ 轻量逻辑仿真（不编译） | **不能真跑**。仿真只认常见写法，业务逻辑/异步/网络/数据库都进「暂不支持」。真跑要 ECJ(3MB) + d8(4.6~15.8MB) + android.jar 桩，minSdk 24 与 `java.nio.file` 冲突；浏览器版无 JVM |
| **Kotlin** | 有语法高亮 + 部分 lint（方法名检查刻意跳过，扩展函数误报多） | 无 Kotlin 专属解析/补全 |
| **预览保真度** | CSS 近似渲染 | WebView/VideoView/SurfaceView/TextureView 只画占位；RecyclerView/GridView 是条纹占位；字体度量与真机有偏差 |
| **Gradle** | 能读写 build.gradle、能增删 dependencies、项目改名会同步 | 不走真正的 Gradle 构建（我们绕开 Gradle 直接用 aapt2 + d8 + apksig） |
| **打包产物** | 能生成、能直接调安装器、能走系统分享面板发出去、能导出可编译项目 zip | 不支持 AAB；不支持一键上架 |
| **大文件性能** | 无上限 | 1000+ 节点解析/渲染会卡；无虚拟滚动 |
| **测试** | 294 文件 / 2,614 用例，纯函数层覆盖好 | e2e 只有 2 个 spec / 9 条（编辑、控件流）；运行预览/签名/资源改名仍是单测 + 手测 |

## 四、完全没做的

1. **内嵌编译 Java**（ECJ + d8 + DexClassLoader）——成本高、风险大，暂不做
2. **Kotlin 代码补全 / 跨文件重构**、Java 重构（重命名变量跨文件）
3. **第三方控件**（PhotoView 等，无官方 XML 文档，不收录）
4. **组件外观自定义面板**（Material Button 填充/圆角/描边预设）
5. **多语言资源编辑**（values-zh / values-en 分目录编辑，目前只认 values/）
6. **AAB 打包 / Play 上架流程**（只有 APK）

## 五、复现命令

```powershell
cd D:\android-xml-canvas\repo
(Get-ChildItem -Recurse -Include *.ts,*.tsx -Path lib,components,app -File).Count
(Get-ChildItem -Recurse -Include *.ts,*.tsx -Path lib,components,app -File | Get-Content | Measure-Object -Line).Lines
(Get-ChildItem lib\xml -Filter *.ts).Count
(Get-ChildItem test -Filter *.test.ts*).Count
(Get-Item app.apk).Length
npx vitest run --reporter=dot
node C:\Users\admin\.openclaw\workspace\tmp-i18n-scan.mjs   # i18n 覆盖率
```
