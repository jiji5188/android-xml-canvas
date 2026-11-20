// components/use-lints.ts — M366 step11（路线 2 拆解）：代码视图结构检查（lint）域
//
// 从 XmlEditor.tsx 抽出（原 ~1174-1382 区域）：
//   lintSrc(+debounce effect) / javaResEnv / xmlResEnv / xmlResSig / lints / lintErrCount /
//   onCodeCursorLine / doFixOne
// 留壳的（编辑核心 A）：doFormat / doFixAll（它们夹在中间，且依赖 flushXml/editorTheme 等 A 域）
//
// deps-getter + 延迟 Proxy（与 use-xml-project-fns.ts 同款）：fromCodeRef（壳 ~2422 行）声明晚于
// 本 hook 调用点（~1174 行），渲染期不 evaluate getter，回调执行时才解引用。
// 纯 lib 函数直接 import。
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nodeAtLine } from "@/lib/xml/parser";
import type { XmlNode } from "@/lib/xml/types";
import { lintXml, type LintIssue } from "@/lib/xml/lint";
import { lintJava } from "@/lib/xml/java-lint";
import { lintCodeDoc } from "@/lib/xml/lint-doc";
import { collectResEnv, type JavaResEnv } from "@/lib/xml/java-res-env";
import { checkXmlResRefs, applyFixToLine, type XmlResEnv } from "@/lib/xml/xml-res-check";
import { checkApiTypos, formatApiIssue } from "@/lib/xml/java-api-check";
import { perfTimer } from "@/lib/xml/perf-log";
import { t as tt } from "@/lib/i18n-src";
import type { ResourceExtras } from "@/lib/xml/resdir";
import type { ProjectFile } from "@/lib/xml/multi-file";
import type { Lexicon } from "@/lib/xml/lexicon";

export interface LintsDeps {
  // E（编辑核心共享）
  xml: string;
  resExtras: ResourceExtras | null;
  parsedXml: string; // useDeferredValue(xml)
  flushXml: () => void;
  currentXml: () => string;
  setXmlAndTrackRef: React.MutableRefObject<((next: string, mergeKey?: string) => void) | null>;
  // 画布资产（C）
  generatedDrawables: Record<string, string>;
  sampleValues: string;
  // 文档类型派生（壳）
  docKind: string;
  codeOnly: boolean;
  isJavaFile: boolean;
  isKotlinLike: boolean;
  codeFileName: string;
  // 项目/文件上下文
  openRel: string | null;
  saveOrigin: { kind: string; target?: string; handle?: unknown; name: string } | null;
  currentFile: ProjectFile | undefined;
  projMethods: string[];
  lexRef: React.MutableRefObject<Lexicon | null>;
  lexRev: number;
  // 光标/画布联动
  setCodeCursor: (n: number) => void;
  treeRoot: XmlNode | null;
  selectedPath: string | null;
  setSelectedPath: (v: string | null) => void;
  fromCodeRef: React.MutableRefObject<boolean>;
  // 提示
  setExportNote: (v: string) => void;
}

export interface LintsResult {
  lintSrc: string;
  setLintSrc: React.Dispatch<React.SetStateAction<string>>;
  lints: LintIssue[];
  lintErrCount: number;
  onCodeCursorLine: (line: number) => void;
  doFixOne: (iss: LintIssue) => void;
}

