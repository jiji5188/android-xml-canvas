// lib/i18n.ts — M23 界面多语言
//
// 只翻译「编辑器外壳」的文案（工具栏、左栏、设置面板、保存/报错提示），
// 用户自己的 XML 内容、示例项目里的中文一律不动。
// 默认 auto：跟随系统语言（navigator.languages），识别不到就用简体中文。

export type LangPref = "auto" | "zh-Hans" | "zh-Hant" | "en" | "ja";
export type LangCode = Exclude<LangPref, "auto">;

export const LS_KEY_LANG = "axv.lang";

export const LANG_OPTIONS: { value: LangPref; label: string; native: string }[] = [
  { value: "auto", label: "跟随系统", native: "系统语言" },
  { value: "zh-Hans", label: "简体中文", native: "简体中文" },
  { value: "zh-Hant", label: "繁體中文", native: "繁體中文" },
  { value: "en", label: "English", native: "English" },
  { value: "ja", label: "日本語", native: "日本語" },
];

/** 把系统语言标签映射到我们支持的几种 */
export function normalizeLang(tag: string | undefined | null): LangCode {
  const t = (tag || "").toLowerCase();
  if (t.startsWith("zh")) {
    // 繁体：zh-TW / zh-HK / zh-MO / zh-Hant
    if (/hant|tw|hk|mo/.test(t)) return "zh-Hant";
    return "zh-Hans";
  }
  if (t.startsWith("ja")) return "ja";
  if (t.startsWith("en")) return "en";
  return "zh-Hans";
}

export function systemLang(): LangCode {
  if (typeof navigator === "undefined") return "zh-Hans";
  const list = navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language];
  for (const l of list) {
    const code = normalizeLang(l);
    // 第一个能识别的就用（只有明确匹配才算）
    if (l && /^(zh|ja|en)/i.test(l)) return code;
  }
  return normalizeLang(list[0]);
}

export function resolveLang(pref: LangPref): LangCode {
  return pref === "auto" ? systemLang() : pref;
}

export function loadLangPref(): LangPref {
  if (typeof window === "undefined") return "auto";
  try {
    const v = window.localStorage.getItem(LS_KEY_LANG);
    if (v && LANG_OPTIONS.some((o) => o.value === v)) return v as LangPref;
  } catch {
    /* ignore */
  }
  return "auto";
}

export function saveLangPref(pref: LangPref): void {
  try {
    window.localStorage.setItem(LS_KEY_LANG, pref);
  } catch {
    /* ignore */
  }
}

type Dict = Record<string, string>;

const zhHans: Dict = {
  "rail.parts": "组件",
  "rail.layers": "图层",
  "rail.ai": "AI 助手",
  "rail.assets": "已生成资源",
  "rail.res": "项目管理",
  "rail.settings": "设置",
  "rail.about": "关于",
  "rail.close": "关闭面板",

  "tb.save": "保存（打开的文件写回原路径；新建文件选择保存位置）",
  "tb.open": "打开本地 XML 文件",
  "tb.format": "重排缩进（保留注释）",
  "tb.run": "运行调试",

  "set.theme": "配色方案",
  "set.themeLight": "浅色",
  "set.themeDark": "深色",
  "set.themeHint": "配色只作用于编辑器界面，不影响导出的布局。",
  "set.lang": "界面语言",
  "set.langHint": "默认跟随系统语言；切换只影响编辑器界面文字，不影响布局内容。",
  "set.workspace": "工作目录",
  "set.wsCurrent": "当前",
  "set.wsDefault": "默认",
  "set.wsChoose": "选择目录",
  "set.wsRestore": "恢复默认",
  "set.device": "渲染设备",
  "set.preview": "预览",
  "set.data": "数据",
  "set.projectRes": "项目资源",
  "set.credits": "鸣谢 / 开源组件",
  "set.shortcuts": "快捷键",
  "set.notes": "说明",

  "save.title": "保存布局",
  "save.hint":
    "下一步会让你选择保存位置（系统选择器里可以新建文件夹）。生成的形状、图标等依赖资源会一起写进 drawable/，values 写进 values/。",
  "save.fileName": "文件名",
  "save.cancel": "取消",
  "save.confirm": "选择文件夹并保存",
  "save.doneBack": "已保存 {name}（原路径）",
  "save.doneAs": "已保存到「{dir}」：{n} 个文件（含依赖资源）",
  "save.canceled": "已取消保存",
  "save.failed": "保存失败：{reason}",
  "save.backFailed": "写回原文件失败，改为另存到文件夹…",

  "err.parseTitle": "这个 XML 现在画不出来",
  "err.parseMsg": "XML 结构不完整或有语法错误",
  "err.parseHint": "先到「代码」面板修正这段内容，画布会自动恢复；改动不会丢失，也不会影响你原来的文件。",
  "err.fix": "去代码面板修正",
  "err.crashTitle": "画布渲染出错了",
  "err.crashHint":
    "这不是你操作的问题，多半是某段布局数据超出了支持范围。到「代码」面板改一下（哪怕加个空格再删掉）画布会自动重试。",
  "err.retry": "重试渲染",
  "err.empty": "还没有内容，从左边拖个控件进来开始",
};

