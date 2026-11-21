// M469：ECJ 失败但「0 个错误」时不再丢真因 + 工具自身开 largeHeap
//
// 背景（用户 2026-11-21 22:32 反馈）：99 个 java 文件的项目打包，日志只有
//   「ECJ 结果：0 个错误，涉及 0 个文件」，然后就中止，完全看不出问题在哪。
// 根因：fmtEcjLog 只认「N. ERROR in path (at line M)」诊断头，其它行（ECJ 内部异常、
//       OutOfMemoryError、参数错误）在 curFile == null 时被 continue 静默丢弃。
// 这里锁住三点，防止以后又被改回去：
//   1) fmtEcjLog 收集未归类行（orphans）
//   2) 输出里带「ECJ 原始输出」段落
//   3) 失败信息在 0 个可解析错误时给内存/内部异常指引
//   4) 工具 APK 的 application 带 android:largeHeap="true"
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const HELPER = readFileSync(path.join(ROOT, "apk/src/com/jiji/axv/BuildApkHelper.java"), "utf8");
const MANIFEST = readFileSync(path.join(ROOT, "apk/AndroidManifest.xml"), "utf8");

describe("M469 ECJ 原始输出不丢 + largeHeap", () => {
  it("fmtEcjLog 收集未归类行（curFile == null 时不再直接 continue 丢弃）", () => {
    expect(HELPER).toContain("java.util.List<String> orphans");
    expect(HELPER).toContain("orphans.add(o)");
    // 旧写法（把诊断头之前的行全部丢掉）
    expect(HELPER).not.toContain("if (curFile == null || msgTaken) continue;");
  });

  it("输出里带「ECJ 原始输出」段落，且仍是 maxEntries 上限内截断", () => {
    expect(HELPER).toContain("ECJ 原始输出");
    expect(HELPER).toContain("orphans.isEmpty()");
  });

  it("0 个可解析错误时，失败信息指向内存/内部异常而不是「看上面 ECJ 的报错行」", () => {
    expect(HELPER).toContain("noParsedError");
    expect(HELPER).toContain("ECJ 没有给出可定位的错误");
  });

  it("工具自身 APK 开 largeHeap（99 文件 + 33 jar 的 ECJ 编译很吃内存）", () => {
    expect(MANIFEST).toContain('android:largeHeap="true"');
  });
});
