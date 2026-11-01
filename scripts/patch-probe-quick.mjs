// patch-probe-quick.mjs — M60：listTopProjects 拆两阶段
// ① quick：只列根目录直接子项（目录名 + 直接子目录名），毫秒级 → JS 先渲染卡片
// ② 完整：探测跑完后，listTopProjects 把 count/xmlCount/mainPath 一并返回（JS 合并刷新）
// 冷启动 1.6s → 首帧卡片 ~50ms，图标/名称/库类型照旧后台渐进补
import fs from "node:fs";
const F = "apk/src/com/jiji/axv/MainActivity.java";
let s = fs.readFileSync(F, "utf8");
const patch = (anchor, oldSrc, newSrc, label) => {
  if (s.includes(newSrc.split("\n")[0].slice(0, 60))) {
    console.log("skip", label, "(already)");
    return;
  }
  if (!s.includes(oldSrc)) {
    console.error("ANCHOR NOT FOUND:", label);
    console.error(oldSrc);
    process.exit(1);
  }
  s = s.replace(oldSrc, newSrc);
  console.log("patched", label);
};

// 1) 常量：加 QUICK 预算
patch(
  "PROBE_MAX_VISITS",
  "    private static final int PROBE_MAX_VISITS = 600;",
  "    private static final int PROBE_MAX_VISITS = 600;\n    /** M60 quick 阶段：只扫到第一层 xml，预算更小（~40ms/项目） */\n    private static final int PROBE_QUICK_VISITS = 60;",
  "const"
);

// 2) Probe 类：加 countXml（只计 xml，封顶）+ 标记是否已扫到 res 目录
patch(
  "class Probe",
  "    private static final class Probe {\n        int count = 0;\n        String mainPath = null;\n        int visits = 0;\n        boolean budgetOut = false;\n    }",
  "    private static final class Probe {\n        int count = 0;\n        String mainPath = null;\n        int visits = 0;\n        boolean budgetOut = false;\n        /** M60：XML 总数（封顶 99），quick 阶段给 JS 先显示 */\n        int xmlCount = 0;\n        boolean sawRes = false;\n    }",
  "Probe"
);

// 3) probeDir：xml 分支里加 xmlCount/sawRes
patch(
  "probeDir-count",
  "            } else if (nm.endsWith(\".xml\")) {\n                if (p.count < PROBE_COUNT_CAP) p.count++;",
  "            } else if (nm.endsWith(\".xml\")) {\n                if (p.xmlCount < PROBE_COUNT_CAP) p.xmlCount++;\n                if (p.count < PROBE_COUNT_CAP) p.count++;",
  "probeDir-xmlCount"
);
patch(
  "probeDir-sawRes",
  "            if (f.isDirectory()) {\n                probeDir(f, depth + 1, p);",
  "            if (f.isDirectory()) {\n                if (nm.equals(\"res\")) p.sawRes = true;\n                probeDir(f, depth + 1, p);",
  "probeDir-sawRes"
);

// 4) 新 probeProjectQuick：只扫直接子目录一层，找 res/ 下的 xml
patch(
  "probeProject",
  "    /** 带缓存的探测（返回 [count:Integer, mainPath:String]） */\n    private Object[] probeProject(File dir) {",
  "    /** M60 quick 探测：只看直接子目录 + res 里第一层 xml，不进深层（每个项目 ~几十 ms 以内）\n     *  返回 [xmlCount:Integer, sawRes:Boolean]；没有 res 的目录快速判非项目（count=0） */\n    private int[] probeProjectQuick(File dir) {\n        File[] fs = dir.listFiles();\n        int xml = 0;\n        boolean sawRes = false;\n        if (fs != null) {\n            for (File f : fs) {\n                String nm = f.getName().toLowerCase(Locale.ROOT);\n                if (f.isHidden() || SKIP_DIRS.contains(nm)) continue;\n                if (f.isDirectory()) {\n                    if (nm.equals(\"res\")) {\n                        sawRes = true;\n                        File[] resFiles = f.listFiles();\n                        if (resFiles != null) {\n                            for (File rf : resFiles) {\n                                if (rf.isDirectory() && rf.getName().toLowerCase(Locale.ROOT).startsWith(\"layout\")) {\n                                    File[] ls = rf.listFiles();\n                                    if (ls != null) xml += ls.length;\n                                } else if (rf != null && rf.getName().toLowerCase(Locale.ROOT).endsWith(\".xml\")) {\n                                    xml++;\n                                }\n                            }\n                        }\n                    }\n                } else if (nm.endsWith(\".xml\")) {\n                    xml++;\n                }\n            }\n        }\n        return new int[] { Math.min(xml, PROBE_COUNT_CAP), sawRes ? 1 : 0 };\n    }\n\n    /** 带缓存的探测（返回 [count:Integer, mainPath:String]） */\n    private Object[] probeProject(File dir) {",
  "probeProjectQuick"
);

// 5) listTopProjectsJson 的 file 分支：quick 优先 + 探测结果带上 xmlCount
patch(
  "file-branch",
  "                if (f.isDirectory()) {\n                    Object[] probe = probeProject(f);\n                    int cnt = ((Integer) probe[0]).intValue();\n                    if (cnt == 0) continue;\n                    JSONObject it = new JSONObject();\n                    it.put(\"name\", f.getName());\n                    it.put(\"kind\", \"dir\");\n                    it.put(\"rel\", f.getName());\n                    it.put(\"layoutCount\", cnt);\n                    it.put(\"depth\", 0);\n                    it.put(\"path\", f.getAbsolutePath());\n                    if (probe[1] != null) it.put(\"mainPath\", (String) probe[1]);\n                    items.put(it);\n                }",
  "                if (f.isDirectory()) {\n                    // M60：先 quick（毫秒级）——有 res 或任何 xml 就当项目，卡片立刻能出\n                    int[] quick = probeProjectQuick(f);\n                    boolean quickOk = quick[0] > 0 || quick[1] == 1;\n                    Object[] probe = null;\n                    int cnt = quick[0];\n                    if (quickOk) {\n                        // 再走完整探测拿 mainPath / 精确计数（mtime 缓存命中时很快）\n                        probe = probeProject(f);\n                        cnt = ((Integer) probe[0]).intValue();\n                        if (cnt == 0 && quick[0] == 0) continue;\n                    } else {\n                        continue;\n                    }\n                    JSONObject it = new JSONObject();\n                    it.put(\"name\", f.getName());\n                    it.put(\"kind\", \"dir\");\n                    it.put(\"rel\", f.getName());\n                    it.put(\"layoutCount\", cnt);\n                    it.put(\"xmlCount\", quick[0]);\n                    it.put(\"depth\", 0);\n                    it.put(\"path\", f.getAbsolutePath());\n                    if (probe != null && probe[1] != null) it.put(\"mainPath\", (String) probe[1]);\n                    items.put(it);\n                }",
  "file-branch"
);

fs.writeFileSync(F, s, "utf8");
console.log("done");