const zhHant: Dict = {
  ...zhHans,
  "rail.parts": "元件",
  "rail.layers": "圖層",
  "rail.ai": "AI 助理",
  "rail.assets": "已生成資源",
  "rail.res": "專案管理",
  "rail.settings": "設定",
  "rail.about": "關於",
  "rail.close": "關閉面板",
  "tb.save": "儲存（開啟的檔案寫回原路徑；新建檔案選擇儲存位置）",
  "tb.open": "開啟本機 XML 檔案",
  "tb.format": "重排縮排（保留註解）",
  "tb.run": "執行偵錯",
  "set.theme": "配色方案",
  "set.themeLight": "淺色",
  "set.themeDark": "深色",
  "set.themeHint": "配色只作用於編輯器介面，不影響匯出的版面。",
  "set.lang": "介面語言",
  "set.langHint": "預設跟隨系統語言；切換只影響編輯器介面文字，不影響版面內容。",
  "set.workspace": "工作目錄",
  "set.wsCurrent": "目前",
  "set.wsDefault": "預設",
  "set.wsChoose": "選擇目錄",
  "set.wsRestore": "恢復預設",
  "set.device": "渲染裝置",
  "set.preview": "預覽",
  "set.data": "資料",
  "set.projectRes": "專案資源",
  "set.credits": "鳴謝 / 開源元件",
  "set.shortcuts": "快速鍵",
  "set.notes": "說明",
  "save.title": "儲存版面",
  "save.hint":
    "下一步會讓你選擇儲存位置（系統選擇器裡可以新增資料夾）。生成的形狀、圖示等相依資源會一起寫進 drawable/，values 寫進 values/。",
  "save.fileName": "檔案名稱",
  "save.cancel": "取消",
  "save.confirm": "選擇資料夾並儲存",
  "save.doneBack": "已儲存 {name}（原路徑）",
  "save.doneAs": "已儲存到「{dir}」：{n} 個檔案（含相依資源）",
  "save.canceled": "已取消儲存",
  "save.failed": "儲存失敗：{reason}",
  "save.backFailed": "寫回原檔案失敗，改為另存到資料夾…",
  "err.parseTitle": "這個 XML 目前畫不出來",
  "err.parseMsg": "XML 結構不完整或有語法錯誤",
  "err.parseHint": "先到「程式碼」面板修正這段內容，畫布會自動恢復；改動不會遺失，也不影響你原本的檔案。",
  "err.fix": "去程式碼面板修正",
  "err.crashTitle": "畫布渲染出錯了",
  "err.crashHint": "這不是你操作的問題，多半是某段版面資料超出支援範圍。到「程式碼」面板改一下，畫布會自動重試。",
  "err.retry": "重試渲染",
  "err.empty": "還沒有內容，從左邊拖個元件進來開始",
};

const en: Dict = {
  "rail.parts": "Widgets",
  "rail.layers": "Layers",
  "rail.ai": "AI",
  "rail.assets": "Assets",
  "rail.res": "Project",
  "rail.settings": "Settings",
  "rail.about": "About",
  "rail.close": "Close panel",

  "tb.save": "Save (opened file writes back; new file asks for a folder)",
  "tb.open": "Open a local XML file",
  "tb.format": "Re-indent (keeps comments)",
  "tb.run": "Run & debug",

  "set.theme": "Color scheme",
  "set.themeLight": "Light",
  "set.themeDark": "Dark",
  "set.themeHint": "Colors only affect the editor UI, not the exported layout.",
  "set.lang": "Interface language",
  "set.langHint": "Follows the system language by default. Only UI text changes, not your layout.",
  "set.workspace": "Workspace",
  "set.wsCurrent": "Current",
  "set.wsDefault": "Default",
  "set.wsChoose": "Choose folder",
  "set.wsRestore": "Restore default",
  "set.device": "Render device",
  "set.preview": "Preview",
  "set.data": "Data",
  "set.projectRes": "Project resources",
  "set.credits": "Credits / open source",
  "set.shortcuts": "Shortcuts",
  "set.notes": "Notes",

  "save.title": "Save layout",
  "save.hint":
    "Next you pick a folder (you can create a new one in the system picker). Generated shapes and icons are written into drawable/, values into values/.",
  "save.fileName": "File name",
  "save.cancel": "Cancel",
  "save.confirm": "Choose folder & save",
  "save.doneBack": "Saved {name} (original path)",
  "save.doneAs": "Saved to “{dir}”: {n} files (with dependencies)",
  "save.canceled": "Save canceled",
  "save.failed": "Save failed: {reason}",
  "save.backFailed": "Could not write back, switching to Save As…",

  "err.parseTitle": "This XML can't be rendered yet",
  "err.parseMsg": "The XML is incomplete or has a syntax error",
  "err.parseHint":
    "Fix it in the Code panel — the canvas recovers automatically, and nothing is lost or written to your file.",
  "err.fix": "Fix in Code panel",
  "err.crashTitle": "Canvas failed to render",
  "err.crashHint":
    "This is not your fault — some layout data exceeded what the renderer supports. Edit it in the Code panel and the canvas retries automatically.",
  "err.retry": "Retry render",
  "err.empty": "Nothing here yet — drag a widget from the left",
};

