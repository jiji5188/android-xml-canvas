// test/xml_m115_clip.test.ts — M115：画布多选 · 复制 / 粘贴 / 成组 / 解组（纯文本切片）
import { describe, expect, it } from "vitest";
import {
  canUnwrap,
  collectSnippets,
  dedent,
  definedIds,
  deletePaths,
  insertSnippetsAt,
  normalizePaths,
  renameDuplicateIds,
  snippetsToText,
  unwrapElement,
  wrapSiblings,
} from "../lib/xml/clip";

const DOC = `<?xml version="1.0" encoding="utf-8"?>
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:orientation="vertical">

    <TextView
        android:id="@+id/t1"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="一" />

    <TextView
        android:id="@+id/t2"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:text="二" />

    <Button
        android:id="@+id/b1"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content" />

</LinearLayout>
`;

describe("dedent", () => {
  it("去掉共同缩进，空行保持为空", () => {
    expect(dedent("    a\n      b\n\n    c")).toBe("a\n  b\n\nc");
  });
  it("没有缩进时原样返回", () => {
    expect(dedent("a\nb")).toBe("a\nb");
  });
});

describe("normalizePaths", () => {
  it("去掉被祖先覆盖的后代", () => {
    expect(normalizePaths(["#0/1/0", "#0/1"])).toEqual(["#0/1"]);
  });
  it("排序 + 去重，剔除根", () => {
    expect(normalizePaths(["#0/2", "#0/1", "#0/2", "#0"])).toEqual(["#0/1", "#0/2"]);
  });
});

describe("collectSnippets / snippetsToText", () => {
  it("按顺序剪出片段并去掉缩进", () => {
    const list = collectSnippets(DOC, ["#0/1", "#0/0"]);
    expect(list.map((s) => s.tag)).toEqual(["TextView", "TextView"]);
    expect(list[0].text.startsWith("<TextView")).toBe(true);
    expect(list[0].text).toContain('android:id="@+id/t1"');
    expect(list[0].text.trimEnd().endsWith("/>")).toBe(true);
  });

  it("多选祖先+后代只留祖先", () => {
    const list = collectSnippets(DOC, ["#0/0", "#0/0/0"]);
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe("#0/0");
  });

  it("拼成剪贴板文本", () => {
    const text = snippetsToText(collectSnippets(DOC, ["#0/0", "#0/1"]));
    expect(text).toContain("@+id/t1");
    expect(text).toContain("@+id/t2");
    expect(text.indexOf("t1")).toBeLessThan(text.indexOf("t2"));
  });
});

describe("deletePaths", () => {
  it("整行独占时连空行一起删", () => {
    const out = deletePaths(DOC, ["#0/0", "#0/2"]);
    expect(out).not.toContain("@+id/t1");
    expect(out).not.toContain("@+id/b1");
    expect(out).toContain("@+id/t2");
    // 不该留下连续三个空行
    expect(/\n\n\n\n/.test(out)).toBe(false);
  });

  it("删光所有子节点后容器仍然闭合", () => {
    const out = deletePaths(DOC, ["#0/0", "#0/1", "#0/2"]);
    expect(out).toContain("</LinearLayout>");
    expect(out).not.toContain("<TextView");
  });

  it("path 无效时不动文档", () => {
    expect(deletePaths(DOC, ["#0/9"])).toBe(DOC);
  });
});

