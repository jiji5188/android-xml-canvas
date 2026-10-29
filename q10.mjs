import fs from "fs";

const p = "components/xml-canvas.css";
let s = fs.readFileSync(p, "utf8");

// 1) 尺寸输入框收窄到 30px
const oldTwo = `.axv-icon-ed-two {
  flex: 1 1 auto;
  display: flex;
  gap: 8px;
}`;
const newTwo = `.axv-icon-ed-two {
  flex: 1 1 auto;
  display: flex;
  gap: 8px;
}
/* M11k：尺寸输入框收窄到 30px（用户指定） */
.axv-icon-ed-two .axv-icon-ed-input {
  flex: 0 0 30px;
  width: 30px;
  padding: 0 2px;
  text-align: center;
}`;
if (s.includes(oldTwo)) {
  s = s.replace(oldTwo, newTwo);
  console.log("尺寸输入框已收窄");
} else if (!s.includes(".axv-icon-ed-two .axv-icon-ed-input")) {
  throw new Error("axv-icon-ed-two 锚点没匹配上");
}

// 2) 全屏页布局 + 选择图标按钮 + 底部条
const extra = `
/* ===== M11k：图标编辑器改成整页全屏（与形状编辑器同一套观感）===== */
.axv-icon-page {
  position: fixed;
  inset: 0;
  z-index: 20100;
  display: flex;
  flex-direction: column;
  background: var(--axv-surface-sunken, #f5f4f7);
}
.axv-icon-page-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  display: flex;
  gap: 16px;
  padding: 16px;
  align-items: flex-start;
}
.axv-icon-page-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  height: 52px;
  padding: 0 16px;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  background: var(--axv-surface, #fff);
  font-size: 12px;
  color: var(--axv-muted, #71717a);
}
.axv-icon-ed-pick {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  border-radius: 999px;
  border: 1px solid var(--axv-line, #dcdce4);
  background: var(--axv-surface, #fff);
  color: inherit;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.axv-icon-ed-pick:hover {
  background: var(--axv-primary-soft, #e8f0fe);
  border-color: var(--axv-primary, #04409f);
  color: var(--axv-primary, #04409f);
}
/* 全屏页里表单不再挤在 860px 弹窗内 */
.axv-icon-page .axv-icon-ed-preview {
  flex: 0 0 240px;
  position: sticky;
  top: 0;
}
.axv-icon-page .axv-icon-ed-canvas {
  width: 220px;
  height: 220px;
}
.axv-icon-page .axv-icon-ed-form {
  max-width: 720px;
}
@media (max-width: 720px) {
  .axv-icon-page-body {
    flex-direction: column;
    padding: 12px;
  }
  .axv-icon-page .axv-icon-ed-preview {
    flex: 0 0 auto;
    position: static;
    flex-direction: row;
    justify-content: center;
    width: 100%;
  }
  .axv-icon-page .axv-icon-ed-canvas {
    width: 130px;
    height: 130px;
  }
  .axv-icon-page .axv-icon-ed-form {
    max-width: none;
    width: 100%;
  }
}
`;
if (!s.includes(".axv-icon-page {")) {
  s = s.trimEnd() + "\n" + extra;
  console.log("全屏页样式已追加");
}

fs.writeFileSync(p, s);

// 清理旧的弹窗版容器规则（.axv-icon-editor 已不再使用）
if (s.includes(".axv-icon-editor {")) {
  console.log("注意：.axv-icon-editor 规则已无用（保留，无副作用）");
}
