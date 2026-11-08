// components/ResourcePanel.tsx — M183 统一「资源」面板（左栏 assets 视图）
//
// 5 个 tab：
//   草稿  = 内存里生成但没写盘的 drawable（原已生成资源）
//   图标  = 项目 mipmap*/drawable* 文件，点 → 图片预览 / vector→图标编辑器 / 其余 xml→drawable 编辑器
//   文本  = res/values*/ 的 string/arrays，按资源名跨限定符聚合（消除"八百条重复"）
//   颜色  = color 类型，聚合 + 色块预览
//   其他  = dimen/integer/bool + raw/menu/font 文件
// 选中条目都能「就地改值」（写回原文件）或「双击打开源文件」（跳代码编辑器定位）。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t } from "@/lib/i18n-src";
import {
  groupValuesByResource,
  primaryVariant,
  resolveColorCss,
  splitGroupsByTab,
  valuePreview,
  type ResTab,
  type ValueGroup,
} from "@/lib/xml/resource-panel";
import {
  setItemValue,
  type ValueItem,
} from "@/lib/xml/values-edit";
import {
  IMAGE_EXT_RE,
  readEntryImageUrl,
  type BrowseEntry,
  type ProjectSource,
} from "@/lib/xml/project-browse";
import type { AiFileIo } from "@/lib/xml/ai-tools";
import { vectorToDataUrl } from "@/lib/xml/vector-svg";

export interface ResourcePanelProps {
  /** 项目文件源（扫描用；没有就只显示草稿 tab） */
  source?: ProjectSource | null;
  /** 写回 values 文件用（读+写）；没有就只读 */
  aiFileIo: AiFileIo | null;
  /** 已生成资源：名字 → xml（草稿 tab 数据） */
  assets: Record<string, string>;
  onNewIcon: () => void;
  onNewDrawable: () => void;
  onEditIcon(name: string, xml: string): void;
  onEditShape(name: string, xml: string): void;
  /** 双击条目 → 跳代码编辑器（带行号定位） */
  onOpenFile(rel: string, line?: number): void;
  /** 点图片资源 → 预览弹窗 */
  onPreview(rel: string, url: string, name: string): void;
  onNote(text: string): void;
}

const FILE_CAP = 40;
const ITEM_CAP = 900;
const RES_DIR_DEPTH_CAP = 6;

/** 密度目录优先级：自适应图标 xml > 高密度位图 */
const DENSITY_RANK: Record<string, number> = {
  ldpi: 1,
  mdpi: 2,
  hdpi: 3,
  xhdpi: 4,
  xxhdpi: 5,
  xxxhdpi: 6,
  nodpi: 7,
  anydpi: 8,
};

/** 同名资源跨密度去重：留最高优先的那份，并记一份数量 */
function dedupeIcons(list: BrowseEntry[]): Array<{ entry: BrowseEntry; copies: number }> {
  const best = new Map<string, { entry: BrowseEntry; score: number; copies: number }>();
  for (const e of list) {
    const base = (e.name || "").replace(/\.(png|webp|jpe?g|gif|bmp|xml)$/i, "");
    const dir = (e.rel || "").split("/").slice(-2, -1)[0] || "";
    const m = /[-_](\w+)$/.exec(dir);
    const dens = m ? DENSITY_RANK[m[1].toLowerCase()] ?? 0 : 0;
    const isAdaptive = /\.xml$/i.test(e.name || "") ? 1 : 0;
    const score = isAdaptive * 100 + dens;
    const cur = best.get(base);
    if (!cur) best.set(base, { entry: e, score, copies: 1 });
    else {
      cur.copies += 1;
      if (score > cur.score) {
        cur.score = score;
        cur.entry = e;
      }
    }
  }
  return [...best.values()].map((x) => ({ entry: x.entry, copies: x.copies }));
}

const RES_TABS: Array<{ key: ResTab; label: string; hint: string }> = [
  { key: "draft", label: t("草稿"), hint: t("还没写进项目的资源") },
  { key: "icon", label: t("图标"), hint: t("mipmap 与 drawable") },
  { key: "text", label: t("文本"), hint: t("字符串与数组") },
  { key: "color", label: t("颜色"), hint: t("颜色值") },
  { key: "other", label: t("其他"), hint: t("尺寸 数字 布尔") },
];