const ja: Dict = {
  ...en,
  "rail.parts": "ウィジェット",
  "rail.layers": "レイヤー",
  "rail.ai": "AI アシスタント",
  "rail.assets": "生成済みリソース",
  "rail.res": "プロジェクト",
  "rail.settings": "設定",
  "rail.about": "このアプリについて",
  "rail.close": "パネルを閉じる",
  "tb.save": "保存（開いたファイルは元の場所へ／新規は保存先を選択）",
  "tb.open": "ローカルの XML を開く",
  "tb.format": "インデント整形（コメント保持）",
  "tb.run": "実行・デバッグ",
  "set.theme": "配色",
  "set.themeLight": "ライト",
  "set.themeDark": "ダーク",
  "set.themeHint": "配色はエディタ画面のみに適用され、書き出すレイアウトには影響しません。",
  "set.lang": "表示言語",
  "set.langHint": "既定ではシステム言語に従います。切り替わるのは画面の文言だけで、レイアウトには影響しません。",
  "set.workspace": "作業ディレクトリ",
  "set.wsCurrent": "現在",
  "set.wsDefault": "既定",
  "set.wsChoose": "フォルダを選択",
  "set.wsRestore": "既定に戻す",
  "set.device": "プレビュー端末",
  "set.preview": "プレビュー",
  "set.data": "データ",
  "set.projectRes": "プロジェクトのリソース",
  "set.credits": "謝辞 / オープンソース",
  "set.shortcuts": "ショートカット",
  "set.notes": "メモ",
  "save.title": "レイアウトを保存",
  "save.hint":
    "次に保存先フォルダを選びます（システムの選択画面で新規フォルダも作成できます）。生成した図形やアイコンは drawable/、values は values/ に書き込まれます。",
  "save.fileName": "ファイル名",
  "save.cancel": "キャンセル",
  "save.confirm": "フォルダを選んで保存",
  "save.doneBack": "{name} を保存しました（元の場所）",
  "save.doneAs": "「{dir}」に保存しました：{n} ファイル（依存リソース込み）",
  "save.canceled": "保存をキャンセルしました",
  "save.failed": "保存に失敗：{reason}",
  "save.backFailed": "元ファイルに書き込めないため、別名保存に切り替えます…",
  "err.parseTitle": "この XML はまだ描画できません",
  "err.parseMsg": "XML が不完全か、構文エラーがあります",
  "err.parseHint": "「コード」パネルで直してください。修正すると自動で復帰し、ファイルは書き換わりません。",
  "err.fix": "コードパネルで直す",
  "err.crashTitle": "キャンバスの描画に失敗しました",
  "err.crashHint": "操作の問題ではありません。対応範囲を超えたデータが含まれています。「コード」パネルで編集すると自動で再試行します。",
  "err.retry": "再描画",
  "err.empty": "まだ何もありません。左からウィジェットをドラッグしてください",
};

const DICTS: Record<LangCode, Dict> = { "zh-Hans": zhHans, "zh-Hant": zhHant, en, ja };

/** 取词：命中返回译文，未命中回退到调用方传入的中文原文 */
export function translate(lang: LangCode, key: string, fallback: string, vars?: Record<string, string | number>): string {
  const raw = DICTS[lang]?.[key] ?? DICTS["zh-Hans"][key] ?? fallback;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** 生成一个绑定语言的 t() —— 组件里 const tr = makeT(lang) 即可 */
export function makeT(lang: LangCode) {
  return (key: string, fallback: string, vars?: Record<string, string | number>) => translate(lang, key, fallback, vars);
}
