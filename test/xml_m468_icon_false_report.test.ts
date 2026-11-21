// M468：关掉最后一个 tab（files=[]）+ manifest @drawable/icon 不再误报
import { describe, it, expect } from "vitest";
import { checkManifestIcon } from "@/lib/xml/app-icon";

// 纯函数：closeActiveFile 去掉了 files.length<=1 的守卫（最后一个 tab 也可关）
// 这里验证「关到 0 个」的纯逻辑：removeFile 到空 + activeFile 返回 undefined
import { activeFile, removeFile, type ProjectFile, type Project } from "@/lib/xml/multi-file";

function mkFiles(n: number): ProjectFile[] {
  const out: ProjectFile[] = [];
  for (let i = 0; i < n; i++) out.push({ id: "f" + i, name: "a" + i + ".xml", xml: "<X/>", updatedAt: 0 });
  return out;
}
function mkProject(files: ProjectFile[], activeId: string): Project {
  return { name: "P", activeId, files };
}

describe("M468 关掉最后一个 tab（纯逻辑）", () => {
  it("1 个文件关掉 → 0 个，activeFile undefined", () => {
    let p = mkProject(mkFiles(1), "f0");
    p = removeFile(p, p.files[0].id);
    expect(p.files).toHaveLength(0);
    expect(activeFile(p)).toBeUndefined();
  });
});

describe("M468 manifest @drawable icon 不再误报", () => {
  it("@drawable/ic_launcher 合法，返回 []", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@drawable/ic_launcher" android:roundIcon="@drawable/ic_launcher_round" /></manifest>`;
    expect(checkManifestIcon(xml)).toEqual([]);
  });
  it("缺 icon 仍报一条", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:label="x" /></manifest>`;
    const out = checkManifestIcon(xml);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("没有 android:icon");
  });
  it("缺 roundIcon 不再算问题（可选）", () => {
    const xml = `<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application android:icon="@mipmap/ic_launcher" /></manifest>`;
    expect(checkManifestIcon(xml)).toEqual([]);
  });
});