/** res 目录归类：values 系 → 文本/颜色/其他，drawable/mipmap → 图标，其余 raw/menu/font/xml → 其他 */
function resDirOf(rel: string): string {
  const segs = rel.split("/");
  const i = segs.indexOf("res");
  return i >= 0 ? segs[i + 1] || "" : "";
}

/** 真实缩略图：图片读原图，vector xml 现场转 svg data url，其余给占位图标 */
function IconThumb({ entry, source }: { entry: BrowseEntry; source: ProjectSource | null }) {
  const [url, setUrl] = useState<string | null>(null);
  const name = entry.name || "";
  useEffect(() => {
    let dead = false;
    (async () => {
      let u: string | null = null;
      try {
        if (IMAGE_EXT_RE.test(name)) {
          u = await readEntryImageUrl(entry);
        } else if (/\.xml$/i.test(name) && source && entry.rel) {
          const xml = await source.readText(entry.rel);
          if (xml) u = vectorToDataUrl(xml);
        }
      } catch {
        u = null;
      }
      if (!dead) setUrl(u);
    })();
    return () => {
      dead = true;
    };
  }, [entry, name, source]);
  if (url) return <img className="axv-rp-thumb" src={url} alt="" />;
  return (
    <span className="msr axv-rp-thumb axv-rp-thumb-ph" aria-hidden="true">
      {IMAGE_EXT_RE.test(name) ? "image" : "code"}
    </span>
  );
}

