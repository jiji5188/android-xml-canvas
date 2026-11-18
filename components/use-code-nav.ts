// components/use-code-nav.ts — M366 step20（路线 2 拆解）：代码导航域
//
// 从 XmlEditor.tsx 抽出（原 ~1640-1921 区域）：
//   focusLine/focusTick state（gotoLine 用）
//   gotoLine / jumpToCodeLine（跳行）
//   usesPanel state（引用浮层）
//   openUsages / openResRef / checkDeleteImpact / onGotoRef / hoverTip / onRenameResource
//
// 全部是事件回调（不在渲染期求值）→ 用 deps-getter + 延迟 Proxy，安全。
// 例外：useBackGuard(usesPanel ...) 留在壳里（它要用返回的 usesPanel，且 backguard 注册顺序敏感）。
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createResResolver } from "@/lib/xml/res-index";
import { findUsages, type UsageHit } from "@/lib/xml/ai-usages";
import { renameResRef, singularResType } from "@/lib/xml/res-search";
import type { AiFileEntry, AiFileIo } from "@/lib/xml/ai-tools";
import { formatResRefHit } from "@/lib/xml/res-refs";
import { parseRefToken, refAction } from "@/lib/xml/ref-token";
import { isJavaLikePath, parseOutline } from "@/lib/xml/java-outline";
import type { ProjectSource, BrowseEntry } from "@/lib/xml/project-browse";

export interface CodeNavDeps {
  setMobileTab: (t: "preview" | "xml" | "values") => void;
  setLeftOpen: (v: boolean) => void;
  setRightOpen: (v: boolean) => void;
  isMobile: boolean;
  mobileTab: "preview" | "xml" | "values";
  aiFileIo: AiFileIo | null;
  openRel: string | null;
  tt: (s: string, v?: Record<string, string>) => string;
  flashNote: (msg: string, ms?: number) => void;
  loadEntry: (source: ProjectSource, entry: BrowseEntry) => Promise<void>;
  activeProjectRef: { current: { source?: ProjectSource | null } | null };
  xml: string;
  setWsMsg: (s: string) => void;
  setXmlAndTrack: (next: string, mergeKey?: string) => void;
  resExtras: { drawableXml?: Record<string, string> } | null;
  generatedDrawables: Record<string, string>;
}

export interface CodeNavResult {
  focusLine: number;
  focusTick: number;
  setFocusLine: React.Dispatch<React.SetStateAction<number>>;
  setFocusTick: React.Dispatch<React.SetStateAction<number>>;
  usesPanel: {
    title: string;
    hits: UsageHit[];
    files: number;
    truncated: boolean;
    loading: boolean;
  } | null;
  setUsesPanel: React.Dispatch<
    React.SetStateAction<
      | { title: string; hits: UsageHit[]; files: number; truncated: boolean; loading: boolean }
      | null
    >
  >;
  gotoLine: (line: number) => void;
  jumpToCodeLine: (line: number) => void;
  openUsages: (value: string) => Promise<void>;
  openResRef: (value: string) => Promise<void>;
  checkDeleteImpact: (symbol: string) => Promise<{ count: number; samples: { rel: string; line: number }[] } | null>;
  onGotoRef: (raw: string) => void;
  hoverTip: (raw: string) => string | null;
  onRenameResource: (oldRel: string, newName: string) => Promise<{ ok: boolean; msg: string }>;
}

