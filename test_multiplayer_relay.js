const assert = require("assert");
const { spawn } = require("child_process");
const WebSocket = require("ws");

const PORT = 18987 + Math.floor(Math.random() * 1000);
const URL = `ws://127.0.0.1:${PORT}/ws`;

const server = spawn(process.execPath, ["server.js"], {
  cwd: __dirname,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"]
});

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function waitForServer() {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5000);
    server.stdout.on("data", chunk => {
      if (String(chunk).includes(`localhost:${PORT}`)) {
        clearTimeout(timer);
        resolve();
      }
    });
    server.stderr.on("data", chunk => {
      const text = String(chunk);
      if (text.includes("Error")) {
        clearTimeout(timer);
        reject(new Error(text));
      }
    });
    server.on("exit", code => {
      if (code) {
        clearTimeout(timer);
        reject(new Error(`server exited with ${code}`));
      }
    });
  });
}

function connect(role, room = "relay-test", origin = "https://zesty-speculoos-853237.netlify.app") {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { Origin: origin } });
    ws.messages = [];
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "join", room, role }));
      resolve(ws);
    });
    ws.on("message", raw => {
      try { ws.messages.push(JSON.parse(String(raw))); } catch (_) {}
    });
    ws.on("error", reject);
  });
}

function assertBlockedOrigin() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL, { headers: { Origin: "https://blocked.example.com" } });
    ws.on("open", () => reject(new Error("blocked origin should not connect")));
    ws.on("unexpected-response", (_req, res) => {
      try { assert.strictEqual(res.statusCode, 403); resolve(); } catch (err) { reject(err); }
    });
    ws.on("error", () => resolve());
    setTimeout(() => reject(new Error("blocked origin check timed out")), 2500);
  });
}

async function waitFor(ws, predicate, label) {
  const start = Date.now();
  while (Date.now() - start < 2500) {
    const found = ws.messages.find(predicate);
    if (found) return found;
    await wait(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

(async () => {
  try {
    await waitForServer();
    await assertBlockedOrigin();
    const autoHelm = await connect("auto", "auto-role-test");
    const autoNavigator = await connect("auto", "auto-role-test");
    const autoHelmJoin = await waitFor(autoHelm, m => m.type === "joined", "auto helm joined");
    const autoNavigatorJoin = await waitFor(autoNavigator, m => m.type === "joined", "auto navigator joined");
    assert.strictEqual(autoHelmJoin.role, "helm", "first auto player should become helm");
    assert.strictEqual(autoNavigatorJoin.role, "navigator", "second auto player should become navigator");
    autoHelm.send(JSON.stringify({ type: "ready", ready: true }));
    autoNavigator.send(JSON.stringify({ type: "ready", ready: true }));
    await waitFor(autoHelm, m => m.type === "room_state" && m.readyAll, "auto ready room_state");
    autoHelm.close();
    autoNavigator.close();

    const helm = await connect("helm");
    const navigator = await connect("navigator");

    await waitFor(helm, m => m.type === "room_state" && m.roles?.navigator, "helm room_state");
    await waitFor(navigator, m => m.type === "room_state" && m.roles?.helm, "navigator room_state");

    helm.send(JSON.stringify({ type: "ready", ready: true }));
    navigator.send(JSON.stringify({ type: "ready", ready: true }));
    await waitFor(helm, m => m.type === "room_state" && m.readyAll, "ready room_state");
    await waitFor(navigator, m => m.type === "room_state" && m.readyAll, "ready room_state navigator");

    const snapshot = { state: { score: 12 }, ball: { x: 1, y: 2 } };
    helm.send(JSON.stringify({ type: "snapshot", snapshot, snapshotId: 1 }));
    const snapMsg = await waitFor(navigator, m => m.type === "snapshot" && m.snapshotId === 1, "navigator snapshot");
    assert.strictEqual(snapMsg.snapshot.state.score, 12);

    navigator.send(JSON.stringify({ type: "snapshot", snapshot: { bad: true }, snapshotId: 99 }));
    await wait(150);
    assert(!helm.messages.some(m => m.type === "snapshot" && m.snapshot?.bad), "navigator snapshot should be rejected");

    const cardId = "relay-test-card-1";
    navigator.send(JSON.stringify({ type: "play_card", kind: "guard", cardId }));
    await waitFor(navigator, m => m.type === "card_status" && m.cardId === cardId, "navigator card pending");
    await waitFor(helm, m => m.type === "play_card" && m.cardId === cardId && m.kind === "guard", "helm play_card");

    helm.send(JSON.stringify({ type: "play_card", kind: "guard", cardId: "bad-helm-card" }));
    await wait(150);
    assert(!navigator.messages.some(m => m.type === "play_card" && m.cardId === "bad-helm-card"), "helm play_card should be rejected");

    helm.send(JSON.stringify({ type: "card_result", cardId, kind: "guard", accepted: true, reason: "已布置", material: 6 }));
    const result = await waitFor(navigator, m => m.type === "card_result" && m.cardId === cardId, "navigator card_result");
    assert.strictEqual(result.accepted, true);
    assert.strictEqual(result.material, 6);

    const lateNav = await connect("navigator");
    const joinSnap = await waitFor(lateNav, m => m.type === "snapshot" && m.reason === "join", "join snapshot");
    assert.strictEqual(joinSnap.snapshotId, 1);

    helm.close();
    navigator.close();
    lateNav.close();
    console.log("multiplayer relay checks ok");
  } finally {
    server.kill();
  }
})().catch(err => {
  server.kill();
  console.error(err && err.stack || err);
  process.exit(1);
});
