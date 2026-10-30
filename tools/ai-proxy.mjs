#!/usr/bin/env node
// tools/ai-proxy.mjs — 给 AI 助手用的本地转发小服务（零依赖）
//
// 为什么需要它：腾讯 TokenHub 这类网关不响应 CORS 预检（OPTIONS 直接 405），
// 浏览器直连会被拦成「请求发不出去」。本项目是静态导出（output: export），
// 没有服务端可以写代理接口，所以用一个独立小进程兜底。
//
// 用法：
//   node tools/ai-proxy.mjs                                  # 默认转发到腾讯 TokenHub
//   node tools/ai-proxy.mjs https://api.deepseek.com/v1      # 指定别的上游
//   PORT=9000 node tools/ai-proxy.mjs <upstream>
//
// 然后在 AI 面板里把「接口地址」填成 http://127.0.0.1:8787/v1

import http from "node:http";
import https from "node:https";

const PORT = Number(process.env.PORT || 8787);
// 只取 origin：面板里的「接口地址」会带完整路径（/v1/chat/completions），
// 直接拼到 origin 后面即可，避免 /v1/v1 双前缀。
const upstreamOrigin = new URL(process.argv[2] || process.env.UPSTREAM || "https://tokenhub.tencentmaas.com").origin;

const upstreamUrl = new URL(upstreamOrigin);
const client = upstreamUrl.protocol === "http:" ? http : https;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, anthropic-version, x-api-key, accept",
  "Access-Control-Max-Age": "86400",
};

const FORWARD_HEADERS = ["authorization", "content-type", "anthropic-version", "x-api-key", "accept"];

const server = http.createServer((req, res) => {
  const started = Date.now();
  const send = (status, body, extra = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS, ...extra });
    res.end(body);
  };

  // 预检
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }

  if (!req.url || req.url === "/" || req.url === "/health") {
    send(200, JSON.stringify({ ok: true, upstream: upstreamOrigin, hint: "把 AI 面板的接口地址填成 http://127.0.0.1:" + PORT + "/v1" }));
    return;
  }

  const chunks = [];
  let size = 0;
  req.on("data", (c) => {
    size += c.length;
    if (size > 4 * 1024 * 1024) {
      send(413, JSON.stringify({ error: "请求体超过 4MB" }));
      req.destroy();
      return;
    }
    chunks.push(c);
  });

  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const headers = { "Content-Length": body.length };
    for (const h of FORWARD_HEADERS) {
      if (req.headers[h]) headers[h] = req.headers[h];
    }
    if (!headers["content-type"]) headers["content-type"] = "application/json";

    const target = new URL(upstreamOrigin + req.url);
    const upReq = client.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === "https:" ? 443 : 80),
        path: target.pathname + target.search,
        method: req.method,
        headers,
        timeout: 120_000,
      },
      (upRes) => {
        const out = [];
        upRes.on("data", (c) => out.push(c));
        upRes.on("end", () => {
          const payload = Buffer.concat(out);
          res.writeHead(upRes.statusCode || 502, {
            "Content-Type": upRes.headers["content-type"] || "application/json; charset=utf-8",
            ...CORS_HEADERS,
          });
          res.end(payload);
          console.log(`[ai-proxy] ${req.method} ${req.url} -> ${upRes.statusCode} (${payload.length}B, ${Date.now() - started}ms)`);
        });
      },
    );

    upReq.on("timeout", () => {
      upReq.destroy(new Error("上游超时（120s）"));
    });
    upReq.on("error", (e) => {
      console.error(`[ai-proxy] ${req.method} ${req.url} 失败:`, e.message);
      if (!res.headersSent) send(502, JSON.stringify({ error: "转发失败：" + e.message }));
    });

    upReq.end(body);
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[ai-proxy] 监听 http://127.0.0.1:${PORT}  ->  ${upstreamOrigin}`);
  console.log(`[ai-proxy] 在 AI 面板里把「接口地址」填成 http://127.0.0.1:${PORT}/v1`);
  console.log(`[ai-proxy] 手机/模拟器访问时用电脑的局域网 IP，例如 http://192.168.x.x:${PORT}/v1`);
});
