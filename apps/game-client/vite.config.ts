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
      "/game_room": {
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
