# 项目设计文档：android-xml-canvas

## 目标
把 M3E Canvas（lnkiai/m3e-canvas）拓展成「安卓 XML 布局实时预览工具」：粘贴 res/layout/*.xml → 浏览器实时渲染近似预览，并支持从可视化画布反向生成 Android XML。

## 里程碑
- M1a ✅ XML 解析 → 渲染模型 → React 预览（832 测试）
- M1b ✅ 画布改属性回写 XML
- M2a ✅ 复合控件占位渲染（CardView/RecyclerView/Switch/CheckBox/SeekBar/Spinner/include）
- M2b ✅ ConstraintLayout 四向约束 + 0dp + bias + margin + 兄弟锚点
- M2b 二期 ✅（9cbdbb8）chain 链式排布、Guideline、Barrier、拖手柄画约束线
- **M3 三期：导出方向「空画布 → 拖控件 → 生成 XML 骨架下载」（进行中，见下）**
  - 远期规划（用户提出，暂未排期）：
    1. 图标选择器（原始版本图标集选择功能）
    2. 组件绘制样式（颜色/圆角/阴影等外观自定义）
    3. 移植到安卓 APK（本工具跑在安卓 App 内，可能是 WebView 壳 + 本地预览）

## M3 设计决议
- 画布拖控件已有（widget-catalog + 拖放到父容器/插到某控件后面），M3 核心是：
  1. 新增「生成/下载 XML」按钮：从当前编辑树序列化出带 android: + app: 前缀的正式 XML（serialize 已有），提供 .xml 下载 + 复制
  2. 空布局模板：新建时给一个 ConstraintLayout 根骨架
  3. 校验提示：生成前 lint（未约束的 CL 子项、缺 id 等），把 lint 结果当「导出前检查」展示
  4. 下载文件名默认 activity_main.xml
- 序列化：lib/xml/parser.ts 的 serialize() 已保留注释、按 app: 前缀规则输出；补 4 空格缩进的 pretty 输出（formatXml 已有）
- 验收：空白画布拖 5 个控件 + 画 2 条约束 → 生成 XML → 粘回左侧 XML 编辑器 → 渲染一致（往返不丢信息）

## 已知的故意偏差（勿当 bug 改回）
- lib/xml/parser.ts 自写轻量解析器（Node 冒烟环境没有 DOM），不是 DOMParser
- 自闭合标签解析完必须 return node
- ResolvedAttrs 值类型是联合（string | number | boolean | SizeSpec | null）
- css.ts margin/padding 用 longhand，不用简写
- 改 UTF-8 源码只用 write 工具或 node 脚本，禁 PowerShell 回写（GBK 毁中文）
- npm install 必须 --include=dev（否则 vitest/@types 缺失 → 几千假 tsc 错误）
- next build 会跑类型检查，dev 不会；自查用 npx tsc --noEmit -p .
