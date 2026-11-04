# drawable 模型与扁平化（M126 设计稿）

> 目标：把 Android 全部 drawable 标签整理成一套自己能编辑的模型，先定「谁当节点、谁当属性」，
> 再谈每个标签的参数面板。落笔时间 2026-11-05，对应代码 `lib/xml/drawable-node.ts` / `drawable-schema.ts`。

## 一、判据：问三句就能定性

一个标签出现在 XML 里，先问：

1. **它自己会画出像素吗？** 会 → 叶子（leaf）。
2. **它只包一个 drawable，且只改几何（位置/大小/朝向/裁剪）？** 只做这事的 → 包装（wrapper），扁平化成「变换」挂到子项上。
3. **它有多个 drawable 子项，并规定了怎么选/怎么叠？** → 容器（container）。
4. **它离开父元素就毫无意义？**（solid / corners / stroke / padding / size）→ 父元素的属性字段，不是节点。

这四问是互斥的，一个标签只落一处。判错的代价：模型里多一层没用的嵌套，用户在树上多点两下。

## 二、四类角色 × 全部标签

### 1. 叶子（自己画像素）

| 标签 | 说明 | 可编辑性 |
|---|---|---|
| `shape` | 矩形/椭圆/线/环 + 填充 + 描边 + 圆角 + 内外边距 | 全参数（已有） |
| `color` | 纯色，属性式或文本式 | 全参数（已有） |
| `bitmap` | 位图 + 平铺/重力 | 参数可编辑（src 走资源选择） |
| `nine-patch` | .9 图 | 参数可编辑（同上） |
| `vector` | 矢量路径 | 只读保留（另有图标编辑器管） |
| `animated-vector` | vector + 动画 | 只读保留 |
| 引用 `@drawable/x` | 指向别的文件 | 只读（可跳转） |

### 2. 包装（单子节点，只改几何）→ 扁平化成「变换」

| 标签 | 参数 | 归到哪种变换 |
|---|---|---|
| `inset` | insetLeft/Top/Right/Bottom 或 inset（四边同值） | 缩边 |
| `clip` | clipOrientation（horizontal/vertical）+ gravity | 裁剪 |
| `scale` | scaleWidth/scaleHeight/scaleGravity + pivotX/Y | 缩放 |
| `rotate` | fromDegrees/toDegrees/pivotX/pivotY | 旋转 |
| `animated-rotate` | 上面的参数 + 动画时长 | 旋转 + 动画 |

关键结论：**这四个是同一件事的不同参数**，都是「把这个 drawable 的绘制区域变一下」，本质是 CSS 的 transform 链。
所以不做成节点，做成子项上的一条**有序变换链**：

```
transform = { kind: "inset" | "clip" | "scale" | "rotate" | "animated-rotate", params }
```

为什么是「有序」而不是「集合」：`<inset><clip>` 和 `<clip><inset>` 画出来不一样（先缩再裁 ≠ 先裁再缩），顺序必须保留，界面上要能上移下移。

包装也能当根（`res/drawable/xx.xml` 里只有一个 `<rotate>`），所以根位置用「叶子/容器 + 变换链」表示，不需要单独的根类型。

### 3. 容器（多子项 + 选择/叠加规则）

| 标签 | 规则 | 选择键 |
|---|---|---|
| `layer-list` | 全部参与绘制，按 z 轴叠加，第 0 个最底 | 无（全部画） |
| `ripple` | 内容 1 个 + 遮罩 1 个（mask 不绘制，只定波纹范围） | 无（按 pressed 追加波纹） |
| `selector` | 只画命中的 1 个 | `state_*` 状态位 |
| `level-list` | 只画命中的 1 个 | `minLevel` ~ `maxLevel` |
| `animation-list` | 按时间轮播 | `duration` + `oneshot` |
| `transition` | 按状态变化切换 + 动画 | `fromScene` / `toScene` + `reversible` |
| `animated-selector` | selector + 状态切换动画 | `state_*` + 过渡 |

**统一抽象**：容器只有两种——「叠加」（layer / ripple）和「择一」（selector / level-list / animation-list / transition / animated-selector）。
「择一」只是选择键不同（状态位 / 等级 / 时间 / 场景），UI 上共用一套「分支列表 + 每支的条件字段」，字段由 schema 决定。

### 4. 属性元素（不是 drawable，压成父节点的字段）

