const fs = require("fs");
const p = "lib/xml/shape-gen.ts";
let s = fs.readFileSync(p, "utf8");
const before = s.length;

// 1) 内部包装器不再自带 xmlns（统一最后给根节点加）
s = s.split('`<layer-list xmlns:android="${NS}">`').join("`<layer-list>`");
s = s.split('`<inset xmlns:android="${NS}"${parts.length ? " " + parts.join(" ") : ""}>`')
     .join('`<inset${parts.length ? " " + parts.join(" ") : ""}>`');
s = s.split('`<selector xmlns:android="${NS}">`').join("`<selector>`");
s = s.split("`<ripple xmlns:android=\"${NS}\"`,").join("`<ripple`,");
s = s.split('`<shape xmlns:android="${NS}" android:shape="${spec.kind}">`')
     .join('`<shape android:shape="${spec.kind}">`');

// 2) 阴影层用阴影色填充、不继承描边
s = s.split(
  "shadowLines.push(...indentAll(shapeBlock({ ...spec, shadow: undefined, states: undefined }, 0), 1));",
).join(
  "shadowLines.push(\n      ...indentAll(shapeBlock({ ...spec, shadow: undefined, states: undefined, stroke: undefined }, 0, { solid: s.color }), 1),\n    );",
);

// 3) 结尾统一补 xmlns
s = s.split(
  `  // 没有包装器时，根 <shape> 必须自带 xmlns（否则单独一个文件不合法）\n  if (!wrapped) {\n    block = [\`<shape android:shape="\${spec.kind}">\`, ...block.slice(1)];\n  }`,
).join(
  `  // 根节点统一补 xmlns（内层不要，避免重复声明）\n  block[0] = block[0].replace(/^<([a-zA-Z-]+)/, (_m, tag: string) => \`<\${tag} xmlns:android="\${NS}"\`);\n  void wrapped;`,
);

fs.writeFileSync(p, s, "utf8");
console.log("len", before, "->", s.length, "| NS refs:", (s.match(/xmlns:android="\$\{NS\}"/g) || []).length);
