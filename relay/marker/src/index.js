/**
 * The marker relay: a phone says where it stands, the walls in the same room hear it at once. Nothing is stored, and the
 * world's record does not go through here (docs/shared-world-plan.md). When this is down or over its daily limit, the
 * walls go on with the samples of the shared world.
 *
 *   wss://<worker>/<world>?as=phone   sends one line of text per place
 *   wss://<worker>/<world>?as=wall    hears them
 */
import { DurableObject } from "cloudflare:workers";

// the same names as isWorldName (apps/web/src/lib/world/protocol.ts)
const ROOM = /^(rehearsal|exhibition|(dev|test)-[a-z0-9-]{1,24})$/;
const ALLOWED_ORIGIN = /^https:\/\/anthropocene(-[a-z0-9-]+)?\.vercel\.app$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
const MAX_SOCKETS = 64;
const MAX_TEXT = 200;

export class MarkerRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    // answered without waking the object: how the tabs measure the way here and back
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(request) {
    if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return new Response("full", { status: 503 });
    const as = new URL(request.url).searchParams.get("as") === "wall" ? "wall" : "phone";
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [as]);
    return new Response(null, { status: 101, webSocket: client });
  }

  webSocketMessage(socket, text) {
    if (typeof text !== "string" || text.length > MAX_TEXT) return;
    if (this.ctx.getTags(socket)[0] !== "phone") return;
    for (const wall of this.ctx.getWebSockets("wall")) {
      try {
        wall.send(text);
      } catch {
        // gone; its close comes on its own
      }
    }
  }

  webSocketClose(socket) {
    try {
      socket.close();
    } catch {
      // already closed
    }
  }
}

export default {
  async fetch(request, env) {
    const room = new URL(request.url).pathname.slice(1);
    if (!ROOM.test(room)) return new Response("no such room", { status: 404 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("websocket only", { status: 426 });
    if (!ALLOWED_ORIGIN.test(request.headers.get("Origin") ?? "")) return new Response("forbidden", { status: 403 });
    // the object is made near whoever asks first; the hint keeps it in Asia even if the first to ask is not
    return env.ROOMS.get(env.ROOMS.idFromName(room), { locationHint: "apac" }).fetch(request);
  },
};
