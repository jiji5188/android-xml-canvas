// lib/plugin/toolchain-registry.ts — M409：工具链插件化（多语言骨架）
//
// 和 plugin-registry.ts（编辑器插件化，M230）同构：一张表 + 懒加载 + 能力位。
//
// 目标：加一门语言（C / C++ / Python / JS / TS…）＝ 新增一个 toolchain 文件 + 注册一行。
// 宿主（XmlEditor 等）只问 capabilities，**永不写** `if (language === "java")`。
//
// 为什么先做这一步（而不是先拆 store）：
//   多语言真正的债是「构建入口写死」（compileProjectJava / buildApk 直接调，224 处）
//   和「语言分支」（25 处）。这一层把两者都收进插件，加语言不用碰宿主。

/** 工具链 id。新语言在这里加一项即可（类型层面强制唯一） */
export type ToolchainId =
  | "android-java"
  | "c"
  | "cpp"
  | "python"
  | "js"
  | "ts";

/** 产物类型 */
export type ArtifactKind = "apk" | "aar" | "jar" | "exe" | "wasm" | "script" | "none";

/** 运行方式：dex（Android 动态加载）/ wasm（WebView 沙箱）/ native（可执行文件）/ interpret（解释执行） */
export type RunMode = "dex" | "wasm" | "native" | "interpret" | "none";

/**
 * 能力位。宿主靠这些布尔量决定「显示哪些面板」。
 * 这是「不写语言判断」的唯一出口——新增语言只改这组值。
 */
export interface ToolchainCapabilities {
  /** XML 布局画布（只有 android-java 为 true） */
  hasCanvas: boolean;
  /** 资源系统 res/（drawable / values / 布局） */
  hasRes: boolean;
  /** AndroidManifest.xml */
  hasManifest: boolean;
  /** Gradle 构建脚本 */
  hasGradle: boolean;
  /** 构建产物类型（决定构建按钮文案/行为） */
  artifact: ArtifactKind;
  /** 运行方式（决定「▶ 运行/调试」走哪条路） */
  runMode: RunMode;
}

/** 构建 / 运行的通用结果基座（各工具链在此基础上扩展自己的字段） */
export interface ToolchainResultBase {
  ok: boolean;
  /** 失败阶段：env / pkg / compile / link / pack / sign / dex / entry / timeout / exception … */
  step?: string;
  log?: string;
  ms?: number;
}

/** 构建结果（产物信息） */
export interface ToolchainBuildResult extends ToolchainResultBase {
  /** 产物绝对路径（成功时） */
  path?: string;
  name?: string;
  bytes?: number;
}

/** 运行结果（stdout / 异常等） */
export interface ToolchainRunResult extends ToolchainResultBase {
  stdout?: string;
  stderr?: string;
  /** 入口方法返回值（String.valueOf；void → ""） */
  returnValue?: string;
  /** 异常类名 + message */
  exception?: string;
  stackTrace?: string;
  /** 实际执行的入口（全限定.方法(参数)） */
  entry?: string;
}

/**
 * 语法描述。CodeEditor 靠它决定高亮 / 注释符 / 词库，
 * 避免「加一门语言就在编辑器里长一堆 if」。
 */
export interface SyntaxSpec {
  /** 显示名，如 "Java" / "Python" */
  name: string;
  /** 文件扩展名（含点，小写） */
  extensions: string[];
  /** 行注释符，如 ["//"] / ["#"] */
  lineComment: string[];
  /** 块注释起止；没有就省略。注意：此处不要写真的注释结束符字面量 */
  blockComment?: [string, string];
  /** 词库 id（对应 lib/xml/lexicon.ts 里的表；没有就省略） */
  lexiconId?: string;
}

/**
 * 新建文件模板描述。
 * 结构对齐 lib/xml/new-file.ts 的 NewFileTemplate，但不 import 它（避免 lib↔lib 循环）。
 */
export interface ToolchainTemplateSpec {
  /** 全局唯一的模板键（建议 "<cat>:<tpl>"，如 "java:class"） */
  key: string;
  label: string;
  /** 文件扩展名，含点 */
  ext: string;
  /** 文件体模板，{name} 由宿主替换 */
  body: string;
  /** 是否支持「同时创建配套布局」 */
  companion?: boolean;
}

/**
 * 一个工具链插件。
 *
 * build/run 的入参是 `unknown`：异质注册表必然的取舍（同 EditorMountProps.extra）。
 * 具体工具链提供类型安全的重载，见 toolchains/android-java.ts。
 */
export interface Toolchain {
  id: ToolchainId;
  /** 显示名，如 "Android (Java/Kotlin)" */
  displayName: string;
  /** 归这个工具链管的源文件扩展名（含点，小写） */
  fileExtensions: string[];
  capabilities: ToolchainCapabilities;
  syntax: SyntaxSpec;
  /** 新建文件模板（「＋」菜单直接渲染这个） */
  templates: ToolchainTemplateSpec[];
  /** 当前环境能不能构建（网页版 / 无原生桥 → false） */
  canBuild(): boolean;
  /** 构建产物 */
  build(input: unknown): Promise<ToolchainResultBase>;
  /** 运行 / 调试（可选；不支持执行的语言不实现） */
  run?(input: unknown): Promise<ToolchainResultBase>;
}

class Registry {
  private byId = new Map<ToolchainId, Toolchain>();

  register(tc: Toolchain): this {
    if (!tc.id) throw new Error("toolchain.id 必填");
    this.byId.set(tc.id, tc);
    return this;
  }

  get(id: ToolchainId): Toolchain | null {
    return this.byId.get(id) ?? null;
  }

  /** 按文件名 / 相对路径找工具链（扩展名大小写不敏感；先到先得） */
  forFile(fileNameOrRel: string): Toolchain | null {
    const lower = String(fileNameOrRel || "").toLowerCase().replace(/\\/g, "/");
    if (!lower) return null;
    for (const tc of this.byId.values()) {
      for (const ext of tc.fileExtensions) {
        if (lower.endsWith(ext.toLowerCase())) return tc;
      }
    }
    return null;
  }

  ids(): ToolchainId[] {
    return [...this.byId.keys()];
  }

  all(): Toolchain[] {
    return [...this.byId.values()];
  }

  get size(): number {
    return this.byId.size;
  }
}

/** 全局单例。宿主与测试共用，避免注册散落 */
export const ToolchainRegistry = {
  _r: new Registry(),
  register(tc: Toolchain) {
    this._r.register(tc);
  },
  get(id: ToolchainId) {
    return this._r.get(id);
  },
  forFile(fileNameOrRel: string) {
    return this._r.forFile(fileNameOrRel);
  },
  ids() {
    return this._r.ids();
  },
  all() {
    return this._r.all();
  },
  get size() {
    return this._r.size;
  },
  /** 测试用：清空注册 */
  reset() {
    (this as { _r: Registry })._r = new Registry();
  },
};
