/**
 * @dev-camcard/protocol
 *
 * 共享协议层 — client / server / engine 共同依赖的唯一协议源。
 *
 * 导出内容：
 *  - 基础枚举类型 (enums)
 *  - 客户端命令 (commands)
 *  - 服务端事件 (events)
 *  - 公开视图 / 私有视图 (views)
 *  - 内部对局状态骨架 (state)
 *
 * 约束（non-negotiables.md）：
 *  - 不含 Phaser 类型
 *  - 不含 Colyseus SDK 类型
 *  - 不含 Prisma 类型
 *  - InternalMatchState 禁止发送给客户端
 */

export * from "./enums";
export * from "./commands";
export * from "./events";
export * from "./views";
export * from "./state";
