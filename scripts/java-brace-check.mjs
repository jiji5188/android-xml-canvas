// 粗校验 Java 大括号是否平衡（剥掉字符串/字符/注释后再数）
import { readFileSync } from "node:fs";
const file = process.argv[2] ?? "apk/src/com/jiji/axv/MainActivity.java";
let s = readFileSync(file, "utf8");
// 剥字符串字面量
s = s.replace(/"(?:\\.|[^"\\])*"/g, '""');
// 剥字符字面量
s = s.replace(/'(?:\\.|[^'\\])*'/g, "''");
// 剥块注释
s = s.replace(/\/\*[\s\S]*?\*\//g, "");
// 剥行注释
s = s.replace(/\/\/[^\n]*/g, "");
let b = 0;
for (const c of s) if (c === "{") b++; else if (c === "}") b--;
console.log(file, "-> brace balance:", b, b === 0 ? "(ok)" : "(UNBALANCED!)");
