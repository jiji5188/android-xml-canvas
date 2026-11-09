// lib/xml/diag-hints.ts — M207：问题卡片的「为什么报 / 怎么改」两栏
//
// 设计原则（M205b/M205d 教训）：
//  - 宁缺毋滥：没把握就不返回（null），卡片只显示原始 msg
//  - 「为什么」说清判定逻辑（用户才知道该不该信）
//  - 「怎么改」给具体动作（可复制 / 可一键修复）
//  - 不引入新的误报源 —— 这里只是"解释"，不"判定"

export interface DiagHint {
  /** 为什么报这条（判定逻辑，1-2 句） */
  why: string;
  /** 怎么改（动作指令） */
  how: string;
  /** 可选：一键修复时用的替换（from→to）。有的话卡片会显示「应用此修复」按钮 */
  fix?: { from: string; to: string };
}

export function codeHint(code: string | undefined, msg: string): DiagHint | null {
  if (!code) return null;
  // 按 code 精确匹配（大小写敏感，跟 java-lint 的 code 一致）
  switch (code) {
    case "method": {
      const m = /没有 (\w+)\(\) 这个方法/.exec(msg);
      const sug = /是不是想写 (\w+)\(\)/.exec(msg);
      if (!m) return null;
      return {
        why: `白名单里没有 ${m[1]}()，且它跟 ${sug ? sug[1] + "()" : "某个已知方法"} 编辑距离 ≤2、前 2 字符相同 → 当成方法名拼写错。`,
        how: sug
          ? `把 ${m[1]}() 改成 ${sug[1]}()。如果 ${m[1]}() 其实是你自己类里的方法，说明它没被识别为声明——检查一下它的签名（是否缺返回类型/方法体）。`
          : `检查方法名是否拼错。如果是自定义方法，确认同类里有声明。`,
        ...(sug ? { fix: { from: m[1], to: sug[1] } } : {}),
      };
    }
    case "case": {
      // msg 形如：大小写写错了：settext → setText（...）
      const m = /大小写写错了：([A-Za-z_]\w*) → ([A-Za-z_]\w*)/.exec(msg);
      if (!m) return null;
      return {
        why: `Java/Kotlin 区分大小写。你写的 ${m[1]} 不在已知类名/方法表里，但小写化后跟 ${m[2]} 对得上 → 判定为大小写写反。`,
        how: `把 ${m[1]} 改成 ${m[2]}（${m[2].startsWith("set") || m[2].startsWith("get") || m[2].startsWith("put") ? "方法名用驼峰" : "类型/类名首字母大写"}）。`,
        fix: { from: m[1], to: m[2] },
      };
    }
    case "assign": {
      const m = /左边声明为 (\S+?)，右边是 (.+)$/.exec(msg);
      if (!m) return null;
      return {
        why: `左边声明为 ${m[1]}，右边却给了 ${m[2]}。基本类型（int/long/double/float/boolean/char/short/byte）和 String 互不兼容，编译直接报 "incompatible types"。`,
        how: `看上下文：① 右边是字面量打错（比如 "abc" 其实想写 123）→ 改字面量；② 左边类型写错 → 改左边声明；③ 中间做了转换（比如 parseInt）→ 补上转换。`,
      };
    }
    case "sym": {
      const m = /用了 (\w+) 但本类没声明/.exec(msg);
      if (!m) return null;
      return {
        why: `${m[1]} 不在本类已知的字段/参数/局部变量/方法/import 里。可能：① 真的忘声明 ② 拼错 ③ 缺 import ④ 我的符号提取有盲区（反射/注入字段、注解生成代码、Kotlin 隐式 it）。`,
        how: `先确认 ${m[1]} 到底是什么：变量/方法 → 补声明或 import；拼错 → 看有没有「是不是想写 X」；都排除 → 那就是我的误判，直接忽略。带「是不是想写」的这类列为「错误」（高置信），没有的列为「注意」（仅供参考）。`,
      };
    }
    case "brace":
      return {
        why: `花括号 { } 数量对不上（多了一个少了一个）。编译器会报 "unclosed" / "reached end of file"。`,
        how: `数一下本类/本方法的大括号，把缺失的 } 补上或把多余的删掉。`,
      };
    case "quote":
      return {
        why: `字符串引号 " 或单引号 ' 不配对。Java 字符串必须用 "..."，字符必须用 '...'。`,
        how: `检查是否漏了收尾引号，或把中文字符串的引号打成了全角。`,
      };
    case "import":
      return {
        why: `用了某个类但没 import（Android 之外的标准库/第三方库都要显式 import）。`,
        how: `在文件顶部加一行 import。如果是 java.lang.*（Object/String/Integer 等）不用 import。`,
      };
    case "rid":
      return {
        why: `R.id.<名> 在项目里找不到。可能布局里没定义这个 id，或者拼错。`,
        how: `检查布局里有没有 android:id="@+id/<名>"；没有就加，有就核对拼写（注意大小写）。`,
      };
    case "override":
      return {
        why: `@Override 标注的方法在父类/接口里不存在（名字拼错，或签名对不上）。`,
        how: `检查方法名和参数列表是否跟父类/接口完全一致（包括返回类型）。`,
      };
    case "dup":
      return {
        why: `同一个类体第一层（方法外）有两个同名字段声明。Java 不允许。`,
        how: `合并两处，或改其中一个名字。方法体内部的同名局部变量不算，不会报。`,
      };
    case "rtype":
      return {
        why: `方法返回类型写错或没写。`,
        how: `检查方法签名里的返回类型是否合法（void/int/String/自定义类）。`,
      };
    case "ridtype":
      return {
        why: `资源类型（R.layout/R.string/R.drawable/...）写错或找不到对应资源。`,
        how: `确认类型名拼写正确，且 resources 里确实有该类型。`,
      };
    // 未知 code：不解释，避免瞎说
    default:
      return null;
  }
}
