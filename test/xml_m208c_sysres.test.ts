import { lintJava } from "@/lib/xml/java-lint";
import { describe, it, expect } from "vitest";

const SYS_DRAW = `import android.widget.ImageView;
import android.view.View;

class A {
    void f(ImageView ivIcon, View tvMessage) {
        when {
            isSuccess -> {
                ivIcon.setImageResource(android.R.drawable.checkbox_on_background)
            }
            isError -> {
                ivIcon.setImageResource(android.R.drawable.ic_delete)
            }
        }
    }
}`;

describe("M208c 系统框架资源不误报", () => {
  it("android.R.drawable.* 不报 rtype（系统资源）", () => {
    const iss = lintJava(SYS_DRAW, {
      res: {
        drawable: ["ic_myapp", "ic_logo"],
        color: ["success", "error"],
      },
    });
    const rtype = iss.filter((i) => i.code === "rtype");
    expect(rtype).toHaveLength(0);
  });

  it("项目资源真的缺失仍报（对照组）", () => {
    const src = `class A {
    void f() {
        int x = R.drawable.ic_not_exist + 1;
    }
}`;
    const iss = lintJava(src, {
      res: { drawable: ["ic_myapp", "ic_logo"] },
    });
    const rtype = iss.filter((i) => i.code === "rtype");
    expect(rtype.some((i) => i.msg.includes("ic_not_exist"))).toBe(true);
  });
});

describe("M208c 全限定引用不算缺 import", () => {
  it("android.graphics.Color.parseColor 不报 import(Color)", () => {
    const src = `class A {
    void f() {
        int c = android.graphics.Color.parseColor("#2196F3");
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "import" && i.msg.includes("Color"))).toHaveLength(0);
  });

  it("裸 Color 没 import 仍报（对照组）", () => {
    const src = `class A {
    void f() {
        int c = Color.parseColor("#2196F3");
    }
}`;
    const iss = lintJava(src);
    expect(iss.some((i) => i.code === "import" && i.msg.includes("Color"))).toBe(true);
  });

  it("androidx.core.content.ContextCompat 全限定不报 import", () => {
    const src = `class A {
    void f() {
        int c = androidx.core.content.ContextCompat.getColor(ctx, R.color.success);
    }
}`;
    const iss = lintJava(src);
    expect(iss.filter((i) => i.code === "import")).toHaveLength(0);
  });
});
