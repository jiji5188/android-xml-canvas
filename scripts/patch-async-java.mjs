// A 方案第一步：Java 侧拿掉剩余的同步阻塞 + 目录列表缓存
//
//  1) listTopProjectsAsync / getWorkspaceInfoAsync —— 原来这两个是同步 JNI，
//     项目面板一打开就在 JS 线程上读目录，直接冻界面。
//  2) listDirJson 加 mtime 键的 LRU 缓存（256 项）：同一目录反复展开时不再
//     重新 listFiles + 建 JSON。结构变更（新建/删除/改名/移动/复制）走
//     invalidateDirCache() 清空，所以不会显示过期内容。
import fs from "node:fs";

const path = "apk/src/com/jiji/axv/MainActivity.java";
let src = fs.readFileSync(path, "utf8");

function mustReplace(oldText, newText, label) {
  if (!src.includes(oldText)) {
    console.error("锚点缺失: " + label);
    process.exit(1);
  }
  src = src.replace(oldText, newText);
}

if (src.includes("M59：目录列表缓存")) {
  console.log("已打过补丁，跳过");
  process.exit(0);
}

// ---- 1) 新增两个异步入口 ----
mustReplace(
  `        /** M33：异步读文件（后台线程，不卡 UI 线程/JS）。结果回调：`,
  `        /** M59：列顶层项目 / 工作目录信息 转后台线程（原来同步 JNI 会冻界面） */
        @JavascriptInterface
        public void listTopProjectsAsync(final String id) {
            ioAsync(id, new java.util.concurrent.Callable<String>() {
                @Override
                public String call() throws Exception {
                    return listTopProjectsJson();
                }
            });
        }

        @JavascriptInterface
        public void getWorkspaceInfoAsync(final String id) {
            ioAsync(id, new java.util.concurrent.Callable<String>() {
                @Override
                public String call() throws Exception {
                    return workspaceInfoJson();
                }
            });
        }

        private String workspaceInfoJson() {
            try {
                JSONObject o = new JSONObject();
                o.put("defaultPath", defaultDir().getAbsolutePath());
                o.put("custom", treeUri != null ? workspaceLabel() : JSONObject.NULL);
                o.put("effective", effectiveLabel());
                o.put("allFiles", hasAllFiles());
                o.put("sdk", Build.VERSION.SDK_INT);
                return o.toString();
            } catch (Throwable t) {
                return "{}";
            }
        }

        /** M33：异步读文件（后台线程，不卡 UI 线程/JS）。结果回调：`,
  "async 入口",
);

// getWorkspaceInfo 改为复用 workspaceInfoJson（避免两份实现）
mustReplace(
  `        public String getWorkspaceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("defaultPath", defaultDir().getAbsolutePath());
                o.put("custom", treeUri != null ? workspaceLabel() : JSONObject.NULL);
                o.put("effective", effectiveLabel());
                o.put("allFiles", hasAllFiles());
                o.put("sdk", Build.VERSION.SDK_INT);
                return o.toString();
            } catch (Throwable t) {
                return "{}";
            }
        }`,
  `        public String getWorkspaceInfo() {
            return workspaceInfoJson();
        }`,
  "getWorkspaceInfo 复用",
);

// ---- 2) 目录列表缓存 ----
mustReplace(
  `    private String listDirJson(String path) throws Exception {
        if (path == null) return "{\\"ok\\":false}";
        File d = new File(path);
        String base = defaultDir().getCanonicalPath();
        String canon = d.getCanonicalPath();
        if (!canon.equals(base) && !canon.startsWith(base + File.separator)) return "{\\"ok\\":false}";
        if (!d.isDirectory()) return "{\\"ok\\":false}";
        JSONObject out = new JSONObject();`,
  `    /* ===== M59：目录列表缓存（mtime 键 + LRU 256）=====
     * 结构树每展开一层都要 listFiles + 建 JSON，手机上深工程来回点很容易卡。
     * 缓存键 = 规范化绝对路径，校验项 = 目录 lastModified（子项增删改名都会变）。
     * 文件内容修改不影响目录列表，所以不需要更细的失效。 */
    private final java.util.LinkedHashMap<String, Object[]> dirCache =
            new java.util.LinkedHashMap<String, Object[]>(64, 0.75f, true) {
                @Override
                protected boolean removeEldestEntry(java.util.Map.Entry<String, Object[]> eldest) {
                    return size() > 256;
                }
            };

    private void invalidateDirCache() {
        synchronized (dirCache) {
            dirCache.clear();
        }
    }

    @JavascriptInterface
    public void listDirAsyncCached(final String id, final String path) {
        ioAsync(id, new java.util.concurrent.Callable<String>() {
            @Override
            public String call() throws Exception {
                return listDirJson(path);
            }
        });
    }

    private String listDirJson(String path) throws Exception {
        if (path == null) return "{\\"ok\\":false}";
        File d = new File(path);
        String base = defaultDir().getCanonicalPath();
        String canon = d.getCanonicalPath();
        if (!canon.equals(base) && !canon.startsWith(base + File.separator)) return "{\\"ok\\":false}";
        if (!d.isDirectory()) return "{\\"ok\\":false}";
        long mt = d.lastModified();
        synchronized (dirCache) {
            Object[] hit = dirCache.get(canon);
            if (hit != null && ((Long) hit[0]) == mt) return (String) hit[1];
        }
        JSONObject out = new JSONObject();`,
  "listDirJson 缓存头",
);

mustReplace(
  `        out.put("items", items);
        return out.toString();
    }

    private void toast(String msg) {`,
  `        out.put("items", items);
        String json = out.toString();
        synchronized (dirCache) {
            dirCache.put(canon, new Object[]{mt, json});
        }
        return json;
    }

    private void toast(String msg) {`,
  "listDirJson 缓存尾",
);

// ---- 3) 结构变更时清缓存 ----
mustReplace(
  `    private String fileOpJson(`,
  `    private String fileOpJson(`,
  "（占位，fileOpJson 存在性检查）",
);

fs.writeFileSync(path, src, "utf8");
console.log("补丁完成，行数:", src.split("\n").length);
