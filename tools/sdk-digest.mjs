// tools/sdk-digest.mjs — M2：构建期把 android.jar 预消化成 sdk-api-index.json
// 用 tools/class-reader.mjs 正确解析 .class 方法表 → 类名/方法名/废弃方法。
// 只收「Android 开发高频包」控制体积（WebView 内存有限）。
//
// 用法：node tools/sdk-digest.mjs <android.jar> <out.json>

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { parseClassInfo } from "./class-reader.mjs";

// 收录的包前缀（控制 JSON 体积；覆盖 Android UI/逻辑开发 95% 常用 API）
const KEEP_PKG = [
  "android.view",
  "android.widget",
  "android.app",
  "android.content",
  "android.os",
  "android.text",
  "android.graphics",
  "android.graphics.drawable",
  "android.util",
  "android.net",
  "android.database",
  "android.database.sqlite",
  "android.preference",
  "android.webkit",
  "android.media",
  "android.animation",
  "android.transition",
  "android.provider",
  "android.hardware",
  "android.location",
  "android.telephony",
  "android.bluetooth",
  "android.nfc",
  "android.opengl",
  "android.accessibilityservice",
  "android.service",
  "android.inputmethodservice",
  "java.lang",
  "java.util",
  "java.util.concurrent",
  "java.io",
  "java.nio",
  "java.text",
  "java.time",
  "java.net",
  "java.math",
  "java.security",
];

function keepPkg(pkg) {
  return KEEP_PKG.some((p) => pkg === p || pkg.startsWith(p + "."));
}

function main() {
  const jar = process.argv[2] || "android.jar";
  const out = process.argv[3] || "public/sdk-api-index.json";
  console.log("parsing", jar);

  const tmpDir = "tmp-sdk-classes";
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  execSync(`tar -xf "${jar}" -C "${tmpDir}"`, { stdio: "pipe", shell: "cmd.exe" });

  const byFqn = new Map(); // fqn → { pkg, methods:Set, dm:Set, d:bool }
  const simpleToFqns = new Map(); // simple → Set<fqn>
  let nFiles = 0;
  for (const sub of ["android", "java", "javax"]) {
    const root = path.join(tmpDir, sub);
    if (!fs.existsSync(root)) continue;
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const fp = path.join(dir, e.name);
        if (e.isDirectory()) walk(fp);
        else if (e.name.endsWith(".class")) {
          const rel = path.relative(tmpDir, fp).replace(/\\/g, "/");
          const fqn = rel.replace(/\.class$/, "").replace(/\//g, ".");
          const pkg = fqn.split(".").slice(0, -1).join(".");
          if (!keepPkg(pkg)) continue;
          const simple = fqn.split(".").pop().split("$").pop();
          let info;
          try {
            info = parseClassInfo(fs.readFileSync(fp));
          } catch {
            continue;
          }
          if (!info) continue;
          nFiles++;
          // M451：按 FQN 存方法。同名跨包（如 android.os.Handler vs java.util.logging.Handler）
          // 不再把方法并进同一个 simple-name 桶 → 避免补全里出现「别的包同名类的方法」。
          let e2 = byFqn.get(fqn);
          if (!e2)
            byFqn.set(fqn, (e2 = { pkg, methods: new Set(), dm: new Set(), rets: new Map(), params: new Map(), d: false }));
          for (const m of info.methods) {
            e2.methods.add(m.name);
            if (m.isDeprecated) e2.dm.add(m.name);
            // M452：同名重载只记第一个非 void 返回类型（候选列表展示够用）
            if (m.ret && m.ret !== "void" && !e2.rets.has(m.name)) e2.rets.set(m.name, m.ret);
            // M453：参数类型串（无参记 ""，主行显示 `name()`）；同名重载取参数最多的
            if (m.params !== undefined && !e2.params.has(m.name)) e2.params.set(m.name, m.params);
          }
          if (info.classDeprecated) e2.d = true;
          let list = simpleToFqns.get(simple);
          if (!list) simpleToFqns.set(simple, (list = new Set()));
          list.add(fqn);
        }
      }
    };
    walk(root);
  }

  // M451：同名跨包时，为每个 simple 选一个「首选 FQN」，只发该 FQN 的方法（不再并包）。
  // 选择规则：① android.* 优先；② 方法多的（更核心）；③ 同分按 fqn 字母序。
  const pickFqn = (cand) => {
    const arr = [...cand];
    arr.sort((a, b) => {
      const ap = byFqn.get(a).pkg.startsWith("android.") ? 0 : 1;
      const bp = byFqn.get(b).pkg.startsWith("android.") ? 0 : 1;
      if (ap !== bp) return ap - bp;
      const am = byFqn.get(a).methods.size;
      const bm = byFqn.get(b).methods.size;
      if (am !== bm) return bm - am;
      return a.localeCompare(b);
    });
    return arr[0];
  };

  const classOut = {};
  for (const [simple, cand] of simpleToFqns.entries()) {
    const chosen = pickFqn(cand);
    const c = byFqn.get(chosen);
    classOut[simple] = {
      pkg: c.pkg,
      fqn: chosen,
      d: c.d ? 1 : 0,
      m: [...c.methods].sort(),
      ...(c.rets.size ? { r: Object.fromEntries([...c.rets.entries()].sort((a, b) => a[0].localeCompare(b[0]))) } : {}),
      ...(c.params.size ? { p: Object.fromEntries([...c.params.entries()].sort((a, b) => a[0].localeCompare(b[0]))) } : {}),
      ...(c.dm.size ? { dm: [...c.dm].sort() } : {}),
    };
  }
  const index = {
    v: 1,
    gen: new Date().toISOString().slice(0, 10),
    count: Object.keys(classOut).length,
    classes: classOut,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(index));
  fs.rmSync(tmpDir, { recursive: true, force: true });
  console.log(`done: ${index.count} classes, ${nFiles} .class parsed, ${(fs.statSync(out).size / 1024).toFixed(0)} KB → ${out}`);
}

main();
