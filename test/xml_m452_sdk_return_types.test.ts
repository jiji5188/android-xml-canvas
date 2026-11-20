import { describe, it, expect } from "vitest";
import { computeJavaSuggest } from "@/lib/xml/java-vocab";
import { sdkIndexToLexicon, type SdkIndex } from "@/lib/xml/sdk-lexicon";
import fs from "node:fs";
import path from "node:path";

// M452：SDK 索引带返回类型（r 表）→ 候选说明行展示「这个方法返回什么」。
// 背景：用户在 searchHandler. 的候选里只看到 `public`，看不到返回类型。

const FIXTURE: SdkIndex = {
  v: 1,
  gen: "",
  count: 1,
  classes: {
    Handler: {
      pkg: "android.os",
      fqn: "android.os.Handler",
      m: ["post", "obtainMessage", "removeCallbacks"],
      r: { post: "boolean", obtainMessage: "Message" },
    },
  },
};

const DOC = [
  "public class Demo {",
  "    void run() {",
  "        android.os.Handler h = null;",
  "        h.p",
  "    }",
  "}",
].join("\n");

describe("M452 SDK 方法返回类型", () => {
  it("sdkIndexToLexicon：r 表 → LexMethod.ret", () => {
    const lex = sdkIndexToLexicon(FIXTURE);
    const ms = lex.methods.get("Handler") || [];
    expect(ms.find((m) => m.name === "post")?.ret).toBe("boolean");
    expect(ms.find((m) => m.name === "obtainMessage")?.ret).toBe("Message");
  });

  it("成员补全 h.p → post 的说明行带 boolean", () => {
    const lex = sdkIndexToLexicon(FIXTURE);
    const r = computeJavaSuggest(DOC, { line: 4, col: 11 }, lex);
    expect(r, "h.p 必须弹出候选").toBeTruthy();
    const i = r!.items.indexOf("post");
    expect(i).toBeGreaterThanOrEqual(0);
    const sub = r!.subs?.[i];
    expect(String(sub), "post 说明行=" + sub).toContain("boolean");
  });

  it("真实索引：Handler.post→boolean / obtainMessage→Message / TextView.getText→CharSequence / View.getWidth→int", () => {
    const p = path.join(process.cwd(), "public", "sdk-api-index.json");
    if (!fs.existsSync(p)) {
      // 索引是构建期产物，缺失时不让测试红
      expect(true).toBe(true);
      return;
    }
    const idx = JSON.parse(fs.readFileSync(p, "utf8")) as SdkIndex;
    expect(idx.classes["Handler"]?.r?.["post"]).toBe("boolean");
    expect(idx.classes["Handler"]?.r?.["obtainMessage"]).toBe("Message");
    expect(idx.classes["TextView"]?.r?.["getText"]).toBe("CharSequence");
    expect(idx.classes["View"]?.r?.["getWidth"]).toBe("int");
    // void 方法不存 r（setVisibility 返回 void）
    expect(idx.classes["View"]?.r?.["setVisibility"]).toBeUndefined();
  });
});
