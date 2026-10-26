const fs = require("fs");
let s = fs.readFileSync(".gitignore", "utf8");
// 修掉被字面量化的 \n
s = s.replace(/_commitmsg\.txt\r\n\\n# 一次性补丁脚本 \/ 构建日志\\n_patch\*\.js\\n_scan\.js\\n_wire\*\.js\\n_ext\*\.js\\nbuild\.log\\n/g,
  "_commitmsg.txt\r\n\r\n# 一次性补丁脚本 / 构建日志\r\n_patch*.js\r\n_scan.js\r\n_wire*.js\r\n_ext*.js\r\nbuild.log\r\n");
fs.writeFileSync(".gitignore", s, "utf8");
console.log(JSON.stringify(s.slice(-220)));
