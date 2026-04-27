// Admin 后台 Next.js 配置
//
// 通过 NEXT_BASE_PATH 控制部署模式：
//  - 不设：admin 直接挂在 / 下，浏览器访问 http://<host>:3001/
//  - 设为 "/admin"：admin 内部所有路由 / 静态资源都挂到 /admin 下，
//    便于游戏前端 nginx 同域反代（http://<host>/admin/）
const rawBasePath = process.env.NEXT_BASE_PATH ?? "";
const basePath = rawBasePath && rawBasePath !== "/" ? rawBasePath.replace(/\/$/, "") : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
};

module.exports = nextConfig;