/** 值条目：可就地改（双击值）、双击整行打开源文件 */
function ValueRow({
  g,
  onPatch,
  onOpenFile,
  colorMap,
}: {
  g: ValueGroup;
  onPatch(rel: string, item: ValueItem, v: string): void;
  onOpenFile(rel: string, line?: number): void;
  colorMap?: Map<string, string> | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  /** M183c：编辑/跳转都走「默认限定符」那份（values/ 优先），而不是扫描顺序第一个 */
  const primary = primaryVariant(g);
  const first = primary;
  const raw = first?.items[0]?.item.value ?? "";
  const pv = valuePreview(raw);
  const swatch = resolveColorCss(raw, colorMap) ?? pv.color ?? null;
  const startEdit = () => {
    setDraft(first?.items[0]?.item.value ?? "");
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const cur = first?.items[0]?.item.value ?? "";
    if (draft === cur) return;
    if (!first || !first.items[0]) return; // i18n-ignore
    onPatch(first.rel, first.items[0].item, draft);
  };
  return (
    <div
      className="axv-rp-row"
      onDoubleClick={() => {
        if (!first?.items[0]) return;
        onOpenFile(first.rel, first.items[0].line);
      }}
      title={g.variants.length > 1 ? g.variants.map((v) => v.rel).join("\n") : first?.rel}
    >
      <span className="axv-rp-name" title={g.name}>
        {g.name}
      </span>
      {swatch ? <span className="axv-rp-swatch" style={{ background: swatch }} aria-label={swatch} /> : null}
      {g.variants.length > 1 ? (
        <span className="axv-rp-varcount" title={t("同名的限定符副本")}>
          {g.variants.length}
        </span>
      ) : null}
      {editing ? (
        <input
          className="axv-rp-edit"
          value={draft}
          autoFocus
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
        />
      ) : (
        <span
          className="axv-rp-value"
          onDoubleClick={(e) => {
            e.stopPropagation();
            startEdit();
          }}
          title={first?.items[0]?.item.value}
        >
          {pv.text}
        </span>
      )}
    </div>
  );
}

export function ResourcePanel(props: ResourcePanelProps) {
  const { source, aiFileIo, assets, onNewIcon, onNewDrawable, onEditIcon, onEditShape, onOpenFile, onPreview, onNote } = props;

  const [tab, setTab] = useState<ResTab>("draft");
  const [q, setQ] = useState("");
  const [iconFiles, setIconFiles] = useState<BrowseEntry[]>([]);
  const [otherFiles, setOtherFiles] = useState<BrowseEntry[]>([]);
  const [valuesGroups, setValuesGroups] = useState<ValueGroup[]>([]);
  const [scanned, setScanned] = useState(false);

  /** rel → 原文（就地改值时缓存，改完写回） */
  const valuesCacheRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    if (!source) {
      setIconFiles([]);
      setOtherFiles([]);
      setValuesGroups([]);
      setScanned(false);
      return;
    }
    let dead = false;
    const icons: BrowseEntry[] = [];
    const others: BrowseEntry[] = [];
    const valuesFiles: string[] = [];
    // M183c：同一 rel 只收一次（旧版 BFS 会把 values 文件推两遍）
    const seenValues = new Set<string>();
    const seenIcons = new Set<string>();
    const seenOthers = new Set<string>();
    const addValues = (rel: string) => {
      if (seenValues.has(rel) || valuesFiles.length >= FILE_CAP) return;
      const base = rel.split("/").pop() || "";
      // 本工具导出的合并文件（res.zip / 资源包里的 values/res_values.xml）不进面板
      if (base.toLowerCase() === "res_values.xml") return;
      seenValues.add(rel);
      valuesFiles.push(rel);
    };
    const addIcon = (e: BrowseEntry) => {
      if (!e.rel || seenIcons.has(e.rel)) return;
      seenIcons.add(e.rel);
      icons.push(e);
    };
    const addOther = (e: BrowseEntry) => {
      if (!e.rel || seenOthers.has(e.rel)) return;
      seenOthers.add(e.rel);
      others.push(e);
    };
    (async () => {
      try {
        // 从项目根 BFS 找所有 res 目录（app/src/main/res 常见，test/ 下也可能有）
        const queue: Array<{ rel: string; depth: number }> = [{ rel: "", depth: 0 }];
        while (queue.length > 0 && !dead) {
          const cur = queue.shift()!;
          const kids = await source.listChildren(cur.rel);
          for (const k of kids) {
            if (dead) break;
            if (k.kind !== "dir") continue;
            const nm = (k.name || "").toLowerCase();
            if (nm === "res") {
              // 进入 res，逐个子目录收集
              const resKids = await source.listChildren(k.rel || "");
              for (const rk of resKids) {
                if (dead) break;
                if (rk.kind === "dir") {
                  const rd = rk.name || "";
                  const inners = await source.listChildren(rk.rel || "");
                  if (rd === "values" || rd.startsWith("values-")) {
                    for (const f of inners) {
                      if (f.kind === "file" && f.rel && /\.xml$/i.test(f.name || "")) addValues(f.rel);
                    }
                  } else if (rd.startsWith("mipmap") || rd.startsWith("drawable")) {
                    for (const f of inners) if (f.kind === "file" && f.rel) addIcon(f);
                  } else if (rd === "raw" || rd === "menu" || rd === "font" || rd === "xml") {
                    for (const f of inners) if (f.kind === "file" && f.rel) addOther(f);
                  }
                } else if (rk.kind === "file" && rk.rel) {
                  // res 下直接文件（少见）
                  if (/\.xml$/i.test((rk.name || "").toLowerCase())) addValues(rk.rel);
                }
              }
            }
            // 继续往下走（app/src/main 这种嵌套；res 本身不用再进去）
            if (nm !== "res" && cur.depth < RES_DIR_DEPTH_CAP) queue.push({ rel: k.rel || "", depth: cur.depth + 1 });
          }
        }
      } catch {
        /* 扫不动就空着，不炸 */
      }
      if (dead) return;
      const settled: Array<{ rel: string; xml: string }> = [];
      for (const rel of valuesFiles.slice(0, FILE_CAP)) {
        try {
          const t = await source.readText(rel);
          if (t !== null) settled.push({ rel, xml: t });
        } catch {
          /* skip */
        }
      }
      valuesCacheRef.current = new Map(settled.map((f) => [f.rel, f.xml]));
      setIconFiles(icons);
      setOtherFiles(others);
      setValuesGroups(groupValuesByResource(settled));
      setScanned(true);
    })();
    return () => {
      dead = true;
    };
  }, [source]);

  const { text, color, other } = useMemo(() => splitGroupsByTab(valuesGroups), [valuesGroups]);
  const textGroups = text;
  const colorGroups = color;
  const otherGroups = other;

  /** 颜色名 → 原值（@color/xxx 引用解析用） */
  const colorMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of colorGroups) {
      const v = g.variants[0]?.items[0]?.item.value;
      if (v !== undefined) m.set(g.name, v);
    }
    return m;
  }, [colorGroups]);

  /** 就地改值：改当前值（写回原文件，只替换值区间，不动注释/顺序） */
  const patchValue = useCallback(
    async (rel: string, item: ValueItem, next: string) => {
      const cache = valuesCacheRef.current.get(rel);
      if (cache === undefined || !aiFileIo) {
        onNote(t("还没加载到原文件，改不了值"));
        return;
      }
      const nextXml = setItemValue(cache, item, next);
      const wr = await aiFileIo.write(rel, nextXml);
      if (!wr.ok) {
        onNote(t("写入失败：{msg}", { msg: wr.error || "" }));
        return;
      }
      valuesCacheRef.current.set(rel, nextXml);
      setValuesGroups((gs) =>
        gs.map((g) =>
          g.name === item.name && g.kind === item.kind
            ? {
                ...g,
                variants: g.variants.map((v) =>
                  v.rel === rel
                    ? { ...v, items: v.items.map((it) => (it.item === item ? { ...it, item: { ...it.item, value: next } } : it)) }
                    : v,
                ),
              }
            : g,
        ),
      );
      onNote(t("已改 {name} → {v}", { name: item.name, v: next }));
    },
    [aiFileIo, onNote],
  );

  /** 图标文件点击路由 */
  const clickIconFile = useCallback(
    async (it: BrowseEntry) => {
      if (!it.rel) return;
      const base = (it.name || "").toLowerCase();
      if (IMAGE_EXT_RE.test(base)) {
        const url = await readEntryImageUrl(it);
        onPreview(it.rel, url ?? "", it.name || "");
        return;
      }
      if (base.endsWith(".xml") && source) {
        const xml = await source.readText(it.rel);
        if (xml !== null && /<vector[\s>]/.test(xml)) {
          onEditIcon(it.name || base, xml);
          return;
        }
        if (xml !== null) {
          onEditShape(it.name || base, xml);
          return;
        }
      }
      onOpenFile(it.rel);
    },
    [onEditIcon, onEditShape, onOpenFile, onPreview, source],
  );

  const filter = <T,>(arr: T[], hasName: (x: T) => string): T[] =>
    !q ? arr : arr.filter((x) => hasName(x).toLowerCase().includes(q.toLowerCase()));

  const iconList = dedupeIcons(filter(iconFiles, (f) => f.name || ""));
  const textList = filter(textGroups, (g) => g.name);
  const colorList = filter(colorGroups, (g) => g.name);
  const otherList: Array<{ kind: "file"; entry: BrowseEntry } | { kind: "group"; group: ValueGroup }> = [
    ...filter(otherFiles, (f) => f.name || "").map((f) => ({ kind: "file" as const, entry: f })),
    ...filter(otherGroups, (g) => g.name).map((g) => ({ kind: "group" as const, group: g })),
  ];

  const tabCounts: Record<ResTab, number> = {
    draft: Object.keys(assets).length,
    icon: iconList.length,
    text: textGroups.length,
    color: colorGroups.length,
    other: otherFiles.length + otherGroups.length,
  };

  const draftEntries = filter(Object.entries(assets), ([n]) => n);

  return (
    <div className="axv-rp">
      <div className="axv-rp-tabs" role="tablist" aria-label={t("资源分类")}>
        {RES_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            title={t.hint}
            className={"axv-rp-tab" + (tab === t.key ? " on" : "")}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
            {tabCounts[t.key] > 0 ? <span className="axv-rp-tab-n">{tabCounts[t.key]}</span> : null}
          </button>
        ))}
      </div>
      {tab !== "draft" ? (
        <input className="axv-rp-search" placeholder={t("搜索资源名…")} value={q} onChange={(e) => setQ(e.target.value)} />
      ) : null}

      {tab === "draft" && (
        <div className="axv-rp-draft">
          <div className="axv-rp-draft-actions">
            <button type="button" className="axv-btn axv-btn-sm" onClick={onNewIcon}>
              {t("新建图标")}
            </button>
            <button type="button" className="axv-btn axv-btn-sm axv-ghost" onClick={onNewDrawable}>
              {t("新建 drawable")}
            </button>
          </div>
          {draftEntries.length === 0 ? (
            <div className="axv-rp-empty">
              {t("草稿区空着。新建图标 / 新建 drawable 生成后会出现在这里，写进项目就自动转到对应 tab。")}
            </div>
          ) : (
            draftEntries.map(([name, xml]) => {
              const isVector = /<vector[\s>]/.test(xml);
              const u = isVector ? vectorToDataUrl(xml) : null;
              return (
                <div
                  key={name}
                  className="axv-rp-row"
                  onDoubleClick={() => {
                    if (isVector) onEditIcon(name, xml);
                    else onEditShape(name, xml);
                  }}
                  title={t("双击打开编辑器")}
                >
                  {u ? (
                    <img className="axv-rp-thumb" src={u} alt="" />
                  ) : (
                    <span className="msr axv-rp-thumb axv-rp-thumb-ph" aria-hidden="true">
                      {isVector ? "star" : "square"}
                    </span>
                  )}
                  <span className="axv-rp-name">{name}</span>
                  <span className="axv-rp-kind">{isVector ? "vector" : "shape"}</span>
                </div>
              );
            })
          )}
        </div>
      )}

      {tab === "icon" && (
        <div className="axv-rp-list">
          {iconList.length === 0 ? (
            <div className="axv-rp-empty">{scanned ? t("项目里没有 mipmap/drawable 文件") : t("先打开一个项目")}</div>
          ) : (
            iconList.slice(0, ITEM_CAP).map(({ entry: it, copies }) => (
              <button
                key={it.rel}
                type="button"
                className="axv-rp-file"
                onClick={() => void clickIconFile(it)}
                title={(it.name || "") + (copies > 1 ? ` (${copies} 份密度副本)` : "") + " · " + t("双击编辑")}
              >
                <IconThumb entry={it} source={source ?? null} />
                <span className="axv-rp-file-name">{it.name}</span>
                {copies > 1 ? <span className="axv-rp-varcount">{copies}</span> : null}
                <span className="axv-rp-file-rel">{it.rel}</span>
              </button>
            ))
          )}
        </div>
      )}

      {tab === "text" && (
        <div className="axv-rp-list">
          {textList.length === 0 ? (
            <div className="axv-rp-empty">{scanned ? t("项目里没有字符串资源") : t("先打开一个项目")}</div>
          ) : (
            textList.slice(0, ITEM_CAP).map((g) => (
              <ValueRow
                key={"t" + g.name}
                g={g}
                colorMap={colorMap}
                onPatch={(rel, item, v) => void patchValue(rel, item, v)}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}

      {tab === "color" && (
        <div className="axv-rp-list">
          {colorList.length === 0 ? (
            <div className="axv-rp-empty">{scanned ? t("项目里没有颜色资源") : t("先打开一个项目")}</div>
          ) : (
            colorList.slice(0, ITEM_CAP).map((g) => (
              <ValueRow
                key={"c" + g.name}
                g={g}
                colorMap={colorMap}
                onPatch={(rel, item, v) => void patchValue(rel, item, v)}
                onOpenFile={onOpenFile}
              />
            ))
          )}
        </div>
      )}

      {tab === "other" && (
        <div className="axv-rp-list">
          {otherList.length === 0 ? <div className="axv-rp-empty">{t("没有其他类型资源")}</div> : otherList.slice(0, ITEM_CAP).map((o, i) => {
            if (o.kind === "file")
              return (
                <button
                  key={"f" + i}
                  type="button"
                  className="axv-rp-file"
                  onClick={() => onOpenFile(o.entry.rel!)}
                >
                  <span className="axv-rp-file-name">{o.entry.name}</span>
                  <span className="axv-rp-file-rel">{o.entry.rel}</span>
                </button>
              );
            return (
              <ValueRow
                key={"g" + i}
                g={o.group}
                colorMap={colorMap}
                onPatch={(rel, item, v) => void patchValue(rel, item, v)}
                onOpenFile={onOpenFile}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
