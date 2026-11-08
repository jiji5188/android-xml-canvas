// test/xml_m185b_db_vocab.test.ts
// M185b：ContentValues / Cursor 常见方法补进白名单（修复 put→post、getInt→getId 误报）
import { describe, it, expect } from "vitest";
import { findMethodTypos, KNOWN_METHODS } from "../lib/xml/java-methods";

const CODE = `
public class A {
  void onCreate() {
    ContentValues cv = new ContentValues();
    cv.put("name", "x");
    cv.putNull("age");
    Cursor c = db.query("t", null, null, null, null, null, null);
    if (c.moveToNext()) {
      int id = c.getInt(c.getColumnIndex("id"));
      String n = c.getString(0);
      boolean b = c.isNull(1);
      long l = c.getLong(2);
    }
    c.close();
  }
}
`;

describe("M185b 数据库相关方法不误报", () => {
  it("ContentValues / Cursor / SQLiteDatabase 常见调用零误报", () => {
    expect(findMethodTypos(CODE)).toEqual([]);
  });

  it("白名单确实收了这些方法", () => {
    for (const m of ["put", "putNull", "getInt", "getColumnIndex", "moveToNext", "isNull", "query", "execSQL"]) {
      expect(KNOWN_METHODS).toContain(m);
    }
  });

  it("短名（≤3 字符）不做拼写检查，避免 put→post", () => {
    expect(findMethodTypos("void f() { cv.put(1); x.add(2); }")).toEqual([]);
  });

  it("真正的拼错仍然能报（getColumIndex → getColumnIndex）", () => {
    const out = findMethodTypos("void f() { c.getColumIndex(1); }");
    expect(out.length).toBe(1);
    expect(out[0].suggestion).toBe("getColumnIndex");
  });
});
