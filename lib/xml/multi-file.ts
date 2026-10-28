// lib/xml/multi-file.ts
// 多文件项目：一个「项目」= 一组布局文件（每个都是一个 .xml），同一时刻只有一个在编辑。
// 纯函数 + 纯数据结构，UI 只管调用；持久化交给调用方（localStorage）。
//
// 为什么要这个：之前整个编辑器只有「一份 xml」，打开第二个文件就把第一个冲掉了。
// 现在每个文件独立保存内容，切换回来还在，并且撤销栈跟着文件走。

export interface ProjectFile {
  id: string;
  /** 文件名（含 .xml），如 activity_login.xml */
  name: string;
  xml: string;
  /** 最近修改时间（ms），用于按时间排序展示 */
  updatedAt: number;
}

export interface Project {
  name: string;
  files: ProjectFile[];
  activeId: string;
}

export const MAX_FILES = 30;

/** 生成一个不冲突的文件 id */
export function nextFileId(files: ProjectFile[]): string {
  let n = files.length + 1;
  const used = new Set(files.map((f) => f.id));
  while (used.has(`f${n}`)) n += 1;
  return `f${n}`;
}

/** 文件名规整：去路径、去非法字符、补 .xml */
export function normalizeFileName(raw: string): string {
  const base = raw.trim().split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[<>:"|?*\x00-\x1f]/g, "").replace(/\s+/g, "_");
  if (!cleaned) return "layout.xml";
  return /\.xml$/i.test(cleaned) ? cleaned : `${cleaned}.xml`;
}

/** 同名时追加 _2 / _3 … */
export function uniqueFileName(name: string, files: ProjectFile[], exceptId?: string): string {
  const taken = new Set(
    files.filter((f) => f.id !== exceptId).map((f) => f.name.toLowerCase()),
  );
  if (!taken.has(name.toLowerCase())) return name;
  const stem = name.replace(/\.xml$/i, "");
  let n = 2;
  while (taken.has(`${stem}_${n}.xml`.toLowerCase())) n += 1;
  return `${stem}_${n}.xml`;
}

/** 从一份 xml 猜文件名：RootTag + 语义化后缀 */
export function guessFileName(xml: string): string {
  const m = xml.match(/<([A-Za-z][\w.]*)[\s/>]/);
  const tag = m ? m[1].split(".").pop()! : "Layout";
  const snake = tag.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  return `${snake}.xml`;
}

export function createProject(name: string, first: { name: string; xml: string }): Project {
  const id = "f1";
  return {
    name: name.trim() || "未命名项目",
    files: [{ id, name: normalizeFileName(first.name), xml: first.xml, updatedAt: Date.now() }],
    activeId: id,
  };
}

export function activeFile(p: Project): ProjectFile | undefined {
  return p.files.find((f) => f.id === p.activeId) ?? p.files[0];
}

/** 写入某个文件的内容（不动其它文件） */
export function updateFileXml(p: Project, id: string, xml: string, now = Date.now()): Project {
  if (!p.files.some((f) => f.id === id)) return p;
  const cur = p.files.find((f) => f.id === id)!;
  if (cur.xml === xml) return p; // 没变就不产生新对象（避免无谓重渲染）
  return {
    ...p,
    files: p.files.map((f) => (f.id === id ? { ...f, xml, updatedAt: now } : f)),
  };
}

/** 新增文件并切换过去；超过 MAX_FILES 返回原项目 */
export function addFile(
  p: Project,
  name: string,
  xml: string,
  now = Date.now(),
): { project: Project; id: string | null } {
  if (p.files.length >= MAX_FILES) return { project: p, id: null };
  const id = nextFileId(p.files);
  const file: ProjectFile = {
    id,
    name: uniqueFileName(normalizeFileName(name), p.files),
    xml,
    updatedAt: now,
  };
  return { project: { ...p, files: [...p.files, file], activeId: id }, id };
}

/** 改名（自动去重 + 规整） */
export function renameFile(p: Project, id: string, rawName: string): Project {
  const target = p.files.find((f) => f.id === id);
  if (!target) return p;
  const name = uniqueFileName(normalizeFileName(rawName), p.files, id);
  if (name === target.name) return p;
  return { ...p, files: p.files.map((f) => (f.id === id ? { ...f, name } : f)) };
}

/**
 * 删除文件。剩最后一个时不允许删（编辑器必须有内容可显示）。
 * 删的是当前文件时，自动切到相邻文件。
 */
export function removeFile(p: Project, id: string): Project {
  if (p.files.length <= 1) return p;
  const idx = p.files.findIndex((f) => f.id === id);
  if (idx < 0) return p;
  const files = p.files.filter((f) => f.id !== id);
  const activeId = p.activeId === id ? files[Math.min(idx, files.length - 1)].id : p.activeId;
  return { ...p, files, activeId };
}

export function switchFile(p: Project, id: string): Project {
  if (!p.files.some((f) => f.id === id) || p.activeId === id) return p;
  return { ...p, activeId: id };
}

/** 项目 → 可持久化的 JSON（体积护栏由调用方控制） */
export function serializeProject(p: Project): string {
  return JSON.stringify(p);
}

/** 反序列化：字段缺失/损坏时返回 null，由调用方回落到单文件模式 */
export function parseProject(raw: string | null | undefined): Project | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== "object") return null;
    const files = Array.isArray(v.files) ? v.files : [];
    const clean: ProjectFile[] = [];
    for (const f of files) {
      if (!f || typeof f !== "object") continue;
      if (typeof f.id !== "string" || typeof f.name !== "string" || typeof f.xml !== "string") continue;
      clean.push({
        id: f.id,
        name: normalizeFileName(f.name),
        xml: f.xml,
        updatedAt: typeof f.updatedAt === "number" ? f.updatedAt : 0,
      });
    }
    if (clean.length === 0) return null;
    const activeId = clean.some((f) => f.id === v.activeId) ? v.activeId : clean[0].id;
    return { name: typeof v.name === "string" && v.name.trim() ? v.name : "未命名项目", files: clean, activeId };
  } catch {
    return null;
  }
}
