// @vitest-environment jsdom
// M78：整页浮层的系统返回键（图标编辑器 / 自定义形状）
//
// 旧行为：MainActivity.onBackPressed() 只判 web.canGoBack()，SPA 里打开浮层不产生
// 历史条目 → 手机按返回键直接结束 Activity，人被踢出 app。
// 现在：浮层挂载 pushState 压哨兵 → 返回键命中 goBack() → popstate → 关浮层；
// 点 UI 返回/✕ 也走 history.back()，两条路径收敛到同一个 popstate，不回调两次。
//
// 注意：jsdom 的会话历史是跨用例共享的（back() 之后的 pushState 会截断前进栈，
// history.length 因此不可靠），所以这里只断言 history.state 里的哨兵标记。
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { useOverlayBack } from "@/lib/overlay-back";

const flush = async (ms = 60) => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, ms / 4));
};

const marked = () => (window.history.state as { axvOverlay?: boolean } | null)?.axvOverlay === true;

function Harness({ onBack, active = true }: { onBack: () => void; active?: boolean }) {
  const close = useOverlayBack(active, onBack);
  return (
    <button id="ui-close" onClick={close}>
      close
    </button>
  );
}

async function mount(onBack: () => void, active = true) {
  window.history.replaceState(null, "");
  await flush(20);
  document.body.innerHTML = "";
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  root.render(<Harness onBack={onBack} active={active} />);
  await flush();
  return { root, host };
}

describe("整页浮层系统返回键（M78）", () => {
  it("挂载时压入哨兵条目（history.state.axvOverlay=true）", async () => {
    const { root } = await mount(() => {});
    expect(marked()).toBe(true);
    root.unmount();
    await flush(120);
  });

  it("系统返回键（history.back）触发 onBack 一次", async () => {
    const onBack = vi.fn();
    const { root } = await mount(onBack);
    window.history.back();
    await flush(120);
    expect(onBack).toHaveBeenCalledTimes(1);
    root.unmount();
    await flush(120);
  });

  it("点 UI 返回按钮只回调一次（不会双关）", async () => {
    const onBack = vi.fn();
    const { root, host } = await mount(onBack);
    (host.querySelector("#ui-close") as HTMLButtonElement).click();
    // M78 修复：UI 点击不再额外制造一次浏览器历史回跳，等待 watchdog 收敛即可
    await flush(600);
    expect(onBack).toHaveBeenCalledTimes(1);
    root.unmount();
    await flush(120);
  });

  it("组件卸载时不再主动 history.back()（网页端不再闪退回侧边栏）", async () => {
    const { root } = await mount(() => {});
    expect(marked()).toBe(true);
    root.unmount();
    await flush(150);
    // 卸载本身只清监听，不额外改动 history，避免网页端被误退
    expect(marked()).toBe(true);
  });

  it("active=false 不压栈（浮层没开就别动历史）", async () => {
    const { root } = await mount(() => {}, false);
    expect(marked()).toBe(false);
    root.unmount();
    await flush(120);
  });

  it("重复渲染（StrictMode 式 effect 重跑）不会压两条哨兵", async () => {
    const { root } = await mount(() => {});
    root.render(<Harness onBack={() => {}} active={true} />);
    await flush();
    expect(marked()).toBe(true);
    root.unmount();
    await flush(120);
  });
});
