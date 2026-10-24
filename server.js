const express = require("express");
const http = require("http");
const crypto = require("crypto");
const { WebSocketServer, WebSocket } = require("ws");
const path = require("path");

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2kb" }));
app.use(express.static(path.join(__dirname, "public")));

const allowedOrigin = process.env.PUBLIC_ORIGIN || "";
app.use((req, res, next) => {
  if (!req.path.startsWith("/api/")) return next();

  const origin = req.headers.origin;
  const localOrigin = typeof origin === "string" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  const originAllowed = !origin ||
    (allowedOrigin ? origin === allowedOrigin : localOrigin);

  if (origin && !originAllowed) {
    return res.status(403).json({ error: "Origin not allowed." });
  }

  if (originAllowed && origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  }

  if (req.method === "OPTIONS") {
    return res.sendStatus(originAllowed ? 204 : 403);
  }
  next();
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const rooms = new Map();

const PORT = process.env.PORT || 3000;
const MAX_AGE = 30 * 60 * 1000;
const MAX_MESSAGE = 2000;
const MAX_ROOMS = 1000;

function createId() {
  return crypto.randomBytes(24).toString("hex");
}

function deleteRoom(id) {
  const room = rooms.get(id);
  if (!room) return;
  rooms.delete(id);
  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.close(1000, "Room ended");
    }
  }
  room.clients.clear();
  room.messages.length = 0;
}

app.post("/api/rooms", (req, res) => {
  if (rooms.size >= MAX_ROOMS) {
    return res.status(503).json({ error: "Server is busy. Try later." });
  }

  const id = createId();
  rooms.set(id, {
    clients: new Set(),
    messages: [],
    lastActivity: Date.now()
  });

  res.status(201).json({ roomId: id });
});

server.on("upgrade", (req, socket, head) => {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    socket.destroy();
    return;
  }

  if (url.pathname !== "/chat") {
    socket.destroy();
    return;
  }

  const origin = req.headers.origin;
  const expectedOrigin = process.env.PUBLIC_ORIGIN;

  if (expectedOrigin && origin !== expectedOrigin) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  const id = url.searchParams.get("room");
  const room = rooms.get(id);

  if (!room || Date.now() - room.lastActivity > MAX_AGE) {
    if (room) deleteRoom(id);
    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
    socket.destroy();
    return;
  }

  if (room.clients.size >= 2) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit("connection", ws, room, id);
  });
});

wss.on("connection", (ws, room, id) => {
  room.clients.add(ws);
  room.lastActivity = Date.now();

  ws.send(JSON.stringify({
    type: "history",
    messages: room.messages
  }));

  for (const client of room.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({
        type: "presence",
        count: room.clients.size
      }));
    }
  }

  ws.on("message", (raw) => {
    if (!rooms.has(id) || raw.length > MAX_MESSAGE * 4) {
      ws.close(1009, "Message too large");
      return;
    }

    let data;
    try {
      data = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (data.type === "leave") {
      deleteRoom(id);
      return;
    }

    if (data.type !== "message" ||
        typeof data.text !== "string") return;

    const text = data.text.trim();
    if (!text || text.length > MAX_MESSAGE) return;

    const message = {
      id: crypto.randomUUID(),
      text,
      time: Date.now()
    };

    room.messages.push(message);
    if (room.messages.length > 200) room.messages.shift();
    room.lastActivity = Date.now();

    const payload = JSON.stringify({
      type: "message",
      message
    });

    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  });

  ws.on("close", () => {
    room.clients.delete(ws);
    room.lastActivity = Date.now();

    for (const client of room.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({
          type: "presence",
          count: room.clients.size
        }));
      }
    }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [id, room] of rooms) {
    if (now - room.lastActivity > MAX_AGE) {
      deleteRoom(id);
    }
  }
}, 60_000).unref();

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`ANB Private Chat running on port ${PORT}`);
});
