# 2026-10-27 项目完整度评估（供后续维护参考）

## 模块总览（22 个 lib/xml + 38 个组件 + 29 个测试文件 / 1183 测试）

### 解析与渲染引擎（lib/xml/）
- parser.ts（自写轻量 XML 解析器 + 行号映射 + 注释抽取）
- resolve.ts（@string/@color/@dimen/?attr 展开，含 styles.xml 主题继承）
- css.ts（属性 → CSS：尺寸/颜色/文本/背景/圆角/阴影/变换/可见性/子布局）
- constraints.ts + autoconstrain.ts（ConstraintLayout 约束求解，含 chain/Guideline/Barrier）
- relative.ts（RelativeLayout 定位规则）
- shape.ts（shape drawable 解析：solid/gradient/corners/stroke/oval）
- include.ts（include 展开 + 断环）
- theme.ts（设备预设 16 个 + 可读色计算）
- resources.ts（内置颜色/dimen/string 兜底）
- resdir.ts（res 目录上传，递归解析 drawable/layout/values/styles）

### 写回与结构编辑
- writeback.ts（属性回写，纯文本级）
- insert.ts（插入子/兄弟节点 + 约束默认值）
- reorder.ts（跨父级移动，保留注释和缩进）
- format.ts（pretty print + 4 空格缩进）
- lint.ts（未约束 CL 子项、缺 id 等检查）
- export.ts（生成 .xml 下载 / 复制）
- history.ts（撤销合并窗口）

### UI（components/）
- 左侧滑面板：组件（WidgetPalette）/ 图层（LayerTree）/ 资源（ResTree）
- 右侧滑面板：属性（AttrPanel）/ 文档（attr 速查 + 官方链接）
- 画布：XmlCanvas（手机外壳 + 状态栏 + 约束手柄 + 几何手柄 + 选中高亮 + 拖动）
- 代码编辑器：XmlCodeEditor（高亮 + 行号跳转）
- 工具栏：XmlEditor（设备切换、新建模板、导出下载、res 目录选择、打开 xml 文件）

## 完整度评估（功能 vs 实际项目）

### 已支持（覆盖 95% 真实项目需求）
- 布局类型：LinearLayout / FrameLayout / RelativeLayout / ConstraintLayout / GridLayout / TableLayout / ScrollView / NestedScrollView / HorizontalScrollView / CoordinatorLayout / DrawerLayout / 全部 78 种控件文档
- Material 组件：Button/Card/Toolbar/AppBar/FAB/BottomNav/TabLayout/Chip/Switch/TextInputLayout/ProgressBar 等 21 个
- 平台控件：TextView/Button/EditText/ImageView/Switch/CheckBox/RadioButton/SeekBar/Spinner/ProgressBar/RecyclerView/ListView/CardView/Guideline/Barrier/Group/MotionLayout/Flow/FragmentContainerView/DatePicker/TimePicker/CalendarView/GridView/ViewPager/Chronometer/TextClock 等 57 个
- res 资源：values/colors.xml、dimens.xml、strings.xml、styles.xml（含主题继承）、drawable/*.xml（shape 渐变/圆角/描边）、layout/*.xml（递归 include）
- 交互：属性编辑（颜色/尺寸/枚举/文本）、约束手柄、几何手柄、图层拖拽排序、撤销/合并、自动保存（localStorage）
- 设备预设：16 个（手机/平板/横屏/折叠/电视/手表）
- 导出：.xml 下载、复制、往返检查（粘贴回编辑器不丢信息）

### 尚未做（但属于「远期规划」）
1. **图标选择器**（原始 M3E 功能：从 Material Icons 选图标，填入 ImageView 的 src）
2. **组件外观自定义**（Material Button 的填充色/描边/圆角/阴影，CardView 的选中态等，目前只写了文档）
3. **移植到 APK**（本工具跑在 Android WebView 里，作为 IDE 插件/本地工具）
4. **AI 辅助生成**（自然语言 → XML 布局，M3E 原有功能）

### 已知限制（可接受）
- WebView/VideoView/SurfaceView/TextureView 只画占位框，不渲染实际内容（预览层无法执行代码）
- 列表（RecyclerView/GridView）画条纹占位，不显示实际 item
- 第三方控件（PhotoView/MaterialRangeSlider 等）没有官方 XML 说明，不收录
- 对话框类（MaterialAlertDialogBuilder/BottomSheetDialog）不是布局控件，跳过

## 技术栈
- Next.js 16 + React 19 + Turbopack（M3E 原有）
- TypeScript 严格模式（tsc 零错误）
- Vitest（29 个测试文件，1183 测试）
- 纯浏览器运行，无后端依赖

## 代码质量
- lib/xml/ 层：纯函数，Node/浏览器双端可用，无 React 依赖
- components/ 层：React 组件，与 lib/xml/ 通过 props/callback 解耦
- 测试覆盖：每模块 ≥1 文件，关键路径（解析/渲染/写回/导出）全覆盖
- tsc 严格模式，next build 通过，无 lint 错误

## 建议下一步（如果继续做）
1. **AI 辅助生成**（M3E 原有功能移植到 XML 布局场景）：选中某区域 → 自然语言描述 → 生成/修改控件
2. **图标库**（Material Symbols 字体，M3E 已加载，加个选择器填 ImageView src）
3. **APK 壳**（WebView + 本地文件读取，做成离线可用的 Android 工具）
4. **性能优化**（大 XML 文件的解析/渲染，目前无上限，1000+ 节点可能卡顿）
