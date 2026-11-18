import { useCallback, useState, type Dispatch, type SetStateAction, type MutableRefObject } from "react";
import {
  activeFile,
  addFile,
  updateFileXml,
  switchFile,
  MAX_FILES,
  type Project,
  type ProjectFile,
} from "@/lib/xml/multi-file";
import { diffHistoryInit, type DiffHistory } from "@/lib/xml/history";
import {
  NEW_FILE_CATEGORIES,
  findCategory,
  findTemplate,
  renderTemplate,
  companionLayoutName,
  LAYOUT_BLANK_LL_EXPORT,
  type NewFileCategory,
} from "@/lib/xml/new-file";

/**
 * M336b：新建文件两步对话框（M294）从 XmlEditor 抽出。
 * 拥有 8 个对话框 state + 全部 handler，返回 { openNewFileMenu, newFile, dialogJsx }。
 * 传入的 deps 是主组件需要共享的 state/工具，避免复制业务逻辑。
 */
export interface NewFileDialogDeps {
  tt: (s: string, vars?: Record<string, string | number>) => string;
  project: Project;
  setProject: Dispatch<SetStateAction<Project>>;
  xml: string;
  flushTextTimer: () => void;
  applyExternalState: (f: ProjectFile | undefined) => void;
  setXml: (s: string) => void;
  histRef: MutableRefObject<DiffHistory | null>;
  syncHist: () => void;
  setSelectedPath: (p: string | null) => void;
  setExportNote: (s: string) => void;
}

