// lib/plugin/installer.ts — 第三方编辑器插件安装器（M234）
//
// 装一个 bare 类型插件：
//   1. 拉 manifest.json（URL 可以是 jsDelivr raw / 任意可跨域地址）
//   2. 校验字段
//   3. 拉 bundle.js（manifest.entry 相对 manifest 同目录）
//   4. 存 IndexedDB（按 id），刷新后重新加载
//   5. 执行 bundle（它会把 bare mount 挂到 window.__axvBareEditors[id]）
//   6. 包成 React 组件 + 注册进 EditorRegistry
//
// 安全：bundle 是用户自己贴 URL 装的，代码在宿主里跑。最小版不做沙箱
// （真沙箱要 iframe + postMessage，那是 M235+）。URL 要能跨域（jsDelivr 可以）。

import { type ComponentType } from "react";
import { EditorRegistry, type EditorKind, type EditorMountProps } from "./plugin-registry";

export interface InstalledPlugin {
  id: string;
  name: string;
  version: string;
  kind: EditorKind;
  manifestUrl: string;
}

const IDB = { name: "axv-plugins", store: "bare", v: 1 };

function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB.name, IDB.v);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB.store)) db.createObjectStore(IDB.store, { keyPath: "id" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbSet(id: string, code: string, meta: InstalledPlugin): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB.store, "readwrite");
    tx.objectStore(IDB.store).put({ id, code, meta });
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGetAll(): Promise<{ id: string; code: string; meta?: InstalledPlugin }[]> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(IDB.store, "readonly");
    const req = tx.objectStore(IDB.store).getAll();
    req.onsuccess = () => res(req.result as { id: string; code: string; meta?: InstalledPlugin }[]);
    req.onerror = () => rej(req.error);
  });
}

/** 执行一段 IIFE bundle：跑完后 window.__axvBareEditors 里多一个 id */
function execBundle(code: string): void {
  // 宿主是 client 组件环境，直接 Function 执行
  // eslint-disable-next-line no-new-func
  new Function(code)();
}

function bareComponent(id: string): ComponentType<EditorMountProps> {
  const Comp: ComponentType<EditorMountProps> = (p) => {
    // 容器交给 bare mount；卸载时调 bare.unmount
    return (
      <div
        ref={(node) => {
          const bare = (
            window as { __axvBareEditors?: Record<string, { mount: (el: HTMLElement, p: EditorMountProps, b: unknown) => void; unmount: () => void }> }
          ).__axvBareEditors?.[id];
          if (!node || !bare) return;
          bare.mount(node, p, null);
        }}
        style={{ flex: 1, display: "flex", flexDirection: "column", height: "100%", overflow: "auto", background: "var(--axv-surface,#fff)" }}
      />
    );
  };
  Comp.displayName = `BareEditor(${id})`;
  return Comp;
}

/** 从 URL 装一个插件。装完注册进 EditorRegistry。返回安装后的清单信息 */
export async function installPlugin(manifestUrl: string): Promise<InstalledPlugin> {
  const r = await fetch(manifestUrl, { signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error("拉 manifest 失败：" + r.status);
  const m = (await r.json()) as {
    id: string;
    name?: string;
    version?: string;
    type?: string;
    kinds?: EditorKind[];
    entry?: string;
    label?: string;
  };
  if (!m.id) throw new Error("manifest 缺 id");
  if (!m.kinds || m.kinds.length === 0) throw new Error("manifest 缺 kinds");
  if (m.type !== "bare") throw new Error("暂只支持 bare 类型插件（type 应为 \"bare\"）");

  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf("/") + 1);
  const entry = m.entry || "bundle.js";
  const bundleUrl = base + entry;
  const br = await fetch(bundleUrl, { signal: AbortSignal.timeout(30000) });
  if (!br.ok) throw new Error("拉 bundle 失败：" + br.status);
  const code = await br.text();

  await idbSet(m.id, code, { id: m.id, name: m.name || m.id, version: m.version || "0.0.0", kind: m.kinds[0], manifestUrl });
  execBundle(code);
  const bare = (window as { __axvBareEditors?: Record<string, unknown> }).__axvBareEditors?.[m.id];
  if (!bare) throw new Error("bundle 执行后没注册到 window.__axvBareEditors（插件入口可能没挂上）");

  EditorRegistry.register({
    id: m.id,
    kinds: m.kinds,
    label: m.label || m.name || m.id,
    needsRealRender: false,
    component: async () => ({ default: bareComponent(m.id) }),
  });

  return {
    id: m.id,
    name: m.name || m.id,
    version: m.version || "0.0.0",
    kind: m.kinds[0],
    manifestUrl,
  };
}

/** 宿主启动时调：把 IndexedDB 里已装的 bundle 重新执行 + 注册（刷新后恢复） */
export async function loadInstalledPlugins(): Promise<InstalledPlugin[]> {
  let all: { id: string; code: string; meta?: InstalledPlugin }[] = [];
  try {
    all = await idbGetAll();
  } catch {
    return [];
  }
  const out: InstalledPlugin[] = [];
  for (const rec of all) {
    try {
      execBundle(rec.code);
      const bare = (window as { __axvBareEditors?: Record<string, unknown> }).__axvBareEditors?.[rec.id];
      if (bare) {
        // 用存的 meta（名字/版本/kind）恢复；旧记录没 meta 则保守用 id/code
        const meta: InstalledPlugin = rec.meta || { id: rec.id, name: rec.id, version: "", kind: "code", manifestUrl: "" };
        EditorRegistry.register({
          id: rec.id,
          kinds: [meta.kind],
          label: meta.name,
          needsRealRender: false,
          component: async () => ({ default: bareComponent(rec.id) }),
        });
        out.push(meta);
      }
    } catch {
      /* 单个插件失败不影响其它 */
    }
  }
  return out;
}

/** 已装清单（仅 id，从 window 全局看哪些 bare 注册上了） */
export function listInstalledIds(): string[] {
  const g = (window as { __axvBareEditors?: Record<string, unknown> }).__axvBareEditors;
  return g ? Object.keys(g) : [];
}
