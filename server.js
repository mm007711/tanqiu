/* Anchor Maiden multiplayer relay server
   Run:
     npm install
     npm start
   Then open:
     http://localhost:8787/?room=test&role=helm
     http://localhost:8787/?room=test&role=navigator
*/
const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT || 8787);
const PUBLIC_DIR = path.join(__dirname, "public");
const DEFAULT_ALLOWED_ORIGINS = [
  "https://zesty-speculoos-853237.netlify.app",
  "http://localhost:8787",
  "http://127.0.0.1:8787"
];
const ALLOWED_ORIGINS = String(process.env.ALLOWED_ORIGINS || DEFAULT_ALLOWED_ORIGINS.join(","))
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

function sendFile(res, filePath) {
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream" });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  sendFile(res, filePath);
});

const wss = new WebSocketServer({
  server,
  path: "/ws",
  verifyClient(info, done) {
    const origin = info.origin || "";
    if (!origin || ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin)) {
      done(true);
      return;
    }
    done(false, 403, "Origin not allowed");
  }
});
const rooms = new Map();

function getRoom(roomId) {
  if (!rooms.has(roomId)) {
    rooms.set(roomId, {
      clients: new Set(),
      latestSnapshot: null,
      latestSnapshotId: 0
    });
  }
  return rooms.get(roomId);
}

function broadcast(roomId, data, except = null) {
  const room = rooms.get(roomId);
  if (!room) return;
  const payload = JSON.stringify(data);
  for (const client of room.clients) {
    if (client === except) continue;
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

function send(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function roomSummary(room) {
  const roles = {};
  const ready = {};
  for (const client of room.clients) {
    roles[client.role] = (roles[client.role] || 0) + 1;
    if (client.ready) ready[client.role] = true;
  }
  return {
    count: room.clients.size,
    roles,
    ready,
    readyAll: !!ready.helm && !!ready.navigator,
    latestSnapshotId: room.latestSnapshotId || 0
  };
}

function publishPeerCount(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  broadcast(roomId, { type: "room_state", ...roomSummary(room) });
}

function validRole(role) {
  return ["helm", "navigator", "versus"].includes(role);
}

function validCardKind(kind) {
  return ["guard", "ramp", "blast", "block"].includes(kind);
}

wss.on("connection", ws => {
  ws.room = null;
  ws.role = "unknown";
  ws.ready = false;

  ws.on("message", raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }

    if (msg.type === "join") {
      const roomId = String(msg.room || "default").slice(0, 64);
      const requestedRole = String(msg.role || "unknown").slice(0, 32);
      ws.role = validRole(requestedRole) ? requestedRole : "unknown";
      ws.room = roomId;
      ws.ready = false;
      const room = getRoom(roomId);
      room.clients.add(ws);
      send(ws, { type: "joined", room: roomId, role: ws.role, ...roomSummary(room) });
      if (room.latestSnapshot && ws.role !== "helm") {
        send(ws, { type: "snapshot", snapshot: room.latestSnapshot, snapshotId: room.latestSnapshotId, reason: "join" });
      }
      publishPeerCount(roomId);
      return;
    }

    if (!ws.room) return;
    const room = rooms.get(ws.room);
    if (!room) return;

    if (msg.type === "ready") {
      ws.ready = !!msg.ready;
      publishPeerCount(ws.room);
      return;
    }

    if (msg.type === "request_snapshot") {
      if (ws.role === "helm") return;
      if (room.latestSnapshot) {
        send(ws, { type: "snapshot", snapshot: room.latestSnapshot, snapshotId: room.latestSnapshotId, reason: "request" });
      } else {
        broadcast(ws.room, { type: "request_snapshot", role: ws.role }, ws);
      }
      return;
    }

    if (msg.type === "snapshot") {
      if (ws.role !== "helm") return;
      room.latestSnapshot = msg.snapshot;
      room.latestSnapshotId = Math.max(room.latestSnapshotId + 1, Number(msg.snapshotId || 0));
      broadcast(ws.room, { type: "snapshot", snapshot: msg.snapshot, snapshotId: room.latestSnapshotId }, ws);
      return;
    }

    if (msg.type === "play_card") {
      if (ws.role !== "navigator" && ws.role !== "versus") return;
      if (!validCardKind(msg.kind)) return;
      const cardId = String(msg.cardId || `${Date.now()}:${Math.random()}`).slice(0, 96);
      send(ws, { type: "card_status", cardId, kind: msg.kind, status: "pending", role: ws.role });
      broadcast(ws.room, { type: "play_card", kind: msg.kind, cardId, role: ws.role }, ws);
      return;
    }

    if (msg.type === "card_result") {
      if (ws.role !== "helm") return;
      const cardId = String(msg.cardId || "").slice(0, 96);
      if (!cardId) return;
      broadcast(ws.room, {
        type: "card_result",
        cardId,
        kind: validCardKind(msg.kind) ? msg.kind : "",
        accepted: !!msg.accepted,
        reason: String(msg.reason || "").slice(0, 64),
        material: Number.isFinite(msg.material) ? msg.material : null
      }, ws);
      return;
    }

    if (msg.type === "event") {
      broadcast(ws.room, { ...msg, role: ws.role }, ws);
    }
  });

  ws.on("close", () => {
    if (ws.room && rooms.has(ws.room)) {
      rooms.get(ws.room).clients.delete(ws);
      publishPeerCount(ws.room);
      if (rooms.get(ws.room).clients.size === 0) rooms.delete(ws.room);
    }
  });
});

server.listen(PORT, () => {
  console.log(`Anchor Maiden multiplayer prototype running on http://localhost:${PORT}`);
});
