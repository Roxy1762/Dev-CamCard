/**
 * （历史骨架已移除）
 *
 * 早期版本曾在此处声明 `InternalMatchState`。真正生效的完整定义位于
 * `packages/engine/src/types.ts`，由服务端直接消费；客户端只接收
 * `views.ts` 暴露的 PublicMatchView / PrivatePlayerView。
 *
 * 这里保留空文件只为兼容历史 `index.ts` 的 `export * from "./state"`，
 * 防止外部 import 路径被打破。
 */
export {};
