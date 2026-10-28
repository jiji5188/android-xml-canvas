// test/xml_m4v_gen_tree.test.ts — 资源树里显示「生成资源」分组（M4v+）
// 注意：不能用 @testing-library/react（本仓没配 alias，且其 act-compat 找不到 React.act），
// 故用 jsdom + react-dom/client + 手动 act。
import { test, expect } from "vitest";
import { JSDOM } from "jsdom";

const dom = new JSDOM(`<!DOCTYPE html><html><body><div id="root"></div></body></html>`, {
  url: "http://localhost/",
  pretendToBeVisual: true,
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

test("生成资源分组显示且可点", async () => {
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");
  const actFn = act || (globalThis as any).__reactAct;
  const useAct = actFn
    ? (fn: any) => actFn(fn)
    : (fn: any) => new Promise<void>((res) => { void fn(); setTimeout(res, 30); });
  const { ResTree } = await import("../components/ResTree");

  const previews: any[][] = [];
  const tree: any = {
    name: "res",
    children: {
      drawable: {
        name: "drawable",
        children: {
          "ic_scan.xml": { rel: "src/main/res/drawable/ic_scan.xml", text: "<vector><path/></vector>", kind: "drawable" },
        },
      },
    },
  };

  const el = dom.window.document.getElementById("root")!;
  const root = createRoot(el);
  await useAct(async () => {
    root.render(
      React.createElement(ResTree, {
        tree,
        onOpenLayout() {},        onOpenDrawable() {},
        onPreviewImage: (...a: any[]) => previews.push(a),
        generated: {
          ic_home:
            '<vector xmlns:android="http://schemas.android.com/apk/res/android" android:width="24dp" android:height="24dp" android:viewportWidth="24" android:viewportHeight="24"><path android:fillColor="#FFF" android:pathData="M3,3h7v7H3z"/></vector>',
        },
      }),
    );
  });

  const rows: any[] = Array.from(el.querySelectorAll(".axv-treenode"));
  const gen = rows.find((x) => x.textContent!.includes("生成资源"));
  expect(gen, "生成资源分组应在树底部").toBeTruthy();
  const item = rows.find((x) => x.textContent!.includes("ic_home.xml"))!;
  expect(item.className).toContain("axv-tree-clickable");

  await useAct(async () => {
    item.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  });
  expect(previews.length).toBe(1);
  expect(previews[0][0]).toBe("drawable/ic_home.xml");
  expect(previews[0][1]).toBe("ic_home");
  expect(String(previews[0][2]).startsWith("data:image/svg+xml")).toBe(true);
  root.unmount();
});
