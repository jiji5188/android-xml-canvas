import fs from "node:fs";
const p = "test/xml_m63_hsv_picker.test.tsx";
let s = fs.readFileSync(p, "utf8");
s = s.replace(
  `    panel.dispatchEvent(
      new PointerEvent("pointerdown", { clientX: 200, clientY: 0, bubbles: true, pointerId: 1 }),
    );`,
  `    panel.dispatchEvent(new MouseEvent("pointerdown", { clientX: 200, clientY: 0, bubbles: true }));`,
);
fs.writeFileSync(p, s, "utf8");
console.log("patched");
