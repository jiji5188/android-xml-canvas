// M2u：撤销合并窗口（lib/xml/history.ts 纯函数）
import { describe, expect, it } from "vitest";
import { commitHistoryState, EMPTY_MARK, HISTORY_CAP, MERGE_MS, type HistoryState } from "../lib/xml/history";

const S = (stack: string[], idx = stack.length - 1): HistoryState => ({ stack, idx });

describe("M2u 撤销合并窗口", () => {
  it("同一 key 在窗口内连续提交 → 覆盖栈顶，栈长度不变", () => {
    let st = S(["A", "B"]);
    // 上一次提交是结构性编辑（key 空）→ 本次手势第一次 move 必须新建撤销点
    let mark = { at: 1000, key: "" };
    let now = 1000;
    const first = commitHistoryState(st, "C1", { key: "geom:#0/1", now: (now += 100), mark });
    expect(first.merged).toBe(false);
    st = first.state;
    mark = first.mark;
    expect(st.stack).toEqual(["A", "B", "C1"]);

    for (const v of ["C2", "C3"]) {
      now += 100;
      const r = commitHistoryState(st, v, { key: "geom:#0/1", now, mark });
      expect(r.merged).toBe(true);
      st = r.state;
      mark = r.mark;
    }
    expect(st.stack).toEqual(["A", "B", "C3"]);
    expect(st.idx).toBe(2);
    // 撤销一步回到手势之前
    expect(st.stack[st.idx - 1]).toBe("B");
  });

  it("超过窗口（> MERGE_MS）→ 新增撤销点", () => {
    const st = S(["A", "B"]);
    const mark = { at: 1000, key: "geom:#0/1" };
    const r = commitHistoryState(st, "C", { key: "geom:#0/1", now: 1000 + MERGE_MS + 1, mark });
    expect(r.merged).toBe(false);
    expect(r.state.stack).toEqual(["A", "B", "C"]);
    expect(r.state.idx).toBe(2);
  });

  it("key 不同（换了节点/属性）→ 新增撤销点", () => {
    const st = S(["A", "B"]);
    const mark = { at: 1000, key: "geom:#0/1" };
    const r = commitHistoryState(st, "C", { key: "geom:#0/2", now: 1050, mark });
    expect(r.merged).toBe(false);
    expect(r.state.stack.length).toBe(3);
  });

  it("无 key（结构性操作：插入/删除/载入示例）→ 永远新增", () => {
    const st = S(["A", "B"]);
    const mark = { at: 1000, key: "" };
    const r = commitHistoryState(st, "C", { key: "", now: 1010, mark });
    expect(r.merged).toBe(false);
    expect(r.state.stack.length).toBe(3);
  });

  it("内容没变 → 什么都不做（不产生撤销点）", () => {
    const st = S(["A", "B"]);
    const r = commitHistoryState(st, "B", { key: "geom:#0/1", now: 2000, mark: { at: 1000, key: "x" } });
    expect(r.unchanged).toBe(true);
    expect(r.state).toBe(st);
  });

  it("撤销后再合并 → 不覆盖旧栈顶（idx 不在顶部时新增并截断 redo 分支）", () => {
    // 栈 [A,B,C]，撤销到 B
    const st = S(["A", "B", "C"], 1);
    const mark = { at: 1000, key: "geom:#0/1" };
    const r = commitHistoryState(st, "B2", { key: "geom:#0/1", now: 1050, mark });
    expect(r.merged).toBe(false); // idx 不在栈顶 → 不合并
    expect(r.state.stack).toEqual(["A", "B", "B2"]); // C（redo 分支）被丢弃
    expect(r.state.idx).toBe(2);
  });

  it("超过容量上限 → 丢最旧的，idx 指到末尾", () => {
    const stack = Array.from({ length: HISTORY_CAP }, (_, i) => `v${i}`);
    const st = S(stack);
    const r = commitHistoryState(st, "new", { key: "", now: 5000, mark: EMPTY_MARK });
    expect(r.state.stack.length).toBe(HISTORY_CAP);
    expect(r.state.stack[HISTORY_CAP - 1]).toBe("new");
    expect(r.state.stack[0]).toBe("v1"); // v0 被丢
    expect(r.state.idx).toBe(HISTORY_CAP - 1);
  });

  it("拖动 100 次 → 只留 1 个撤销点（真实场景回归）", () => {
    let st = S(["start"]);
    let mark = EMPTY_MARK;
    let now = 0;
    for (let i = 0; i < 100; i++) {
      now += 10; // 每 10ms 一次 move 事件
      const r = commitHistoryState(st, `moved${i}`, { key: "geom:#0/1", now, mark });
      st = r.state;
      mark = r.mark;
    }
    expect(st.stack.length).toBe(2); // start + 最终位置
    expect(st.stack[1]).toBe("moved99");
  });
});
