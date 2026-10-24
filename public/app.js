(() => {
  const $ = (id) => document.getElementById(id);
  const home = $("home");
  const chat = $("chat");
  const status = $("status");
  const messages = $("messages");
  const input = $("messageInput");
  const notice = $("notice");
  const createBtn = $("createBtn");
  const sendForm = $("sendForm");
  const copyBtn = $("copyBtn");
  const leaveBtn = $("leaveBtn");

  const MAX_MESSAGE = 2000;
  const ICE_SERVERS = [
    { urls: "stun:stun.l.google.com:19302" }
  ];

  let pc = null;
  let channel = null;
  let role = "";
  let offerLink = "";
  let closedByUser = false;

  const style = document.createElement("style");
  style.textContent = `
    .exchange { margin:18px 0;padding:14px;border:1px solid #334155;
      border-radius:14px;background:#111b2d; }
    .exchange h3 { margin:0 0 8px;font-size:16px; }
    .exchange p { color:#aab7ca;font-size:13px;line-height:1.5; }
    .exchange textarea { display:block;width:100%;box-sizing:border-box;
      min-height:100px;margin:10px 0;padding:10px;border-radius:10px;
      border:1px solid #475569;background:#0b1220;color:#f1f5f9;
      font:12px monospace;overflow-wrap:anywhere; }
    .exchange button { margin:4px 6px 4px 0; }
  `;
  document.head.appendChild(style);

  const exchange = document.createElement("section");
  exchange.className = "exchange hidden";
  exchange.innerHTML = `
    <div id="guestPanel" class="hidden">
      <h3>Connection answer</h3>
      <p>Copy this answer code and send it privately to the person who created the invite.</p>
      <textarea id="answerOutput" readonly aria-label="Connection answer"></textarea>
      <button id="copyAnswer" class="secondary">Copy answer code</button>
    </div>
    <div id="hostPanel" class="hidden">
      <h3>Finish connecting</h3>
      <p>Paste the answer code you received from the other person.</p>
      <textarea id="answerInput" placeholder="Paste answer code here…" aria-label="Connection answer"></textarea>
      <button id="applyAnswer" class="primary">Connect securely</button>
    </div>`;
  messages.parentNode.insertBefore(exchange, messages);

  function noticeText(text) {
    notice.textContent = text;
  }

  function setChatVisible() {
    home.classList.add("hidden");
    chat.classList.remove("hidden");
  }

  function encode(value) {
    return btoa(JSON.stringify(value))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
  }

  function decode(value) {
    let s = value.replace(/-/g, "+").replace(/_/g, "/");
    while (s.length % 4) s += "=";
    const result = JSON.parse(atob(s));
    if (!result || typeof result.sdp !== "string" ||
        !["offer", "answer"].includes(result.type)) {
      throw new Error("Invalid connection code.");
    }
    return result;
  }

  function waitForIceGathering(connection) {
    if (connection.iceGatheringState === "complete") {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        connection.removeEventListener("icegatheringstatechange", check);
        resolve();
      };
      const check = () => {
        if (connection.iceGatheringState === "complete") done();
      };
      const timer = setTimeout(done, 12000);
      connection.addEventListener("icegatheringstatechange", check);
    });
  }

  function addMessage(text, mine = false) {
    const el = document.createElement("div");
    el.className = "msg";
    if (mine) el.style.alignSelf = "flex-end";
    const body = document.createElement("div");
    body.textContent = text;
    const time = document.createElement("time");
    time.textContent = new Date().toLocaleTimeString([], {
      hour: "2-digit", minute: "2-digit"
    });
    el.append(body, time);
    messages.appendChild(el);
    messages.scrollTop = messages.scrollHeight;
  }

  function setConnected(connected) {
    input.disabled = !connected;
    $("sendBtn").disabled = !connected;
    status.textContent = connected ? "Peer-to-peer connection established" :
      "Waiting for the other person…";
    if (connected) noticeText("");
  }

  function setupPeer() {
    pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onconnectionstatechange = () => {
      if (!pc) return;
      if (pc.connectionState === "failed") {
        status.textContent = "Connection failed";
        noticeText("The mobile networks may block a direct connection. Try again on a different network.");
      } else if (pc.connectionState === "disconnected") {
        status.textContent = "Connection interrupted";
      }
    };

    pc.ondatachannel = (event) => {
      attachChannel(event.channel);
    };
  }

  function attachChannel(ch) {
    channel = ch;
    channel.onopen = () => setConnected(true);
    channel.onclose = () => setConnected(false);
    channel.onerror = () => noticeText("The peer-to-peer data channel encountered an error.");
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === "message" && typeof data.text === "string") {
          addMessage(data.text.slice(0, MAX_MESSAGE));
        }
      } catch {}
    };
  }

  async function createInvite() {
    if (!window.RTCPeerConnection) {
      noticeText("This browser does not support WebRTC. Try an up-to-date browser.");
      return;
    }

    createBtn.disabled = true;
    noticeText("Preparing invite…");

    try {
      role = "host";
      setupPeer();
      attachChannel(pc.createDataChannel("anb-private-chat"));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      offerLink = location.origin + location.pathname +
        "#offer=" + encode(pc.localDescription);
      history.replaceState(null, "", offerLink);

      setChatVisible();
      exchange.classList.remove("hidden");
      $("hostPanel").classList.remove("hidden");
      $("guestPanel").classList.add("hidden");
      setConnected(false);
      noticeText("Invite ready. Copy the link and send it privately.");
    } catch (err) {
      noticeText("Could not create invite: " + (err.message || err));
      if (pc) pc.close();
      pc = null;
    } finally {
      createBtn.disabled = false;
    }
  }

  async function openInvite(encodedOffer) {
    if (!window.RTCPeerConnection) {
      noticeText("This browser does not support WebRTC. Update your browser.");
      return;
    }

    try {
      role = "guest";
      setChatVisible();
      exchange.classList.remove("hidden");
      $("guestPanel").classList.remove("hidden");
      $("hostPanel").classList.add("hidden");
      status.textContent = "Preparing your connection answer…";
      noticeText("Creating answer code…");

      setupPeer();
      const offer = decode(encodedOffer);
      if (offer.type !== "offer") throw new Error("This invite is not an offer.");

      await pc.setRemoteDescription(offer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      $("answerOutput").value = encode(pc.localDescription);
      setConnected(false);
      noticeText("Copy the answer code and send it to the inviter.");
    } catch (err) {
      noticeText("Invalid or unusable invite: " + (err.message || err));
    }
  }

  $("copyAnswer").addEventListener("click", async () => {
    const text = $("answerOutput").value;
    try {
      await navigator.clipboard.writeText(text);
      noticeText("Answer code copied. Send it privately to the inviter.");
    } catch {
      $("answerOutput").focus();
      $("answerOutput").select();
      noticeText("Select and copy the answer code manually.");
    }
  });

  $("applyAnswer").addEventListener("click", async () => {
    const btn = $("applyAnswer");
    try {
      if (!pc || role !== "host") throw new Error("Create a fresh invite first.");
      if (pc.signalingState !== "have-local-offer") {
        btn.disabled = true;
        throw new Error(
          pc.signalingState === "stable"
            ? "Answer already applied or invite expired. If not connected, tap End chat and create a fresh invite."
            : "Connection is not waiting for an answer. Create a fresh invite."
        );
      }
      const answer = decode($("answerInput").value.trim());
      if (answer.type !== "answer") throw new Error("This code is not an answer.");
      btn.disabled = true;
      await pc.setRemoteDescription(answer);
      noticeText("Answer applied once. Waiting for the direct connection…");
    } catch (err) {
      if (pc && pc.signalingState === "have-local-offer") btn.disabled = false;
      noticeText("Could not apply answer: " + (err.message || err));
    }
  });

  createBtn.addEventListener("click", createInvite);

  copyBtn.addEventListener("click", async () => {
    const link = offerLink || location.href;
    try {
      await navigator.clipboard.writeText(link);
      noticeText("Invite link copied. Send it privately.");
    } catch {
      prompt("Copy this invite link:", link);
    }
  });

  sendForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text || text.length > MAX_MESSAGE) return;
    if (!channel || channel.readyState !== "open") {
      noticeText("The other person is not connected yet.");
      return;
    }
    channel.send(JSON.stringify({ type: "message", text }));
    addMessage(text, true);
    input.value = "";
    input.focus();
  });

  leaveBtn.addEventListener("click", () => {
    closedByUser = true;
    if (channel) channel.close();
    if (pc) pc.close();
    channel = null;
    pc = null;
    history.replaceState(null, "", location.pathname);
    exchange.classList.add("hidden");
    chat.classList.add("hidden");
    home.classList.remove("hidden");
    messages.replaceChildren();
    input.value = "";
    setConnected(false);
    noticeText("Chat ended. Create a new invite to start again.");
  });

  const hash = location.hash.slice(1);
  if (hash.startsWith("offer=")) {
    openInvite(hash.slice(6));
  }

  setConnected(false);
})();