export function useCodeNav(getDeps: () => CodeNavDeps): CodeNavResult {
  const depsRef = useRef<CodeNavDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as CodeNavDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // M187：代码视图早搬到主区 tab 了，跳行要切主区 tab + 关面板 + 下一帧跳行
  const [focusLine, setFocusLine] = useState(0);
  const [focusTick, setFocusTick] = useState(0);
  const gotoLine = useCallback((line: number) => {
    D.setMobileTab("xml");
    D.setLeftOpen(false);
    D.setRightOpen(false);
    requestAnimationFrame(() => {
      setFocusLine(line);
      setFocusTick((t) => t + 1);
    });
  }, []);

  /** M61：函数列表 → 跳行（手机上先切到「代码」页，等一帧编辑器挂载后再跳） */
  const jumpToCodeLine = useCallback(
    (line: number) => {
      if (D.isMobile && D.mobileTab !== "xml") D.setMobileTab("xml");
      // M63j：手机端跳完就收起右侧面板，把屏幕让给代码（桌面端保持面板不关）
      if (D.isMobile) D.setRightOpen(false);
      requestAnimationFrame(() => {
        setFocusLine(line);
        setFocusTick((t) => t + 1);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** M68（C3）：「引用」浮层（查这个资源在项目里被哪些地方用到） */
  const [usesPanel, setUsesPanel] = useState<{
    title: string;
    hits: UsageHit[];
    files: number;
    truncated: boolean;
    loading: boolean;
  } | null>(null);

  const openUsages = useCallback(
    async (value: string) => {
      if (!D.aiFileIo) {
        D.setWsMsg(D.tt("先打开一个项目目录，才能查引用（当前是单个文件）"));
        return;
      }
      const dir = D.openRel ? D.openRel.split("/").slice(0, -1).join("/") : undefined;
      setUsesPanel({ title: value, hits: [], files: 0, truncated: false, loading: true });
      try {
        const res = await findUsages(D.aiFileIo, value, undefined, { firstDir: dir });
        setUsesPanel({
          title: value,
          hits: res.hits,
          files: res.files,
          truncated: res.truncated,
          loading: false,
        });
      } catch (e) {
        setUsesPanel(null);
        D.setWsMsg(D.tt("查引用失败：{msg}", { msg: e instanceof Error ? e.message : String(e) }));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openResRef = useCallback(
    async (value: string) => {
      const resolver = createResResolver(D.aiFileIo, D.openRel ?? null);
      if (!resolver) {
        // M101：改成底部 toast —— wsMsg 只在项目面板里看得到，代码面板上点了"没反应"很难受
        D.flashNote(D.tt("先打开一个项目目录，才能跳到资源定义（当前是单个文件）"));
        return;
      }
      const hit = await resolver.resolve(value);
      if (!hit) {
        D.flashNote(D.tt("项目里没找到 {value}（可能只在别的模块/依赖库里）", { value }));
        return;
      }
      const going = formatResRefHit(hit.ref, hit.rel, hit.line);
      if (D.openRel && D.openRel === hit.rel) {
        jumpToCodeLine(hit.line);
        D.flashNote(going);
        return;
      }
      const src = D.activeProjectRef.current?.source;
      if (!src) {
        D.flashNote(D.tt("找到了：{target}，但当前没有可切换的项目源", { target: going }));
        return;
      }
      const name = hit.rel.split("/").pop() || hit.rel;
      await D.loadEntry(src, { kind: "file", name, rel: hit.rel });
      jumpToCodeLine(hit.line);
      D.flashNote(going);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * M101：删除资源前的影响面 —— 复用已有的 findUsages（带预算扫描，手机上也安全）。
   * 入参是 `drawable/bg_card` 这种符号，内部拼成 `@drawable/bg_card` 去扫。
   */
  const checkDeleteImpact = useCallback(
    async (symbol: string) => {
      if (!D.aiFileIo) return null;
      const res = await findUsages(D.aiFileIo, `@${symbol}`, undefined, { maxHits: 40 });
      return {
        count: res.hits.length,
        samples: res.hits.slice(0, 3).map((h) => ({ rel: h.rel, line: h.line })),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const onGotoRef = useCallback(
    (raw: string) => {
      const t = parseRefToken(raw);
      if (!t) {
        // M209：不是资源引用 → 当「本文件内符号」处理：Ctrl+点击跳到声明行
        if (isJavaLikePath(D.openRel || "")) {
          const name = raw.replace(/^\.+|\.+$/g, "").split(".").pop() || "";
          const isKt = /\.kts?$/i.test(D.openRel || "");
          const outline = parseOutline(D.xml, isKt);
          const hit = outline.find((s) => s.name === name);
          if (hit) {
            jumpToCodeLine(hit.line);
            return;
          }
        }
        D.flashNote(D.tt("这里没有可跳转的定义"));
        return;
      }
      const a = refAction(t);
      if (a.kind === "none") {
        D.flashNote(
          a.reason === "framework" ? D.tt("@android: 内置资源，没有可跳的定义") : D.tt("这里没有可跳转的引用"),
        );
        return;
      }
      // 没打开项目目录时，静默失败让人其妙（wsMsg 在不看项目面板时看不到）→ 用底部 toast 提示
      if (!D.aiFileIo) {
        D.flashNote(D.tt("先打开一个项目目录，才能跳转 / 查引用（当前是单个文件）"));
        return;
      }
      if (a.kind === "usages") {
        void openUsages(a.refValue);
        return;
      }
      void openResRef(a.refValue);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * M209：代码编辑器悬停提示——光标落在资源引用 / 已知方法·变量上时，给一行说明。
   * 数据源：resExtras（项目 res）+ generatedDrawables（本工具生成）+ 当前文件的 Java/Kotlin 大纲。
   */
  const hoverTip = useCallback(
    (raw: string): string | null => {
      // R.id.X / R.drawable.X / @drawable/X / @string/X
      const rType = raw.match(/^R\.(\w+)\.(\w+)$/);
      const atType = raw.match(/^@(\w+)\s*\/\s*(\w+)$/);
      if (rType || atType) {
        const kind = rType ? rType[1] : atType ? atType[1] : null;
        const name = (rType ? rType[2] : atType ? atType[2] : null) || "";
        if (kind === "id") {
          const found = D.xml.search(new RegExp(`<[^>]*android:id="@\\+?id/"?${name}"?`, "g"));
          if (found >= 0) {
            const ln = D.xml.slice(0, found).split("\n").length;
            return `R.id.${name} · layout L${ln}`;
          }
        }
        // drawable / string 等资源
        if (D.resExtras || D.generatedDrawables[name]) {
          const where = kind === "drawable" || kind === "mipmap" ? "res/drawable" : `res/values/${kind}s`;
          return D.tt("资源 {name}（{where}）", { name, where });
        }
        return `R.${kind}.${name}`;
      }
      // 裸标识符：查当前文件的 Java/Kotlin 大纲（类 / 方法）
      if (isJavaLikePath(D.openRel || "")) {
        const isKt = /\.kts?$/i.test(D.openRel || "");
        const outline = parseOutline(D.xml, isKt);
        const hit = outline.find((s) => s.name === raw);
        if (hit) {
          return D.tt("{kind} {name} · L{line}", {
            kind: hit.kind === "class" ? D.tt("类") : D.tt("方法"),
            name: hit.name,
            line: String(hit.line),
          });
        }
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /**
   * M180：重命名资源文件 → 同步改全项目对它的 @type/name 引用（布局/values/drawable 互引/Java）。
   * 改名本身由调用方（项目树）完成，这里只负责文本替换 + 写回。
   */
  const onRenameResource = useCallback(
    async (oldRel: string, newName: string) => {
      if (!D.aiFileIo || !D.aiFileIo.canWrite) {
        return { ok: false, msg: D.tt("当前环境不能写文件，只改了文件名，引用没同步") };
      }
      const m = /^(.*)\/res\/(\S+)\/.+/i.exec(oldRel);
      if (!m) {
        return { ok: false, msg: D.tt("这个名字不在 res/ 下，没敢自动改引用") };
      }
      const subDir = m[2].toLowerCase();
      const kind: "ref" | "values" = subDir.startsWith("values") ? "values" : "ref";
      const resType =
        kind === "values"
          ? singularResType(
              (oldRel.split("/").pop() || "strings.xml").replace(/\.xml$/, "").replace(/-.*$/, ""),
            )
          : subDir.split("-")[0];

      const oldName = oldRel.split("/").pop()!.replace(/\.[^.]+$/, "");
      let files = 0;
      let refs = 0;
      let budget = 260;
      // 扫项目里的 xml + java/kt（预算 260 个文件，超出停止）
      const scanDir = async (dir: string, depth: number): Promise<void> => {
        if (depth > 8 || budget <= 0) return;
        let items: AiFileEntry[] = [];
        try {
          const r = await D.aiFileIo!.list(dir);
          items = r.ok && r.items ? r.items : [];
        } catch {
          return;
        }
        for (const it of items) {
          if (budget <= 0) return;
          const p = `${dir}/${it.name}`;
          if (it.kind === "dir") {
            await scanDir(p, depth + 1);
            continue;
          }
          if (!/\.(xml|java|kt)$/i.test(it.name)) continue;
          const rd = await D.aiFileIo!.read(p);
          if (!rd.ok || typeof rd.text !== "string" || !rd.text) continue;
          const inValues = /\/res\/values/.test(p);
          const r2 = renameResRef(rd.text, inValues ? "values" : "ref", resType, oldName, newName);
          if (r2.n > 0) {
            const w = await D.aiFileIo!.write(p, r2.text);
            if (w.ok) {
              files++;
              refs += r2.n;
            }
          }
          budget--;
        }
      };
      await scanDir("", 0);
      // 当前编辑器里打开的布局如果也引用了 → 一并改（未保存内容）
      if (kind === "ref" && D.xml.includes(`@${resType}/${oldName}`)) {
        const esc = oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const fixed = D.xml.replace(new RegExp(`@${resType}/${esc}(?![A-Za-z0-9_])`, "g"), `@${resType}/${newName}`);
        if (fixed !== D.xml) D.setXmlAndTrack(fixed);
      }
      return {
        ok: true,
        msg:
          refs > 0
            ? D.tt("已同步 {n} 处引用（{f} 个文件）", { n: String(refs), f: String(files) })
            : D.tt("项目里没找到对「{name}」的引用", { name: oldName }),
      };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  return {
    focusLine,
    focusTick,
    setFocusLine,
    setFocusTick,
    usesPanel,
    setUsesPanel,
    gotoLine,
    jumpToCodeLine,
    openUsages,
    openResRef,
    checkDeleteImpact,
    onGotoRef,
    hoverTip,
    onRenameResource,
  };
}
