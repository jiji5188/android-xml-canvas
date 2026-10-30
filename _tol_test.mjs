import { chromium } from "playwright";
import fs from "node:fs";

const files = {
  "01 未闭合标签": '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">\n  <TextView android:text="半截"\n',
  "02 纯垃圾内容": "这不是 xml {{{ <<< >>> 乱写",
  "03 只有开标签": "<LinearLayout>",
  "04 空文件": "",
  "05 属性引号没闭合": '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"\n  android:layout_width="match_parent>\n',
  "06 两个根节点": '<TextView xmlns:android="http://schemas.android.com/apk/res/android" android:text="a"/>\n<TextView android:text="b"/>',
  "07 注释里有尖括号": '<!-- 这里有 < > & 还有未闭合 -->\n<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:text="ok"/></LinearLayout>',
  "08 带BOM": "\uFEFF" + '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"><TextView android:text="bom"/></LinearLayout>',
  "09 三千行大文件": '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">\n' + Array.from({ length: 3000 }, (_, i) => `  <TextView android:text="行${i}" android:layout_width="wrap_content" android:layout_height="wrap_content"/>`).join("\n") + "\n</LinearLayout>",
  "10 未闭合注释": "<!-- 我是没关的注释\n<LinearLayout><TextView android:text=\"x\"/></LinearLayout>",
  "11 二进制乱码": "\u0000\u0001PK\u0003\u0004%%%@@@\u001b\u001b",
};

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1400, height: 950 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message.slice(0, 100)));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 100)); });

await page.addInitScript(() => {
  // 假文件系统选择器：从 window.__TEST 拿文件名和内容
  window.showOpenFilePicker = async () => {
    const name = window.__TEST_NAME || "test.xml";
    const text = window.__TEST_XML ?? "";
    const file = new File([text], name, { type: "text/xml" });
    return [{
      kind: "file",
      name,
      getFile: async () => file,
      createWritable: async () => ({ write: async () => {}, close: async () => {}, truncate: async () => {} }),
    }];
  };
});

await page.goto("http://localhost:3000/xml/", { waitUntil: "networkidle" });
await page.waitForTimeout(900);

for (const [name, body] of Object.entries(files)) {
  errors.length = 0;
  await page.evaluate(([n, b]) => { window.__TEST_NAME = n + ".xml"; window.__TEST_XML = b; }, [name, body]);
  const t0 = Date.now();
  // 工具栏「打开」
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button.axv-tb-btn")).find((x) => (x.getAttribute("title") || "").includes("打开"));
    b?.click();
  });
  await page.waitForTimeout(1000);
  const card = await page.locator(".axv-parse-fail").count();
  const warn = await page.locator(".axv-struct-warn").count();
  const nodes = await page.locator(".axv-phone-body .axv-node").count().catch(() => 0);
  const stuck = !(await page.locator(".axv-rail-title").first().isVisible().catch(() => false));
  // 代码面板可编辑？
  await page.getByText("XML 代码").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(500);
  const ta = page.locator("textarea.axv-code-ta").first();
  const editable = await ta.isEditable().catch(() => false);
  const len = (await ta.inputValue().catch(() => "")).length;
  await page.getByText("预览").first().click({ timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  console.log(`${name}: 卡死=${stuck} 画布节点=${nodes} 失败卡=${card} 结构提示=${warn} 可编辑=${editable} 代码长度=${len} 报错=${errors.length} ${Date.now() - t0}ms`);
  if (errors.length) console.log("    ↳", errors.slice(0, 2).join(" / "));
}

await browser.close();
