// test/xml_m5b_asset_refs.test.ts — M5b 已生成资源管理：引用统计 / 改名 / 删除
import { describe, it, expect } from "vitest";
import {
  assetKind,
  countReferences,
  humanSize,
  kindLabel,
  referencedNames,
  renameAsset,
  renameReferences,
} from "../lib/xml/asset-refs";

const LAYOUT = `<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">
  <ImageView android:src="@drawable/ic_home" android:background="@drawable/bg_card" />
  <ImageView android:src="@drawable/ic_home_2" />
  <ImageView android:src="@drawable/ic_home" />
  <View android:background="@mipmap/ic_home" />
</LinearLayout>`;

describe("M5b 引用统计", () => {
  it("按精确名计数，不把 ic_home_2 算进 ic_home", () => {
    expect(countReferences(LAYOUT, "ic_home")).toBe(3);
    expect(countReferences(LAYOUT, "ic_home_2")).toBe(1);
  });

  it("drawable 与 mipmap 都算引用", () => {
    expect(countReferences(`<x a="@mipmap/ic_x"/>`, "ic_x")).toBe(1);
    expect(countReferences(`<x a="@drawable/ic_x"/>`, "ic_x")).toBe(1);
  });

  it("未引用返回 0；空输入安全", () => {
    expect(countReferences(LAYOUT, "ic_nope")).toBe(0);
    expect(countReferences("", "ic_home")).toBe(0);
    expect(countReferences(LAYOUT, "")).toBe(0);
  });

  it("referencedNames 只返回被引用的", () => {
    const s = referencedNames(LAYOUT, ["ic_home", "ic_home_2", "bg_card", "ic_nope"]);
    expect([...s].sort()).toEqual(["bg_card", "ic_home", "ic_home_2"]);
  });
});

describe("M5b 改名", () => {
  it("替换所有引用，保留 @drawable / @mipmap 前缀", () => {
    const out = renameReferences(LAYOUT, "ic_home", "ic_start");
    expect(out).toContain("@drawable/ic_start");
    expect(out).toContain("@mipmap/ic_start");
    // 前缀正确的兄弟资源不能被牵连
    expect(out).toContain("@drawable/ic_home_2");
    expect(countReferences(out, "ic_home")).toBe(0);
    expect(countReferences(out, "ic_home_2")).toBe(1);
  });

  it("同名 / 空名 / 空 xml 原样返回", () => {
    expect(renameReferences(LAYOUT, "ic_home", "ic_home")).toBe(LAYOUT);
    expect(renameReferences(LAYOUT, "ic_home", "")).toBe(LAYOUT);
    expect(renameReferences("", "ic_home", "x")).toBe("");
  });

  it("renameAsset 改名 key 并改其它资源内部的互相引用", () => {
    const assets = {
      ic_home: "<vector/>",
      bg_card: `<selector><item android:drawable="@drawable/ic_home"/></selector>`,
    };
    const next = renameAsset(assets, "ic_home", "ic_start");
    expect(next).not.toBeNull();
    expect(Object.keys(next!).sort()).toEqual(["bg_card", "ic_start"]);
    expect(next!.bg_card).toContain("@drawable/ic_start");
    // 原表不被改动
    expect(assets.ic_home).toBe("<vector/>");
    expect(assets.bg_card).toContain("@drawable/ic_home");
  });

  it("renameAsset 拒绝：不存在 / 同名 / 重名", () => {
    const assets = { a: "<vector/>", b: "<shape/>" };
    expect(renameAsset(assets, "zzz", "y")).toBeNull();
    expect(renameAsset(assets, "a", "a")).toBeNull();
    expect(renameAsset(assets, "a", "")).toBeNull();
    expect(renameAsset(assets, "a", "b")).toBeNull();
  });
});

describe("M5b 类型识别与展示", () => {
  it("识别 vector / shape / selector / layer-list / ripple / inset", () => {
    expect(assetKind(`<vector xmlns:android="x"/>`)).toBe("vector");
    expect(assetKind(`<shape><solid/></shape>`)).toBe("shape");
    expect(assetKind(`<selector><item/></selector>`)).toBe("selector");
    expect(assetKind(`<layer-list><item/></layer-list>`)).toBe("layer-list");
    expect(assetKind(`<ripple><item/></ripple>`)).toBe("ripple");
    expect(assetKind(`<inset><shape/></inset>`)).toBe("inset");
    expect(assetKind(`<whatever/>`)).toBe("other");
  });

  it("kindLabel 有中文文案，未知回其它", () => {
    expect(kindLabel("vector")).toBe("矢量图");
    expect(kindLabel("shape")).toBe("形状");
    expect(kindLabel("nope")).toBe("其它");
  });

  it("humanSize 分档", () => {
    expect(humanSize(512)).toBe("512 B");
    expect(humanSize(2048)).toBe("2.0 KB");
    expect(humanSize(3 * 1024 * 1024)).toBe("3.0 MB");
  });
});
