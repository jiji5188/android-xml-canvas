// lib/plugin/plugin-registry.ts — 编辑器插件化：manifest + 注册表（M230 试点）
//
// 目标：把「按资源类型选哪个全屏编辑器」从 XmlEditor 里那堆 if/else 收敛成一张注册表。
// 每个编辑器（drawable、icon…）声明一个 manifest（id + 支持的 kind + 懒加载组件），
// 宿主只认「kind → 插件」这一层，不再直接 import 具体编辑器组件。
//
// 为什么现在只做「注册 + 懒加载」，不做「独立 bundle 跨包」：
//   - 先验证接口/分发链路（插件化核心），bundle 拆分是纯打包细节，最后再做
//   - 编辑器对 i18n/主题/画布共享层仍有依赖，跨 bundle 要设计「宿主注入」通信协议，
//     那是 M231+；这一步先把「注册表查得到 + 懒加载 + 适配宿主真实 props」跑通
//
// 宿主用法：
//   const ed = EditorRegistry.resolve("drawable");
//   ed && <ed.Component {...mountProps} />

import type { ComponentType } from "react";

/** 资源「种类」：宿主判定时用，决定交给哪个编辑器。新增编辑器只加一个 kind */
export type EditorKind = "drawable" | "icon" | "code" | "theme" | "unknown";

/**
 * 编辑器组件的统一入参（最小集）。宿主把 resShape/resIcon 状态映射成这里，
 * 各编辑器按需取用；多余字段忽略。
 */
export interface EditorMountProps {
  /** 资源名（不带 .xml / 不带 @drawable/） */
  name: string;
  /** 现有文件内容原文（新建时为空串） */
  existingXml: string;
  /** 已有同类资源名（防重名） */
  existingNames: string[];
  /** 保存回调：资源名 + 新 XML */
  onSave: (resourceName: string, xml: string) => void;
  /** 关闭回调 */
  onClose: () => void;
  /** @drawable 引用真渲染用：项目 res 资源源（形状由各编辑器自己定，宿主透传） */
  res?: unknown | null;
  /** 真预览时递归收集嵌套引用的 IO */
  io?: unknown | null;
  /** 当前打开文档的相对路径 */
  docRel?: string | null;
  /** 编辑器专属透传参数（宿主不解释，各适配器自己取） */
  extra?: Record<string, unknown>;
}

/** 一个编辑器插件的声明。Component 是懒加载的，首屏不把所有编辑器打进 bundle */
export interface EditorManifest {
  id: string;
  kinds: EditorKind[];
  label?: string;
  component: () => Promise<{ default: ComponentType<EditorMountProps> }>;
  /** 是否需要真机渲染桥（有就显示「真机预览」按钮） */
  needsRealRender?: boolean;
}

class Registry {
  private byKind = new Map<EditorKind, EditorManifest>();
  private byId = new Map<string, EditorManifest>();

  register(m: EditorManifest): this {
    if (!m.id) throw new Error("manifest.id 必填");
    this.byId.set(m.id, m);
    for (const k of m.kinds) this.byKind.set(k, m);
    return this;
  }
  resolve(kind: EditorKind): EditorManifest | null {
    return this.byKind.get(kind) ?? null;
  }
  get(id: string): EditorManifest | null {
    return this.byId.get(id) ?? null;
  }
  kinds(): EditorKind[] {
    return [...this.byKind.keys()];
  }
  get size(): number {
    return this.byId.size;
  }
}

/** 全局单例。宿主与测试共用，避免注册散落 */
export const EditorRegistry = {
  _r: new Registry(),
  register(m: EditorManifest) {
    this._r.register(m);
  },
  resolve(kind: EditorKind) {
    return this._r.resolve(kind);
  },
  get(id: string) {
    return this._r.get(id);
  },
  kinds() {
    return this._r.kinds();
  },
  get size() {
    return this._r.size;
  },
  /** 测试用：清空注册 */
  reset() {
    (this as { _r: Registry })._r = new Registry();
  },
};
