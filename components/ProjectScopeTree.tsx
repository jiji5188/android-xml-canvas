// components/ProjectScopeTree.tsx — M182：项目面板的「分段视图」（布局 / 资源 / 代码）
//
// 设计要点：
//   · 「全部」段仍走原来的 LazyTree（懒加载、长按菜单、拖拽都在那边，不动它）；
//   · 其余三段需要「全量扫描一次再过滤」，所以这里自己扫（上限 3000 项 / 9 层）；
//   · 资源段有二级 tab（图标 / 文本 / 颜色 / 其他），带数量角标；
//   · 文件点击走和 LazyTree 一样的分流：图片 → 预览，drawable 里的 xml → 绘制编辑器，其余 → 编辑器。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as tt } from "@/lib/i18n-src";
import type { BrowseEntry, ProjectSource } from "@/lib/xml/project-browse";
import { isIconDirRel, isImageName, readEntryImageUrl } from "@/lib/xml/project-browse";
import type { ResourceExtras } from "@/lib/xml/resdir";
import { resOpenAction } from "@/lib/xml/resource-open";
import {
  countByKind,
  groupByDir,
  matchScope,
  shortDirLabel,
  type ProjectScope,
  type ResKind,
  type ScannedEntry,
} from "@/lib/xml/project-scope";

const MAX_SCAN = 3000;
const KIND_TABS: Array<{ k: ResKind; label: string }> = [
  { k: "icon", label: "图标" }, // i18n-ignore：作为 tt() 的 key 传入
  { k: "text", label: "文本" }, // i18n-ignore
  { k: "color", label: "颜色" }, // i18n-ignore
  { k: "other", label: "其他" }, // i18n-ignore
];

export interface ProjectScopeTreeProps {
  source: ProjectSource;
  rev: number;
  scope: ProjectScope;
  extras: ResourceExtras | null;
  currentRel?: string | null;
  onOpenEntry: (e: BrowseEntry) => void;
  onOpenDrawable: (rel: string, name: string, xml: string) => void;
  onPreviewImage: (rel: string, name: string, url: string) => void;
}

export function ProjectScopeTree(props: ProjectScopeTreeProps) {
  const { source, rev, scope, extras, currentRel, onOpenEntry, onOpenDrawable, onPreviewImage } = props;
  const [files, setFiles] = useState<ScannedEntry[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [kind, setKind] = useState<ResKind>("icon");
  /** 折叠的目录（默认全展开；只在用户手动收起时记录） */
  const [closedDirs, setClosedDirs] = useState<Set<string>>(() => new Set());

  // 只在「真的换项目 / 刷新版本变了」时重扫；source 每帧可能是新对象，不能进依赖
  const srcRef = useRef<ProjectSource | null>(null);
  const revRef = useRef(rev);
  useEffect(() => {
    const changed = srcRef.current !== source || revRef.current !== rev;
    if (!changed) return;
    srcRef.current = source;
    revRef.current = rev;
    let alive = true;
    setScanning(true);
    setFiles(null);
    void (async () => {
      const out: ScannedEntry[] = [];
      const walk = async (rel: string, depth: number): Promise<void> => {
        if (depth > 9 || out.length >= MAX_SCAN) return;
        const items = await source.listChildren(rel).catch(() => [] as BrowseEntry[]);
        for (const it of items) {
          if (out.length >= MAX_SCAN) return;
          out.push({ rel: it.rel, name: it.name, isDir: it.kind === "dir" });
          if (it.kind === "dir") await walk(it.rel, depth + 1);
        }
      };
      await walk("", 0);
      if (alive) {
        setFiles(out);
        setScanning(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [source, rev]);

  const counts = useMemo(() => (files ? countByKind(files) : { icon: 0, text: 0, color: 0, other: 0 }), [files]);
  const shown = useMemo(() => (files ? matchScope(files, scope, kind) : []), [files, scope, kind]);
  const groups = useMemo(() => groupByDir(shown), [shown]);

  const openFile = useCallback(
    async (f: ScannedEntry) => {
      const entry = { rel: f.rel, name: f.name, kind: "file" } as BrowseEntry;
      if (isImageName(f.name)) {
        const url = await readEntryImageUrl(entry);
        if (url) {
          onPreviewImage(f.rel, f.name.replace(/\.[^.]+$/, ""), url);
          return;
        }
      }
      if (isIconDirRel(f.rel)) {
        const text = await source.readText(f.rel);
        if (text) {
          const action = resOpenAction(f.rel, text, extras);
          if (action.kind === "drawable") {
            onOpenDrawable(f.rel, action.name, action.xml);
            return;
          }
          if (action.kind === "image" || action.kind === "vector") {
            onPreviewImage(f.rel, action.name, action.url);
            return;
          }
        }
      }
      onOpenEntry(entry);
    },
    [source, extras, onOpenDrawable, onPreviewImage, onOpenEntry],
  );

  const fileIcon = (name: string): string => {
    const n = name.toLowerCase();
    if (isImageName(name)) return "image";
    if (/\.(java|kt)$/.test(n)) return "code";
    if (/\.xml$/.test(n)) return "draft";
    return "description";
  };

  if (scanning || !files) {
    return <div className="axv-pb-hint">{tt("正在扫描项目文件…")}</div>;
  }

  return (
    <>
      {scope === "res" ? (
        <div className="axv-pb-kinds" role="tablist" aria-label={tt("资源")}>
          {KIND_TABS.map((it) => (
            <button
              key={it.k}
              role="tab"
              aria-selected={kind === it.k}
              className={"axv-pb-kind" + (kind === it.k ? " on" : "")}
              onClick={() => setKind(it.k)}
            >
              <span className="axv-pb-kind-label">{tt(it.label)}</span>
              <span className="axv-pb-kind-n">{counts[it.k]}</span>
            </button>
          ))}
        </div>
      ) : null}

      {shown.length === 0 ? (
        <div className="axv-pb-hint">{tt("没有匹配的文件")}</div>
      ) : (
        <ul className="axv-ws-list axv-pb-list">
          {groups.map((g) => {
            const closed = closedDirs.has(g.dir);
            return (
              <li key={g.dir || "(root)"}>
                <div className="axv-pb-dir">
                  <button
                    className="axv-pb-dir-btn"
                    onClick={() =>
                      setClosedDirs((prev) => {
                        const next = new Set(prev);
                        if (next.has(g.dir)) next.delete(g.dir);
                        else next.add(g.dir);
                        return next;
                      })
                    }
                    title={g.dir || "/"}
                  >
                    <span className={"axv-pb-caret" + (closed ? "" : " open")} aria-hidden="true">
                      <span className="msr" style={{ fontSize: 14 }}>
                        chevron_right
                      </span>
                    </span>
                    <span className="axv-pb-dir-name">{shortDirLabel(g.dir)}</span>
                    <span className="axv-pb-dir-n">{g.files.length}</span>
                  </button>
                </div>
                {closed
                  ? null
                  : g.files.map((f) => {
                      const on = currentRel === f.rel;
                      return (
                        <div className="axv-ws-row" key={f.rel} style={{ paddingLeft: 22 }}>
                          <button
                            className={"axv-ws-item" + (on ? " on" : "")}
                            onClick={() => void openFile(f)}
                            title={f.rel}
                          >
                            <span className="msr axv-ws-item-icon" aria-hidden="true">
                              {fileIcon(f.name)}
                            </span>
                            <span className="axv-ws-item-main">
                              <span className="axv-ws-item-name">{f.name}</span>
                            </span>
                          </button>
                        </div>
                      );
                    })}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
