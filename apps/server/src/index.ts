import { Server } from "colyseus";
import { GameRoom } from "./rooms/GameRoom";

const port = Number(process.env.PORT ?? 2567);

const gameServer = new Server();
gameServer.define("game_room", GameRoom);

gameServer.listen(port).then(() => {
  console.log(`房间服务已启动，端口 ${port}`);
  console.log(`WebSocket: ws://localhost:${port}`);
});
