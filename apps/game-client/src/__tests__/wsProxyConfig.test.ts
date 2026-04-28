/**
 * wsProxyConfig.test.ts
 *
 * 紧盯本次生产事故根因：
 *   nginx.conf / vite.config.ts 旧版本只反代 `/game_room` 这个前缀做 ws 升级，
 *   而 colyseus.js 0.15 实际打开的 ws URL 形如 `/<processId>/<roomId>`
 *   （processId 是服务端 nanoid(9) 生成的随机串，永远不会是 "game_room"）。
 *   于是浏览器的 ws 握手永远落到 SPA fallback / 静态目录，触发 8000ms 加入房间硬超时：
 *     "加入房间 超时（8000ms 无响应）"
 *
 * 这两份配置一旦被改回纯前缀，本测试会立刻报红。
 *
 * 同时，正则必须满足：
 *  - 命中两段 nanoid（默认 9 字符，URL-safe alphabet `A-Z a-z 0-9 _ -`）
 *  - 不命中常见 SPA 路径（/admin/login、/lobby/quick、/api/cards 等）
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function readRepoFile(rel: string): string {
  return readFileSync(resolve(__dirname, "../../", rel), "utf8");
}

/**
 * 把 nginx 风格的字符类写法（带反斜杠的 -）换成 JS RegExp 能直接吃的形式。
 * nginx.conf 写的是 `[A-Za-z0-9_\-]`（兼容老 PCRE），JS RegExp 不需要转义。
 */
function nginxPatternToJsRegex(p: string): RegExp {
  return new RegExp(p.replace(/\\-/g, "-"));
}

const NGINX_CONF = "nginx.conf";
const VITE_CONF = "vite.config.ts";

const COLYSEUS_WS_PATTERN_NGINX = /location\s+~\s+"(\^\/\[A-Za-z0-9_\\?-]\{[\d,]+\}\/\[A-Za-z0-9_\\?-]\{[\d,]+\}\/\?\$)"/;
const COLYSEUS_WS_PATTERN_VITE = /"(\^\/\[A-Za-z0-9_-]\{[\d,]+\}\/\[A-Za-z0-9_-]\{[\d,]+\}\/\?\$)"\s*:/;

// 真实 Colyseus 0.15 URL 样本（nanoid(9)）。这些必须被反代命中。
const REAL_COLYSEUS_WS_PATHS = [
  "/8b3xq7w2K/abc123XYZ",     // 普通 nanoid
  "/aaaaaaaaa/bbbbbbbbb",     // 最短 9
  "/a-b_c-d_e/12345_678",     // 含 _ 与 -
  "/PROCESSPID/ROOMID0_ID",   // 大写
  "/8b3xq7w2K/abc123XYZ/",    // 容错尾随斜杠
];

// SPA 路径或其它静态资源。这些不能被误吞到 ws 反代里。
const NON_COLYSEUS_PATHS = [
  "/",
  "/index.html",
  "/admin/login",             // /admin 必须靠 ^~ 抢占
  "/admin",                   // 同上
  "/api/cards",               // /api/ 同上
  "/assets/main.abc123.js",   // /assets/ 同上
  "/lobby/quick",             // 段长不足 6
  "/matchmake/joinOrCreate/game_room", // 三段，不会落到 ws 反代
  "/game_room",               // 单段，不会落到 ws 反代
];

describe("nginx.conf — Colyseus 0.15 ws 路径必须被反代", () => {
  const conf = readRepoFile(NGINX_CONF);

  it("禁止再写回 ^/(game_room) 这种基于 room name 的反代正则（这是事故根因）", () => {
    // 旧的写法会让 ws 握手永远走不通；如果有人误改回去，立刻红。
    expect(conf).not.toMatch(/location\s+~\s+\^\/\(game_room\)/);
  });

  it("必须包含 /<processId>/<roomId> 形式的 ws location 正则", () => {
    const m = conf.match(COLYSEUS_WS_PATTERN_NGINX);
    expect(m, "nginx.conf 缺少 Colyseus ws 路径反代（/<processId>/<roomId>）").toBeTruthy();
  });

  it("ws location 必须显式带 Upgrade / Connection 升级头", () => {
    // 没有这两个头，nginx 不会把 HTTP/1.1 升级成 WebSocket，浏览器会一直挂着。
    expect(conf).toMatch(/proxy_set_header\s+Upgrade\s+\$http_upgrade/);
    expect(conf).toMatch(/proxy_set_header\s+Connection\s+\$connection_upgrade/);
    expect(conf).toMatch(/map\s+\$http_upgrade\s+\$connection_upgrade/);
  });

  it("/admin、/api/、/assets/、/matchmake/ 必须用 ^~ 抢占 ws 正则", () => {
    // 否则 /admin/_next/static/<hash>/<hash>.js 之类两段路径会被 ws 反代误吞。
    expect(conf).toMatch(/location\s+\^~\s+\/admin/);
    expect(conf).toMatch(/location\s+\^~\s+\/api\//);
    expect(conf).toMatch(/location\s+\^~\s+\/assets\//);
    expect(conf).toMatch(/location\s+\^~\s+\/matchmake\//);
  });

  it("正则等价 JS RegExp 必须命中真实 Colyseus 路径", () => {
    const raw = conf.match(COLYSEUS_WS_PATTERN_NGINX)![1];
    const re = nginxPatternToJsRegex(raw);
    for (const path of REAL_COLYSEUS_WS_PATHS) {
      expect(re.test(path), `应命中: ${path}`).toBe(true);
    }
  });

  it("正则等价 JS RegExp 不能误吞常见 SPA / 静态路径", () => {
    const raw = conf.match(COLYSEUS_WS_PATTERN_NGINX)![1];
    const re = nginxPatternToJsRegex(raw);
    for (const path of NON_COLYSEUS_PATHS) {
      expect(re.test(path), `不应命中: ${path}`).toBe(false);
    }
  });
});

describe("vite.config.ts — 开发期同样要把 ws 反代到 Colyseus 实际路径", () => {
  const conf = readRepoFile(VITE_CONF);

  it("禁止再写回 '/game_room' 单前缀（开发模式下的同一类事故）", () => {
    expect(conf).not.toMatch(/"\/game_room"\s*:/);
  });

  it("必须包含 /<processId>/<roomId> 形式的 ws 反代正则键，并打开 ws:true", () => {
    const m = conf.match(COLYSEUS_WS_PATTERN_VITE);
    expect(m, "vite.config.ts 缺少 Colyseus ws 路径反代").toBeTruthy();
    // 紧跟着的 block 必须 ws: true，否则 vite-proxy 不会处理 upgrade。
    const idx = conf.indexOf(m![0]);
    const tail = conf.slice(idx, idx + 400);
    expect(tail).toMatch(/ws:\s*true/);
  });

  it("正则等价 JS RegExp 必须命中真实 Colyseus 路径", () => {
    const raw = conf.match(COLYSEUS_WS_PATTERN_VITE)![1];
    const re = new RegExp(raw);
    for (const path of REAL_COLYSEUS_WS_PATHS) {
      expect(re.test(path), `应命中: ${path}`).toBe(true);
    }
  });

  it("正则等价 JS RegExp 不能误吞 SPA 路径", () => {
    const raw = conf.match(COLYSEUS_WS_PATTERN_VITE)![1];
    const re = new RegExp(raw);
    for (const path of NON_COLYSEUS_PATHS) {
      expect(re.test(path), `不应命中: ${path}`).toBe(false);
    }
  });
});
