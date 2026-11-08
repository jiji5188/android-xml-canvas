// test/xml_m188a_signing_ui.test.tsx — M188a 工具栏签名项 + 弹层渲染
// 沿用 m25c 的做法：Toolbar 直接调用（无副作用）；SigningDialog 用 react-dom/server 渲染成静态 HTML 断言结构。
import { describe, it, expect, vi } from "vitest";
import { isValidElement } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Toolbar, type ToolbarProps } from "../components/Toolbar";
import { SigningDialog } from "../components/SigningDialog";

type El = { type: unknown; props: Record<string, unknown> };

function props(over: Partial<ToolbarProps> = {}): ToolbarProps {
  return {
    isMobile: false,
    leftOpen: true,
    rightOpen: true,
    onOpenLeft: vi.fn(),
    onOpenRight: vi.fn(),
    deviceId: "pixel_5",
    onChangeDevice: vi.fn(),
    scale: 1,
    onScale: vi.fn(),
    canUndo: false,
    canRedo: false,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onSave: vi.fn(),
    onOpenFile: vi.fn(),
    onCopyXml: vi.fn(),
    showResZip: false,
    onExportRes: vi.fn(),
    onExportImage: vi.fn(),
    hasRes: false,
    onClearRes: vi.fn(),
    nativeAvailable: false,
    workspaceLabel: "",
    onChangeWorkspace: vi.fn(),
    onRun: vi.fn(),
    onFormat: vi.fn(),
    ...over,
  };
}

function menuItems(node: ReactNode): Array<{ key: string; label: string; onClick: () => void }> {
  let out: Array<{ key: string; label: string; onClick: () => void }> = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach((c) => walk(c as ReactNode));
    if (!isValidElement(n)) return;
    const el = n as unknown as El;
    const p = el.props as Record<string, unknown>;
    if (Array.isArray(p.items)) out = p.items as typeof out;
    walk(p.children as ReactNode);
  };
  walk(node);
  return out;
}

describe("M188a Toolbar 签名项", () => {
  it("canSign=false 时不出现「签名与发布」", () => {
    const tree = Toolbar(props({ canSign: false }));
    const items = menuItems(tree as unknown as ReactNode);
    expect(items.some((i) => i.key === "sign")).toBe(false);
  });

  it("canSign=true 时出现，点击触发 onSign", () => {
    const onSign = vi.fn();
    const tree = Toolbar(props({ canSign: true, onSign }));
    const items = menuItems(tree as unknown as ReactNode);
    const it0 = items.find((i) => i.key === "sign");
    expect(it0).toBeDefined();
    it0!.onClick();
    expect(onSign).toHaveBeenCalledTimes(1);
  });
});

describe("M188a SigningDialog", () => {
  const html = renderToStaticMarkup(
    <SigningDialog
      gradleText={null}
      onWriteGradle={async () => true}
      onClose={() => {}}
      onNote={() => {}}
    />
  );

  it("渲染基础字段", () => {
    expect(html).toContain("签名与发布");
    expect(html).toContain("别名");
    expect(html).toContain("口令");
    expect(html).toContain("keystore");
  });

  it("三个 scheme 复选框都在", () => {
    expect(html).toContain("v1 (JAR)");
    expect(html).toContain("v2");
    expect(html).toContain("v3");
    expect((html.match(/type="checkbox"/g) || []).length).toBe(3);
  });

  it("没有 build.gradle 时给出提示而不是直接崩", () => {
    expect(html).toContain("keystore 文件本身要手动生成");
  });

  it("rootMissing 时显示草稿提示", () => {
    const h2 = renderToStaticMarkup(
      <SigningDialog gradleText={null} rootMissing onWriteGradle={async () => true} onClose={() => {}} onNote={() => {}} />
    );
    expect(h2).toContain("本地草稿");
    expect(h2).not.toContain("keystore 文件本身要手动生成");
  });

  it("密码框是 password 类型", () => {
    expect(html).toContain('type="password"');
  });
});

describe("M189+ SigningDialog 版本区与检查项修复按钮", () => {
  const GRADLE = `android {
    namespace 'com.example.demo'
    defaultConfig {
        applicationId 'com.example.demo'
        minSdk 24
        targetSdk 34
        versionCode 7
        versionName '1.3'
    }
}
`;

  const h = renderToStaticMarkup(
    <SigningDialog
      gradleText={GRADLE}
      keystoreExists={false}
      appName="My Application"
      iconDefault
      onWriteGradle={async () => true}
      onClose={() => {}}
      onNote={() => {}}
    />
  );

  it("版本区回填 build.gradle 里的值", () => {
    expect(h).toContain("版本信息");
    expect(h).toContain('value="7"');
    expect(h).toContain('value="1.3"');
  });

  it("只读 meta 显示包名与 SDK 级别", () => {
    expect(h).toContain("com.example.demo");
    expect(h).toContain("minSdk 24");
    expect(h).toContain("targetSdk 34");
  });

  it("包名是 com.example.* 时给出「改包名」修复按钮", () => {
    expect(h).toContain("改包名");
    expect(h).toContain("axv-sign-fix");
  });

  it("keystore 不存在给黄色警告", () => {
    expect(h).toContain("axv-sign-issue-warn");
    expect(h).toContain("keystore 文件还不存在");
  });

  it("默认应用名与默认图标给灰色提示", () => {
    expect(h).toContain("应用名还是默认值");
    expect(h).toContain("应用图标还是系统默认的");
  });

  it("一切正常时不显示问题列表", () => {
    const ok = renderToStaticMarkup(
      <SigningDialog
        gradleText={GRADLE.replace(/com\.example\.demo/g, "com.acme.app")}
        keystoreExists
        appName="仓储助手"
        iconDefault={false}
        onWriteGradle={async () => true}
        onClose={() => {}}
        onNote={() => {}}
      />
    );
    expect(ok).toContain("发布前检查：没发现问题");
    expect(ok).not.toContain("axv-sign-issue-error");
  });
});
