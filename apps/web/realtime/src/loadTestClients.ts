import { io } from "socket.io-client";

const REALTIME_URL = process.env.REALTIME_URL ?? "http://localhost:3001";
const SOCKET_PATH = process.env.SOCKET_PATH ?? "/socket";

// 생성할 가짜 클라이언트 수
const CLIENT_COUNT = Number(process.env.LOAD_CLIENTS ?? 50);
// 각 클라이언트가 입력(속도) 패킷을 보내는 주기
const SEND_INTERVAL_MS = Number(process.env.LOAD_INTERVAL_MS ?? 100);

const MAX_SPEED = 320;

const clients: ReturnType<typeof io>[] = [];

function spawnClient(index: number) {
  const socket = io(REALTIME_URL, {
    path: SOCKET_PATH,
    transports: ["websocket"],
    query: {
      type: "player",
    },
  });

  socket.on("connect", () => {
    // 서버에 플레이어 생성
    socket.emit("respawn");

    // 이름/화면 크기 등은 대충 보내도 된다
    socket.emit("gotit", {
      name: `load-${index}`,
      screenWidth: 1080,
      screenHeight: 1920,
    });

    // 주기적으로 랜덤 속도 패킷 전송 (실제 모바일 클라이언트와 동일한 이벤트 이름 "0")
    const sendLoop = () => {
      if (socket.disconnected) return;
      const angle = Math.random() * Math.PI * 2;
      const speed = MAX_SPEED * (0.3 + Math.random() * 0.7);
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      socket.emit("0", { vx, vy });
      setTimeout(sendLoop, SEND_INTERVAL_MS);
    };
    sendLoop();
  });

  socket.on("connect_error", (err) => {
    console.error(`[c${index}] connect_error`, err.message);
  });

  socket.on("disconnect", (reason) => {
    console.log(`[c${index}] disconnected: ${reason}`);
  });

  clients.push(socket);
}

console.log(
  `Starting socket load test: ${CLIENT_COUNT} clients → ${REALTIME_URL}${SOCKET_PATH}`
);

for (let i = 0; i < CLIENT_COUNT; i += 1) {
  // 살짝 간격 두고 붙여서 한 번에 폭주하지 않도록
  setTimeout(() => spawnClient(i), i * 30);
}

process.on("SIGINT", () => {
  console.log("Closing load-test clients...");
  clients.forEach((s) => {
    try {
      s.disconnect();
    } catch {
      // ignore
    }
  });
  process.exit(0);
});