export function useLints(getDeps: () => LintsDeps): LintsResult {
  // 延迟 Proxy：渲染期不 evaluate（避 fromCodeRef 等 TDZ），回调执行时才解引用
  const depsRef = useRef<LintsDeps | null>(null);
  useEffect(() => {
    depsRef.current = getDeps();
  });
  const D = useMemo(
    () =>
      new Proxy({} as LintsDeps, {
        get(_t, k: string) {
          const d = depsRef.current ?? getDeps();
          return (d as any)[k];
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const [lintSrc, setLintSrc] = useState("");
  useEffect(() => {
    // M138：非布局文件也跑校验（lint-doc 按文件类型叠领域规则），只是规则不同
    const t = window.setTimeout(() => setLintSrc(D.parsedXml), 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D.parsedXml]);

  /** M177：把工程里的布局/values/图片汇总成资源清单，供 Java 代码检查 */
  const javaResEnv = useMemo(() => {
    const layouts: Record<string, string> = { ...(D.resExtras?.layouts ?? {}) };
    const drawables = [
      ...Object.keys(D.resExtras?.drawables ?? {}),
      ...Object.keys(D.resExtras?.drawableXml ?? {}),
      ...(D.resExtras?.vectorNames ?? []),
      ...Object.keys(D.generatedDrawables ?? {}),
    ];
    // M179：示例项目/资源片段的 values 也参与渲染，检查时同源带上，否则 string/color 引用查不到真名
    const valuesText = [D.resExtras?.valuesXml ?? "", D.sampleValues].filter((x) => x.trim()).join("\n");
    return collectResEnv({
      layouts,
      currentLayoutXml: D.docKind === "layout" ? D.xml : null,
      valuesFiles: valuesText.trim() ? { "values.xml": valuesText } : undefined,
      drawables,
      // M256：全项目（含 menu/navigation）扫到的 @+id 并入，防 R.id.nav_home 误报
      extraIds: D.resExtras?.ids,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D.resExtras, D.generatedDrawables, D.docKind, D.xml, D.sampleValues]);

  /** M179：XML 资源引用检查用的清单（名字集合；某类为空时不检查该类） */
  const xmlResEnv = useMemo(
    () => ({
      layout: javaResEnv.layout,
      drawable: javaResEnv.drawable,
      mipmap: javaResEnv.mipmap,
      string: javaResEnv.string,
      color: javaResEnv.color,
      dimen: javaResEnv.dimen,
      style: javaResEnv.style,
      id: javaResEnv.ids,
    }),
    [javaResEnv],
  );

  /** 资源清单的指纹：只有名字真变了才重跑 lint（打字时不变，保住 M57 的 debounce） */
  const xmlResSig = useMemo(
    () =>
      [
        xmlResEnv.layout,
        xmlResEnv.drawable,
        xmlResEnv.mipmap,
        xmlResEnv.string,
        xmlResEnv.color,
        xmlResEnv.dimen,
        xmlResEnv.style,
        xmlResEnv.id,
      ]
        .map((xs) => (xs ?? []).join(","))
        .join("|"),
    [xmlResEnv],
  );

  /** 代码视图的结构检查（带行号，标红用） */
  const lints = useMemo(() => {
    try {
      if (lintSrc === "") return [] as LintIssue[];
      const t = perfTimer("xml.lint", "len=" + lintSrc.length);
      // M142：.java / .kt 是 Java 语法，不能拿 XML 规则跑（`if (a<1) {` 里的 `<1` 会被当成标签 → 误报「未闭合」）
      let out: LintIssue[];
      if (D.isJavaFile) {
        out = lintJava(lintSrc, {
          isKotlin: D.isKotlinLike,
          // M177：把项目里真实存在的资源喂进去，R.id / R.layout / findViewById 类型才能真校验
          ids: javaResEnv.ids,
          res: {
            layout: javaResEnv.layout,
            string: javaResEnv.string,
            drawable: javaResEnv.drawable,
            color: javaResEnv.color,
            dimen: javaResEnv.dimen,
            mipmap: javaResEnv.mipmap,
            style: javaResEnv.style,
          },
          idTag: javaResEnv.idTag,
          // M351：项目里其它文件声明过的方法名（getTitle 这种自己的方法不能被当成拼写错）
          knownMethods: D.projMethods,
          // M454：SDK 真方法（getItemAtPosition 等 17k 个）不算拼写错，否则会被配成另一个真方法误报
          sdkMethods: D.lexRef.current?.allMethodNames,
          // M352：项目词库里的类名（同包类/项目类）—— 用了但不 import 不该报「缺 import」/「未知符号」
          allowNames: (D.lexRef.current ? [...D.lexRef.current.classes.values()].map((c) => c.name) : []),
        }).map((j: any) => ({
          line: j.line,
          level: j.sev,
          message: j.msg,
          // M202：带列号/长度，编辑器能画精确范围的波浪下划线（像 AIDE 那样圈住出问题的这一段）
          ...(j.col !== undefined ? { col: j.col } : {}),
          ...(j.len !== undefined ? { len: j.len } : {}),
          // M179：能自动修复的带上 from/to，编辑器给「一键修复」
          ...(j.fix ? { fix: { from: j.fix.from, to: j.fix.to, label: `${j.fix.from} → ${j.fix.to}` } } : {}),
          // M207：带上机器可读 code，问题卡片能显示「为什么报 / 怎么改」
          code: j.code,
        }));
        // M178：控件方法名拼写错误（setTxt → setText），只报编辑距离 1 的
        for (const a of checkApiTypos(lintSrc)) {
          out.push({ line: a.line, level: "warn", message: formatApiIssue(a), code: "method" });
        }
      } else if (D.codeOnly) {
        // M138：非布局文件走 lint-doc（结构 + 清单/values/drawable 等类型规则）
        out = lintCodeDoc(lintSrc, D.openRel || D.saveOrigin?.name || D.currentFile?.name || "");
        // M179：drawable / menu / values / 清单 里也会引用资源，名字拼错一样给提示
        out.push(...checkXmlResRefs(lintSrc, xmlResEnv));
      } else {
        out = lintXml(lintSrc);
        // M179：布局里的 @drawable/ @string/ @color/ … 引用，拼错且能猜出来 → 带 fix
        out.push(...checkXmlResRefs(lintSrc, xmlResEnv));
      }
      // M179：资源引用的问题按行号排进去（排序稳定，错误条取第一条才合理）
      out.sort((a, b) => a.line - b.line);
      t.end("issues=" + out.length);
      return out;
    } catch (e) {
      console.error("[axv] 结构检查失败", e); // i18n-ignore
      return [] as LintIssue[];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lintSrc, D.codeOnly, D.isJavaFile, D.isKotlinLike, D.codeFileName, D.openRel, D.saveOrigin?.name, D.currentFile?.name, xmlResSig, D.projMethods, D.lexRev]);

  /** M22：能渲染但有结构错误时，画布上给一条可跳转的提示（不阻断预览） */
  const lintErrCount = useMemo(() => {
    try {
      return lints.filter((l) => l.level === "error").length;
    } catch {
      return 0;
    }
  }, [lints]);

  /** M2y：代码编辑器光标行 → 选中对应画布节点（反跳，和画布 → 行号正跳对称） */
  const onCodeCursorLine = useCallback(
    (line: number) => {
      if (line > 0) D.setCodeCursor(line);
      if (!D.treeRoot || line < 1) return;
      const n = nodeAtLine(D.treeRoot, line);
      if (n && n.path !== D.selectedPath) {
        D.fromCodeRef.current = true; // 这次选中是代码触发的，不要再反向拖动编辑器
        D.setSelectedPath(n.path);
      }
    },
    [D],
  );

  /** M202：点某条问题卡片的「应用此修复」—— 只修这一条（其余等用户再点） */
  const doFixOne = useCallback(
    (iss: LintIssue) => {
      const fx = iss.fix;
      if (!fx) return;
      D.flushXml();
      const cur = D.currentXml();
      const lines = cur.split("\n");
      const idx = Math.max(0, Math.min((iss.line ?? 1) - 1, lines.length - 1));
      const L = lines[idx];
      if (L === undefined) return;
      const r = applyFixToLine(L, fx.from, fx.to);
      if (!r.count) return;
      lines[idx] = r.text;
      D.setXmlAndTrackRef.current?.(lines.join("\n"));
      D.setExportNote(tt("已修复 {n} 处（可撤销）", { n: r.count }));
      window.setTimeout(() => D.setExportNote(""), 2400);
    },
    [D],
  );

  return { lintSrc, setLintSrc, lints, lintErrCount, onCodeCursorLine, doFixOne };
}
