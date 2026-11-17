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

  const classes = new Map(); // simple → { pkg, fqn, d, m:Set, dm:Set }
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
          let c = classes.get(simple);
          if (!c) classes.set(simple, (c = { pkg, fqn, d: 0, m: new Set(), dm: new Set() }));
          for (const m of info.methods) {
            c.m.add(m.name);
            if (m.isDeprecated) c.dm.add(m.name);
          }
          if (info.classDeprecated) c.d = 1;
        }
      }
    };
    walk(root);
  }

  const classOut = {};
  for (const [simple, c] of classes.entries()) {
    classOut[simple] = {
      pkg: c.pkg,
      fqn: c.fqn,
      d: c.d,
      m: [...c.m].sort(),
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