describe("insertSnippetsAt", () => {
  const snip = '<TextView\n    android:layout_width="wrap_content"\n    android:layout_height="wrap_content"\n    android:text="新" />';

  it("插到末尾，缩进与兄弟一致", () => {
    const r = insertSnippetsAt(DOC, "#0", 3, [snip]);
    expect(r.ok).toBe(true);
    expect(r.firstPath).toBe("#0/3");
    expect(r.count).toBe(1);
    expect(r.xml).toContain('android:text="新"');
    // 新节点前必须是 4 空格缩进
    expect(r.xml).toContain('\n    <TextView\n        android:layout_width');
    // 结构没坏
    const open = (r.xml.match(/<TextView/g) || []).length;
    expect(open).toBe(3);
  });

  it("插到最前面", () => {
    const r = insertSnippetsAt(DOC, "#0", 0, [snip]);
    expect(r.ok).toBe(true);
    expect(r.firstPath).toBe("#0/0");
    expect(r.xml.indexOf('android:text="新"')).toBeLessThan(r.xml.indexOf("@+id/t1"));
  });

  it("一次插两段", () => {
    const r = insertSnippetsAt(DOC, "#0", 1, [snip, '<View\n    android:layout_width="1dp"\n    android:layout_height="1dp" />']);
    expect(r.ok).toBe(true);
    expect(r.count).toBe(2);
    expect(r.xml).toContain('android:text="新"');
    expect(r.xml).toContain('android:layout_width="1dp"');
  });

  it("空片段 / 空数组 → 失败但不改文档", () => {
    expect(insertSnippetsAt(DOC, "#0", 0, []).ok).toBe(false);
    expect(insertSnippetsAt(DOC, "#0", 0, ["   "]).ok).toBe(false);
    expect(insertSnippetsAt(DOC, "#0", 0, ["   "]).xml).toBe(DOC);
  });

  it("父节点不存在 → 失败", () => {
    const r = insertSnippetsAt(DOC, "#0/7", 0, [snip]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("父节点");
  });

  it("自闭合父节点 → 明确报错", () => {
    const doc = '<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android" />';
    const r = insertSnippetsAt(doc, "#0", 0, [snip]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("自闭合");
  });
});

describe("id 去重", () => {
  it("definedIds 只认 @+id", () => {
    expect(definedIds('<A android:id="@+id/a" /><B android:id="@id/b" />')).toEqual(["a"]);
  });

  it("撞名改成 _2，内部引用一起改", () => {
    const snip = `<TextView
    android:id="@+id/t1"
    app:layout_constraintTop_toBottomOf="@+id/b1" />
<Button
    android:id="@+id/b1" />`;
    const out = renameDuplicateIds(DOC, snip);
    expect(out).toContain("@+id/t1_2");
    // 片段内部引用也要跟着改
    expect(out).toContain('toBottomOf="@+id/b1_2"');
    expect(out).toContain('android:id="@+id/b1_2"');
  });

  it("不撞名就原样返回", () => {
    const snip = '<TextView android:id="@+id/zzz" />';
    expect(renameDuplicateIds(DOC, snip)).toBe(snip);
  });

  it("前缀相同的 id 不会被误改（t1 vs t10）", () => {
    const doc = '<A android:id="@+id/t1" /><B android:id="@+id/t10" />';
    const out = renameDuplicateIds(doc, '<C android:id="@+id/t1" />');
    expect(out).toContain("@+id/t1_2");
    expect(out).not.toContain("t10_2");
  });
});

describe("wrapSiblings 成组", () => {
  it("把相邻两个兄弟包进 FrameLayout，缩进正确", () => {
    const r = wrapSiblings(DOC, ["#0/0", "#0/1"]);
    expect(r.ok).toBe(true);
    expect(r.newPath).toBe("#0/0");
    expect(r.xml).toContain("<FrameLayout");
    expect(r.xml).toContain('android:layout_height="wrap_content">');
    expect(r.xml).toContain("</FrameLayout>");
    // 子控件右移 4 空格
    expect(r.xml).toContain("\n        <TextView");
    // 结构完整
    expect(r.xml).toContain("</LinearLayout>");
  });

  it("LinearLayout 带 orientation", () => {
    const r = wrapSiblings(DOC, ["#0/0", "#0/2"], "LinearLayout");
    expect(r.ok).toBe(true);
    expect(r.xml).toContain('<LinearLayout');
    expect(r.xml).toContain('android:orientation="vertical"');
  });

  it("跨层级 / 只有一个 → 报错", () => {
    expect(wrapSiblings(DOC, ["#0/0"]).ok).toBe(false);
    expect(wrapSiblings(DOC, ["#0/0", "#0/9"]).ok).toBe(false);
  });

  it("成组后再解组能回到原样（结构层面）", () => {
    const w = wrapSiblings(DOC, ["#0/0", "#0/1"]);
    const u = unwrapElement(w.xml, "#0/0");
    expect(u.ok).toBe(true);
    expect(u.xml).not.toContain("FrameLayout");
    expect(u.xml).toContain("@+id/t1");
    expect(u.xml).toContain("@+id/t2");
  });
});

describe("unwrapElement 解组", () => {
  const wrapped = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <FrameLayout
        android:layout_width="match_parent"
        android:layout_height="wrap_content">

        <TextView
            android:id="@+id/t1"
            android:layout_width="wrap_content"
            android:layout_height="wrap_content" />

    </FrameLayout>

</LinearLayout>
`;

  it("子节点提上来，缩进回到父级", () => {
    const r = unwrapElement(wrapped, "#0/0");
    expect(r.ok).toBe(true);
    expect(r.xml).not.toContain("FrameLayout");
    expect(r.xml).toContain('\n    <TextView\n        android:id="@+id/t1"');
    expect(r.childPaths).toEqual(["#0/0"]);
  });

  it("自闭合 / 无子节点 → 拒绝", () => {
    expect(unwrapElement('<A xmlns:android="x" />', "#0").ok).toBe(false);
    expect(unwrapElement(DOC, "#0/0").ok).toBe(false);
  });

  it("canUnwrap 判断", () => {
    expect(canUnwrap(DOC, "#0")).toBe(true);
    expect(canUnwrap(DOC, "#0/0")).toBe(false);
  });
});
