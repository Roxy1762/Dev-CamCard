import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 3000,
    host: "0.0.0.0",
    proxy: {
      // 开发环境同域代理：移动端/远程设备只需访问前端端口即可联机。
      "/matchmake": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
      },
      // Colyseus 0.15 的 ws 实际路径是 /<processId>/<roomId>，两段都是
      // nanoid(9) 生成的随机串。旧的 "/game_room" 前缀根本不会被命中，
      // 客户端 ws 握手永远走不通，触发 8000ms 加入房间超时。
      // 这里用与 Colyseus 服务端解析路径相同的字符集做正则匹配，并加上长度
      // 下限以避免把 vite SPA 路径（/lobby/login 之类）误判成 ws 握手。
      "^/[A-Za-z0-9_-]{6,21}/[A-Za-z0-9_-]{6,21}/?$": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
        ws: true,
      },
      "/api": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
      },
      "/health": {
        target: "http://127.0.0.1:2567",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    target: "es2020",
  },
});
