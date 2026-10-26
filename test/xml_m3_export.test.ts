// test/xml_m3_export.test.ts — M3 导出：生成 XML + 导出前检查
import { describe, it, expect } from "vitest";
import { exportLayoutXml, exportChecks } from "../lib/xml/export";
import { parseLayoutXml, serialize } from "../lib/xml/parser";

const GOOD = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView android:id="@+id/tv" android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="hi" />
</LinearLayout>`;

const CL_NO_CONSTRAINT = `<?xml version="1.0" encoding="utf-8"?>
<androidx.constraintlayout.widget.ConstraintLayout
    xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:layout_width="match_parent"
    android:layout_height="match_parent">
  <TextView
      android:id="@+id/a"
      android:layout_width="wrap_content"
      android:layout_height="wrap_content" />
</androidx.constraintlayout.widget.ConstraintLayout>`;

describe("M3 导出", () => {
  it("生成带 XML 声明的正式布局文件", () => {
    const out = exportLayoutXml(GOOD);
    expect(out.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    // 重新解析不丢信息：round-trip 后结构一致
    const r1 = parseLayoutXml(out);
    expect(r1.root?.tag).toBe("LinearLayout");
    expect(serialize(r1.root!)).toContain("android:text");
  });

  it("没有 XML 声明时自动补", () => {
    const out = exportLayoutXml(GOOD.replace(/^<\?xml[\s\S]*?\?>/i, ""));
    expect(out.startsWith('<?xml version="1.0"')).toBe(true);
  });

  it("解析失败时不吞用户原文", () => {
    const broken = "<LinearLayout><TextView</LinearLayout>";
    const out = exportLayoutXml(broken);
    expect(out).toContain("<LinearLayout");
    expect(out).toContain("<?xml version");
  });

  it("导出前检查：缺约束的 CL 子项会提示", () => {
    const { errors, notes } = exportChecks(CL_NO_CONSTRAINT);
    expect(errors).toBe(0);
    expect(notes.some((n) => n.includes("没有约束") || n.includes("没有任何约束"))).toBe(true);
  });

  it("导出前检查：正常文件零提示", () => {
    const { errors, notes } = exportChecks(GOOD);
    expect(errors).toBe(0);
    expect(notes).toHaveLength(0);
  });
});
