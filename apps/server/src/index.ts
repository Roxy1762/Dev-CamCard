import { Server } from "colyseus";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { GameRoom } from "./rooms/GameRoom";

const port = Number(process.env.PORT ?? 2567);

const app = express();
// 允许来自 Phaser 开发服务器的跨域请求
app.use(cors({ origin: process.env.CLIENT_ORIGIN ?? "http://localhost:3000" }));
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", message: "房间服务已启动" });
});

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });
gameServer.define("game_room", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`房间服务已启动，端口 ${port}`);
  console.log(`WebSocket: ws://localhost:${port}`);
  console.log(`Health:    http://localhost:${port}/health`);
});