export function useNewFileDialog(deps: NewFileDialogDeps) {
  const {
    tt, project, setProject, xml, flushTextTimer,
    applyExternalState, setXml, histRef, syncHist, setSelectedPath, setExportNote,
  } = deps;

  /** M294：新建文件两步交互：一级分类菜单 → 二级精简对话框 */
  const [newFileOpen, setNewFileOpen] = useState(false);
  const [newStep, setNewStep] = useState<1 | 2>(1);
  const [newCat, setNewCat] = useState("layout");
  const [newName, setNewName] = useState("activity_main.xml");
  const [newPath, setNewPath] = useState("res/layout/");
  const [newTpl, setNewTpl] = useState("layout-cl");
  const [newCompanion, setNewCompanion] = useState(false);
  const [newOpenAfter, setNewOpenAfter] = useState(true);

  const openNewFileMenu = useCallback(() => {
    setNewFileOpen(true);
    setNewStep(1);
  }, []);

  /** M404：工具栏「＋」菜单直达：预选分类+模板，跳过一级分类菜单直接进二级对话框 */
  const openNewFilePreset = useCallback((catKey: string, tplKey?: string) => {
    const cat = findCategory(catKey);
    if (!cat) return;
    const tpl = (tplKey ? cat.templates.find((x) => x.key === tplKey) : undefined) ?? cat.templates[0];
    setNewCat(cat.key);
    setNewTpl(tpl?.key ?? "");
    setNewPath(cat.defaultPath);
    setNewName(tpl ? guessDefaultFileName(cat.key, tpl.ext) : "");
    setNewCompanion(false);
    setNewFileOpen(true);
    setNewStep(2);
  }, []);

  const closeNewFile = useCallback(() => {
    setNewFileOpen(false);
  }, []);

  const pickNewCat = useCallback((cat: NewFileCategory) => {
    setNewCat(cat.key);
    const tpl = cat.templates[0];
    setNewTpl(tpl?.key ?? "");
    setNewPath(cat.defaultPath);
    setNewName(tpl ? `${guessDefaultFileName(cat.key, tpl.ext)}` : "");
    setNewCompanion(false);
    setNewStep(2);
  }, []);

  const onNewCatChange = useCallback((key: string) => {
    const cat = findCategory(key);
    if (!cat) return;
    setNewCat(key);
    const tpl = cat.templates[0];
    setNewTpl(tpl?.key ?? "");
    setNewPath(cat.defaultPath);
    setNewName(tpl ? guessDefaultFileName(key, tpl.ext) : "");
    setNewCompanion(false);
  }, []);

  const onNewTplChange = useCallback((key: string) => {
    setNewTpl(key);
    const ft = findTemplate(newCat, key);
    setNewCompanion(!!ft?.tpl.companion);
    // 如果模板扩展名与当前文件名不同，同步文件名
    if (ft?.tpl && ft.tpl.ext) {
      const base = newName.replace(/\.[^.]+$/, "");
      if (base) setNewName(`${base}${ft.tpl.ext}`);
    }
  }, [newCat, newName]);

  const createNewFile = useCallback(() => {
    const ft = findTemplate(newCat, newTpl);
    if (!ft) {
      closeNewFile();
      return;
    }
    const { cat, tpl } = ft;
    const name = newName.trim() || `new${tpl.ext}`;
    const rel = (newPath.trim() + name).replace(/\\/g, "/");
    const content = renderTemplate(tpl.body, name);
    flushTextTimer();
    setProject((p) => {
      const withSaved = updateFileXml(p, p.activeId, xml);
      const { project: next, id } = addFile(withSaved, name, content);
      if (!id) {
        setExportNote(tt("最多 {n} 个文件，新建失败", { n: MAX_FILES }));
        window.setTimeout(() => setExportNote(""), 3600);
        return withSaved;
      }
      // 带路径的元数据：以后保存/打开都按这个相对位置走
      const withExt = {
        ...next,
        files: next.files.map((f) =>
          f.id === id ? { ...f, ext: { rel, sourceId: cat.key } } : f,
        ),
      };
      if (newCompanion && tpl.companion) {
        const layoutName = companionLayoutName(name);
        const layoutContent = LAYOUT_BLANK_LL_EXPORT;
        const r2 = addFile(withExt, layoutName, layoutContent);
        if (r2.id) {
          const withLayoutExt = {
            ...r2.project,
            files: r2.project.files.map((f) =>
              f.id === r2.id ? { ...f, ext: { rel: `res/layout/${layoutName}`, sourceId: "layout" } } : f,
            ),
          };
          return newOpenAfter ? switchFile(withLayoutExt, id) : withLayoutExt;
        }
      }
      return newOpenAfter ? switchFile(withExt, id) : withExt;
    });
    // 切到新 tab
    const target = activeFile({ ...project, files: project.files });
    // 直接用刚加进来的 id 不可靠，这里通过 name 找（刚加进 state 的下一帧会同步）
    // 简单处理：设 xml 为新文件内容（如果 newOpenAfter）
    if (newOpenAfter) {
      setXml(content);
      histRef.current = diffHistoryInit(content);
      syncHist();
      setSelectedPath(null);
      applyExternalState({ id: "", name, xml: content, updatedAt: Date.now(), ext: { rel, sourceId: cat.key } });
    }
    setExportNote(tt("已新建「{name}」", { name }));
    window.setTimeout(() => setExportNote(""), 2400);
    closeNewFile();
  }, [
    newCat, newTpl, newName, newPath, newCompanion, newOpenAfter,
    flushTextTimer, xml, project, applyExternalState, closeNewFile,
    setProject, setXml, histRef, syncHist, setSelectedPath, setExportNote,
  ]);

  /** M295：新建文件对话框默认文件名（按分类 + 扩展名） */
  function guessDefaultFileName(catKey: string, ext: string): string {
    switch (catKey) {
      case "java": return "NewClass" + ext;
      case "kotlin": return "NewClass" + ext;
      case "layout": return "activity_main" + ext;
      case "drawable": return "new_drawable" + ext;
      case "values": return "strings" + ext;
      default: return "new" + ext;
    }
  }

  /** 原来的简单新建（保留给旧调用） */
  const newFile = useCallback(() => {
    openNewFileMenu();
  }, [openNewFileMenu]);

  const dialogJsx = newFileOpen ? (
    <div className="axv-newfile-overlay" onClick={closeNewFile}>
      <div className="axv-newfile-panel" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {newStep === 1 ? (
          <>
            <div className="axv-newfile-title">{tt("新建文件")}</div>
            <div className="axv-newfile-list">
              {NEW_FILE_CATEGORIES.map((c) => (
                <button key={c.key} type="button" className="axv-newfile-cat" onClick={() => pickNewCat(c)}>
                  <span className="msr" aria-hidden="true" style={{ fontSize: 20 }}>{c.icon}</span>
                  {c.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="axv-newfile-title">
              <button type="button" className="axv-newfile-back" onClick={() => setNewStep(1)} aria-label={tt("返回")}>←</button>
              {tt("新建文件：{cat}", { cat: findCategory(newCat)?.label || "" })}
            </div>
            <label className="axv-newfile-field">
              <span>{tt("文件名称")}</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <label className="axv-newfile-field">
              <span>{tt("保存路径")}</span>
              <input value={newPath} onChange={(e) => setNewPath(e.target.value)} />
            </label>
            <label className="axv-newfile-field">
              <span>{tt("模板")}</span>
              <select value={newTpl} onChange={(e) => onNewTplChange(e.target.value)}>
                {findCategory(newCat)?.templates.map((t) => (
                  <option key={t.key} value={t.key}>{t.label}</option>
                ))}
              </select>
            </label>
            {findTemplate(newCat, newTpl)?.tpl.companion && (
              <label className="axv-newfile-check">
                <input type="checkbox" checked={newCompanion} onChange={(e) => setNewCompanion(e.target.checked)} />
                {tt("同时创建配套布局")}
              </label>
            )}
            <label className="axv-newfile-check">
              <input type="checkbox" checked={newOpenAfter} onChange={(e) => setNewOpenAfter(e.target.checked)} />
              {tt("创建后打开文件")}
            </label>
            <div className="axv-newfile-actions">
              <button type="button" className="axv-newfile-btn" onClick={closeNewFile}>{tt("取消")}</button>
              <button type="button" className="axv-newfile-btn primary" onClick={createNewFile}>{tt("创建")}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ) : null;

  return { openNewFileMenu, openNewFilePreset, newFile, dialogJsx, newFileOpen, closeNewFile };
}
