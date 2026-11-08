// @vitest-environment jsdom
// test/xml_m191_keystore.test.tsx — M191：设备端生成 keystore 的 UI 行为
// 纯静态渲染测不了「先输口令才出现按钮」，所以这里用真实 DOM + React client 渲染；
// 沿用 m121 的写法：render 后 flush 几轮 setTimeout，不用 act（React 19 的 act 在测试里拿不到）。
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import { SigningDialog } from "../components/SigningDialog";

const flush = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setTimeout(r, 5));
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    root.unmount();
    await flush();
  }
  host?.remove();
  root = null;
  host = null;
});

async function mount(el: React.ReactElement) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(el);
  await flush();
  return host;
}

/** React 受控 input：必须走原型上的 value setter 再 dispatch input，否则 value tracker 吃掉 */
function setInputValue(el: HTMLInputElement, v: string) {
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  desc?.set?.call(el, v);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const byText = (h: HTMLElement, text: string) =>
  Array.from(h.querySelectorAll<HTMLButtonElement>("button")).find((b) => b.textContent?.trim() === text);

const GRADLE = `android {
    namespace 'com.acme.app'
    defaultConfig {
        applicationId 'com.acme.app'
        versionCode 3
        versionName '1.0'
        minSdk 24
    }
    signingConfigs {
        release {
            storeFile file('.axv/release.keystore')
            storePassword 'secret123'
            keyAlias 'release'
            keyPassword 'secret123'
        }
    }
}`;

const noop = async () => true;

describe("M191 SigningDialog 设备端生成 keystore", () => {
  it("没输口令时不显示「生成」按钮，口令够 6 位才出现", async () => {
    // 注意：GRADLE 里已有 keyPassword，prefill 后口令就是 6 位以上 → 必须用没签名段的 gradle
    const plain = `android {
    defaultConfig {
        applicationId 'com.acme.app'
        versionCode 3
        versionName '1.0'
    }
}`;
    const h = await mount(
      <SigningDialog
        gradleText={plain}
        keystoreExists={false}
        onMakeKeystore={async () => ({ ok: true, msg: "ok:2552" })}
        onWriteGradle={noop}
        onClose={() => {}}
        onNote={() => {}}
      />
    );
    expect(byText(h, "生成")).toBeUndefined();
    setInputValue(h.querySelector<HTMLInputElement>('input[type="password"]')!, "axvtest123");
    await flush();
    expect(byText(h, "生成")).toBeDefined();
  });

  it("点了之后把路径 + 别名 + 口令传给回调，并显示已生成", async () => {
    const onMake = vi.fn(async () => ({ ok: true, msg: "ok:2552" }));
    const onNote = vi.fn();
    const h = await mount(
      <SigningDialog
        gradleText={GRADLE}
        keystoreExists={false}
        onMakeKeystore={onMake}
        onWriteGradle={noop}
        onClose={() => {}}
        onNote={onNote}
      />
    );
    setInputValue(h.querySelector<HTMLInputElement>('input[type="password"]')!, "axvtest123");
    await flush();
    byText(h, "生成")!.click();
    await flush();

    expect(onMake).toHaveBeenCalledTimes(1);
    const [rel, o] = onMake.mock.calls[0] as unknown as [string, { alias: string; password: string }];
    expect(rel).toBe(".axv/release.keystore");
    expect(o.alias).toBe("release");
    expect(o.password).toBe("axvtest123");
    expect(onNote).toHaveBeenCalled();
    expect(h.textContent).toContain("keystore 已在本机生成");
    expect(h.textContent).not.toContain("keystore 文件还不存在");
  });

  it("失败时把错误原因显示出来，且不标记为已生成", async () => {
    const h = await mount(
      <SigningDialog
        gradleText={GRADLE}
        keystoreExists={false}
        onMakeKeystore={async () => ({ ok: false, msg: "只能写在项目目录里" })}
        onWriteGradle={noop}
        onClose={() => {}}
        onNote={() => {}}
      />
    );
    setInputValue(h.querySelector<HTMLInputElement>('input[type="password"]')!, "axvtest123");
    await flush();
    byText(h, "生成")!.click();
    await flush();

    expect(h.textContent).toContain("只能写在项目目录里");
    expect(h.textContent).not.toContain("keystore 已在本机生成");
  });

  it("没传 onMakeKeystore（网页版/旧 APK）时按钮不出现", async () => {
    const h = await mount(
      <SigningDialog gradleText={GRADLE} keystoreExists={false} onWriteGradle={noop} onClose={() => {}} onNote={() => {}} />
    );
    setInputValue(h.querySelector<HTMLInputElement>('input[type="password"]')!, "axvtest123");
    await flush();
    expect(byText(h, "生成")).toBeUndefined();
  });
});
