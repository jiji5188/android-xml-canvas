import { describe, it, expect } from "vitest";
import { parseLayoutXml } from "../lib/xml/parser";
import { pathChainOf } from "../lib/xml/path-chain";

const A = 'xmlns:android="http://schemas.android.com/apk/res/android"';

describe("M16e 属性面板层级链", () => {
  const xml = `<ScrollView ${A}
      android:layout_width="match_parent" android:layout_height="match_parent">
      <LinearLayout ${A} android:id="@+id/box"
        android:layout_width="match_parent" android:layout_height="wrap_content" android:orientation="vertical">
        <TextView ${A} android:id="@+id/tv_title"
          android:layout_width="wrap_content" android:layout_height="wrap_content" android:text="标题" />
      </LinearLayout>
    </ScrollView>`;
  const { root } = parseLayoutXml(xml);

  it("根 → 当前节点逐层给出，顺序从外到内", () => {
    const chain = pathChainOf(root, root!.children[0].children[0].path);
    expect(chain.map((c) => c.tag)).toEqual(["ScrollView", "LinearLayout", "TextView"]);
  });

  it("id 带在对应层上（方便区分同类型兄弟）", () => {
    const chain = pathChainOf(root, root!.children[0].children[0].path);
    expect(chain[1].id).toBe("@+id/box");
    expect(chain[2].id).toBe("@+id/tv_title");
    expect(chain[0].id).toBeUndefined();
  });

  it("每层 path 可回传选中（能直接跳层）", () => {
    const target = root!.children[0].children[0].path;
    const chain = pathChainOf(root, target);
    expect(chain[chain.length - 1].path).toBe(target);
    expect(chain[1].path).toBe(root!.children[0].path);
  });

  it("选中根节点时只有一层；path 为空时返回空数组", () => {
    expect(pathChainOf(root, root!.path)).toHaveLength(1);
    expect(pathChainOf(root, null)).toEqual([]);
  });
});
