const $ = (id) => document.getElementById(id);

const home = $("home");
const chat = $("chat");
const statusEl = $("status");
const messagesEl = $("messages");
const input = $("messageInput");
const notice = $("notice");

let socket = null;
let roomId = null;
let leaving = false;

function showNotice(text) {
  notice.textContent = text;
}

function showSystem(text) {
  const el = document.createElement("div");
  el.className = "msg system";
  el.textContent = text;
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function addMessage(message) {
  const el = document.createElement("div");
  el.className = "msg";
  const body = document.createElement("div");
  body.textContent = message.text;
  const time = document.createElement("time");
  time.textContent = new Date(message.time).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit"
  });
  el.append(body, time);
  messagesEl.appendChild(el);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function connect(id) {
  roomId = id;
  leaving = false;
  home.classList.add("hidden");
  chat.classList.remove("hidden");
  messagesEl.replaceChildren();
  history.replaceState(null, "", "?room=" + encodeURIComponent(id));

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(
    protocol + "//" + location.host + "/chat?room=" + encodeURIComponent(id)
  );

  socket.onopen = () => {
    statusEl.textContent = "Connected";
    showNotice("");
  };

  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }

    if (data.type === "history") {
      data.messages.forEach(addMessage);
    } else if (data.type === "message") {
      addMessage(data.message);
    } else if (data.type === "presence") {
      statusEl.textContent = data.count === 2
        ? "Both participants connected"
        : "Waiting for the other person…";
    }
  };

  socket.onerror = () => {
    showNotice("Connection error. Check the link and try again.");
  };

  socket.onclose = () => {
    statusEl.textContent = "Disconnected";
    if (!leaving) {
      showNotice("Connection closed. The room may have expired.");
    }
  };
}

$("createBtn").addEventListener("click", async () => {
  $("createBtn").disabled = true;
  showNotice("Creating private room…");

  try {
    const response = await fetch("/api/rooms", { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not create room");
    connect(data.roomId);
    showNotice("Room created. Copy the link to invite one person.");
  } catch (err) {
    showNotice(err.message || "Unable to create room.");
  } finally {
    $("createBtn").disabled = false;
  }
});

$("sendForm").addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();

  if (!text || text.length > 2000) return;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    showNotice("Not connected yet.");
    return;
  }

  socket.send(JSON.stringify({ type: "message", text }));
  input.value = "";
  input.focus();
});

$("copyBtn").addEventListener("click", async () => {
  const link = location.origin + "/?room=" + encodeURIComponent(roomId);

  try {
    await navigator.clipboard.writeText(link);
    showNotice("Invite link copied. Send it privately.");
  } catch {
    prompt("Copy this invitation link:", link);
  }
});

$("leaveBtn").addEventListener("click", () => {
  if (!confirm("End this chat and delete the room for both people?")) return;

  leaving = true;
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "leave" }));
  }

  if (socket) socket.close();
  socket = null;
  roomId = null;
  history.replaceState(null, "", location.pathname);
  chat.classList.add("hidden");
  home.classList.remove("hidden");
  messagesEl.replaceChildren();
  showNotice("Chat ended.");
});

const existingRoom = new URLSearchParams(location.search).get("room");
if (existingRoom && /^[a-f0-9]{48}$/.test(existingRoom)) {
  connect(existingRoom);
} else if (existingRoom) {
  showNotice("Invalid invitation link.");
}
