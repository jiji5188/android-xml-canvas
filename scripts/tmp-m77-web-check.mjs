import http from "node:https";
import httpPlain from "node:http";

const url = "http://127.0.0.1:3000/xml";
const get = (u) => new Promise((resolve, reject) => {
  const client = u.startsWith("https:") ? http : httpPlain;
  const req = client.get(u, { headers: { "User-Agent": "node-check" } }, (res) => {
    let d = "";
    res.setEncoding("utf8");
    res.on("data", (c) => (d += c));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: d }));
  });
  req.on("error", reject);
});

const first = await get(url);
console.log("status", first.status, "loc", first.headers.location, "bytes", first.body.length);
let r = first;
if (r.status >= 300 && r.status < 400 && r.headers.location) {
  const u2 = new URL(r.headers.location, url).href;
  r = await get(u2);
  console.log("final", r.status, "bytes", r.body.length);
}
console.log("has axv-icon-back:", r.body.includes("axv-icon-back"));
console.log("has axv-icon-page:", r.body.includes("axv-icon-page"));
console.log("has overlay-back:", r.body.includes("overlay-back"));
console.log("has M78:", r.body.includes("M78"));
console.log("has old shape-back:", r.body.includes("axv-shape-back"));