`shape` 的子元素全是这一类，早已压平：

- `solid` → `spec.solid`（单色填充）
- `gradient` → `spec.gradient`（类型/角度/起止色/中心点）
- `corners` → `spec.corners`（四角半径）
- `stroke` → `spec.stroke`（宽度/颜色/dash）
- `padding` → `spec.padding`（四边内边距）
- `size` → `spec.size`（宽高）

同理 `ripple` 的 `color` / `radius` 是属性，不是子节点。

## 三、落到代码：现在缺什么

| 现状 | 目标 |
|---|---|
| `inset` 是独立节点类型 | 变成 `transform` 链上的一环 |
| `clip` / `scale` / `rotate` 一律 `unsupported` + raw | 解析成 transform，可编辑 |
| `level-list` 只读 | 归入「择一容器」，先只读展示结构，后接参数 |
| `selector` 的 `items` 与「择一」容器各写一套 | 共用 `ChoiceItem { key, cond, node }` |
| `parseDrawable` 只记 raw 文本 | 记原始字节区间，未编辑分支原样拼回 |

模型（目标形态）：

```ts
type DrawableNode =
  | { t: "shape"; spec: ShapeSpec; transform?: Transform[]; decl?: string }
  | { t: "color"; color: string; asText?: boolean; transform?: Transform[] }
  | { t: "leaf"; tag: "bitmap" | "nine-patch" | "vector" | "animated-vector"; attrs: Attr[]; children?: string; transform?: Transform[] }
  | { t: "ref"; name: string; transform?: Transform[] }
  | { t: "layer"; items: Slot[] }
  | { t: "choice"; mode: "state" | "level" | "frame" | "scene"; items: Slot[] }
  | { t: "ripple"; color?: string; radius?: string; content?: DrawableNode; mask?: DrawableNode }
  | { t: "unsupported"; tag: string; raw: string };

type Slot = { cond?: Record<string, string>; offset?: Insets; size?: Size; alpha?: number; gravity?: string; id?: string; node: DrawableNode };
type Transform = { kind: "inset" | "clip" | "scale" | "rotate" | "animated-rotate"; params: Record<string, string> };
```

`transform` 挂在「会画东西的那一层」上——叶子/引用的节点本身，或容器整体的变换（容器里的子项各自也可以有）。这样 `layer > item > inset > rotate > shape` 扁平化成：

```
layer
└ slot(offset: l=2 t=2)
   └ shape(oval) + transform[ inset(4), rotate(180°) ]
```

树上少两层，参数页多一条「变换」栏。

## 四、树上怎么显示

- 行末给一条变换摘要，`内缩 4 · 旋转 180°`，灰色小字，截断在 12 字内
- 选中该行 → 参数页顶部一块「变换」卡片，按顺序列出，每条能改参数、上移、下移、删除
- 「＋」菜单里不再出现 inset/clip/scale/rotate，改成「加变换」二级菜单
- 择一容器的每个分支行显示条件摘要（按下 / 等级 0-50 / 第 3 帧 200ms）

## 五、保真（这块必须先于扩标签）

现在打开再保存会：重排 raw 缩进、丢注释、丢 XML 声明。修法：

1. `parser` 的 `XmlNode` 加 `srcStart` / `srcEnd`（内部已有 offset，成本低）
2. `unsupported` 存原始切片，不做任何重排；回写时按新缩进整体平移，不改内部
3. 根节点保留 `<?xml ... ?>` 声明原文
4. 竣工形态：**只重建被编辑的那一支**，其余字节原样拼回去（编辑分支打 revision，未编辑分支直接取原文区间）

## 六、实施顺序（建议）

1. **保真三件套**（offset + 原始切片 + 声明）——不修不敢用在真实项目
2. **变换链**：inset/clip/scale/rotate 解析、回写、预览、参数面板（本轮主体）
3. **择一容器统一**：level-list / animation-list / transition 进模型，先只读结构，再接参数
4. **bitmap / nine-patch / vector** 参数面板（src 走资源选择，其余字段照 schema）
5. 预设扩展：带变换的按钮（缩放按压）、进度环（level-list）、帧动画

## 七、一个必须承认的边界

`vector` 里的 `<path android:pathData="...">` 是另一个量级的东西（路径语法 + 图标编辑器已有），
drawable 结构树不该试图编辑它。策略固定为：**整块保留 + 可跳转图标编辑器**，不放进树里。
