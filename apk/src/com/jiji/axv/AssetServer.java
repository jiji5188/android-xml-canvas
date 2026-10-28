package com.jiji.axv;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

/**
 * 极简静态文件服务器：把 assets/<root> 下的文件通过 127.0.0.1 暴露给 WebView。
 *
 * 只做 GET/HEAD，不缓存，不列目录，够这个壳用就行。
 * 支持 SPA 式回退：路径以 / 结尾或没有扩展名时，尝试补 index.html。
 */
public class AssetServer {
    private final AssetManager assets;
    private final String root;
    private final int port;
    private ServerSocket socket;
    private Thread acceptor;
    private volatile boolean running;

    private static final Map<String, String> MIME = new HashMap<>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("htm", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("mjs", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("ttf", "font/ttf");
        MIME.put("otf", "font/otf");
        MIME.put("woff", "font/woff");
        MIME.put("woff2", "font/woff2");
        MIME.put("xml", "application/xml; charset=utf-8");
        MIME.put("txt", "text/plain; charset=utf-8");
        MIME.put("map", "application/json; charset=utf-8");
    }

    public AssetServer(AssetManager assets, String root, int port) {
        this.assets = assets;
        this.root = root;
        this.port = port;
    }

    public void start() throws IOException {
        socket = new ServerSocket(port, 50, InetAddress.getByName("127.0.0.1"));
        running = true;
        acceptor = new Thread(() -> {
            while (running) {
                try {
                    final Socket client = socket.accept();
                    Thread t = new Thread(() -> handle(client));
                    t.setDaemon(true);
                    t.start();
                } catch (IOException e) {
                    // socket 被 stop() 关掉时会走到这里，正常退出
                }
            }
        });
        acceptor.setDaemon(true);
        acceptor.setName("axv-asset-server");
        acceptor.start();
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
    }

    private void handle(Socket client) {
        try (Socket c = client) {
            c.setSoTimeout(5000);
            InputStream in = c.getInputStream();
            String requestLine = readLine(in);
            if (requestLine == null || requestLine.isEmpty()) return;
            // 把请求头读干净（不关心内容，但不清空会污染 keep-alive 判断）
            String line;
            do {
                line = readLine(in);
            } while (line != null && !line.isEmpty());

            String[] parts = requestLine.split(" ");
            if (parts.length < 2) return;
            boolean head = "HEAD".equalsIgnoreCase(parts[0]);
            String rawPath = parts[1];
            int q = rawPath.indexOf('?');
            if (q >= 0) rawPath = rawPath.substring(0, q);
            int hash = rawPath.indexOf('#');
            if (hash >= 0) rawPath = rawPath.substring(0, hash);

            byte[] body = readAsset(rawPath);
            OutputStream out = c.getOutputStream();
            if (body == null) {
                byte[] msg = "404".getBytes("UTF-8");
                out.write(("HTTP/1.1 404 Not Found\r\nContent-Type: text/plain\r\nContent-Length: "
                        + msg.length + "\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
                if (!head) out.write(msg);
            } else {
                String mime = mimeOf(rawPath);
                out.write(("HTTP/1.1 200 OK\r\nContent-Type: " + mime
                        + "\r\nContent-Length: " + body.length
                        + "\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n").getBytes("UTF-8"));
                if (!head) out.write(body);
            }
            out.flush();
        } catch (Exception ignored) {
        }
    }

    /** 依次尝试：原路径 → 补 /index.html → 补 .html → 根 index.html */
    private byte[] readAsset(String rawPath) {
        String path = rawPath;
        try {
            path = java.net.URLDecoder.decode(rawPath, "UTF-8");
        } catch (Exception ignored) {
        }
        if (path.contains("..")) return null;
        if (!path.startsWith("/")) path = "/" + path;

        String[] candidates;
        if (path.endsWith("/")) {
            candidates = new String[] { path + "index.html", path + "index.htm" };
        } else {
            candidates = new String[] { path, path + "/index.html", path + ".html" };
        }
        for (String c : candidates) {
            try (InputStream is = assets.open(root + c)) {
                ByteArrayOutputStream bos = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = is.read(buf)) > 0) bos.write(buf, 0, n);
                return bos.toByteArray();
            } catch (IOException ignored) {
                // 试下一个候选
            }
        }
        return null;
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase(Locale.ROOT);
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    /** 读一行（\r\n 或 \n 结尾），流结束返回 null */
    private static String readLine(InputStream in) throws IOException {
        StringBuilder sb = new StringBuilder();
        int c;
        while ((c = in.read()) != -1) {
            if (c == '\n') break;
            if (c != '\r') sb.append((char) c);
            if (sb.length() > 8192) break;
        }
        if (c == -1 && sb.length() == 0) return null;
        return sb.toString();
    }
}
