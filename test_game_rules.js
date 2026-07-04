const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const htmlPath = path.join(root, "public", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
assert(scriptMatch, "public/index.html should contain an inline game script");

const noop = () => {};
const canvasListeners = {};
const windowListeners = {};
const ctx = new Proxy({ imageSmoothingEnabled: false }, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (prop === "createImageData") {
      return (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
    }
    if (prop === "measureText") return value => ({ width: String(value).length * 8 });
    if (prop === "createLinearGradient") return () => ({ addColorStop: noop });
    return noop;
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  }
});

const canvas = {
  width: 1280,
  height: 720,
  getContext: () => ctx,
  addEventListener: (type, fn) => { canvasListeners[type] = fn; },
  setPointerCapture: noop,
  releasePointerCapture: noop,
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 })
};

function makeElement(value = "") {
  return {
    hidden: false,
    value,
    textContent: "",
    addEventListener: noop
  };
}

const elements = {
  game: canvas,
  modeMenu: makeElement(),
  roomInput: makeElement("test"),
  relayInput: makeElement(""),
  roomLinks: makeElement(),
  soloBtn: makeElement(),
  helmBtn: makeElement(),
  navigatorBtn: makeElement()
};

global.window = global;
global.document = {
  getElementById: id => elements[id] || null,
  createElement: () => ({ width: 0, height: 0, getContext: () => ctx })
};
global.localStorage = { getItem: () => null, setItem: noop };
global.performance = { now: () => 0 };
global.location = { search: "", protocol: "http:", host: "localhost:8787" };
global.addEventListener = (type, fn) => { windowListeners[type] = fn; };
global.requestAnimationFrame = () => 1;
global.setTimeout = noop;
global.AudioContext = function AudioContext() {};
global.webkitAudioContext = function WebkitAudioContext() {};

new Function(scriptMatch[1])();

const game = global.__anchorProtoTest;
assert(game, "test API should be exposed");

function resetClean() {
  game.reset();
  game.boards.length = 0;
  game.previews.length = 0;
  game.state.navigatorMaterial = 8;
  game.state.navigatorCooldown = 0;
  game.state.freeAnchorCharges = 0;
  game.state.freeAnchorTimer = 0;
  game.ball.dead = false;
  game.ball.inLane = false;
  game.ball.x = 460;
  game.ball.y = 360;
  game.ball.vx = 0;
  game.ball.vy = 0;
}

function resetIntroReady(role = "solo", connected = false) {
  game.setRole(role, connected);
  game.reset();
  game.boards.length = 0;
  game.previews.length = 0;
  game.state.navigatorMaterial = 8;
  game.state.navigatorCooldown = 0;
  game.state.charging = false;
  game.state.power = 0;
}

function introVisible() {
  return game.debug().intro.showIntro;
}

function pointerDown(x = 640, y = 360) {
  assert(canvasListeners.pointerdown, "pointerdown listener should be registered");
  canvasListeners.pointerdown({ clientX: x, clientY: y, pointerId: 1 });
}

function keyDown(code) {
  assert(windowListeners.keydown, "keydown listener should be registered");
  let prevented = false;
  windowListeners.keydown({
    code,
    key: code,
    preventDefault() { prevented = true; }
  });
  return prevented;
}

function keyUp(code) {
  assert(windowListeners.keyup, "keyup listener should be registered");
  windowListeners.keyup({ code, key: code });
}

resetClean();
for (let i = 0; i < 5; i++) game.makeBoard("guard", { x: 220 + i * 80, y: 360 });
assert.strictEqual(game.boards.length, game.constants.boardLimit, "board count should stay at the screen limit");

resetClean();
const expiring = game.makeBoard("guard", { x: game.ball.x, y: game.ball.y, expiresIn: 0.01 });
game.updateBoards(0.05);
assert(game.boards.includes(expiring), "board touching the ball should stay during expiry grace");
assert(expiring.expiring, "board should mark itself as expiring during grace");
game.ball.x += 260;
game.updateBoards(0.05);
assert(!game.boards.includes(expiring), "expired board should vanish after the ball leaves it");

resetClean();
const blast = game.makeBoard("blast");
game.hitBoard(blast, "heavy", blast.breakAt);
assert(blast.broken, "heavy anchor should break blast boards immediately");
game.updateBoards(0.01);
assert.strictEqual(game.state.freeAnchorCharges, 1, "breaking a board should grant one free anchor charge");
assert(game.state.freeAnchorTimer > 0, "breaking a board should start the free anchor timer");

resetClean();
const ramp = game.makeBoard("ramp");
game.shortStrain(ramp, 0.86);
assert(ramp.crackCount >= 1, "taut short-chain rope touching a board should add one fracture layer");
const afterShort = ramp.crackCount;
game.shortStrain(ramp, 0.86);
assert(ramp.crackCount >= afterShort, "short-chain strain should be stable when repeated with a fresh test anchor");

resetClean();
const guard = game.makeBoard("guard", { y: 560 });
game.returnStrain(guard);
assert(guard.crackCount >= 1, "perfect return rescue near a guard board should add one fracture layer");
assert(game.state.navigatorMaterial >= 8, "return/guard synergy should not reduce navigator material");

const debug = game.debug();
assert.strictEqual(debug.growth.scoreMultiplier, 1, "initial score multiplier should be 1");
assert.strictEqual(debug.growth.reachBonus, 0, "initial anchor reach bonus should be 0");
assert(debug.growth.totalBreakablePins > 0, "breakable pin count should be initialized");

resetIntroReady();
assert.strictEqual(introVisible(), true, "new runs should begin with the intro overlay visible");
pointerDown();
assert.strictEqual(introVisible(), false, "first pointer press should dismiss the intro overlay");
assert.strictEqual(game.state.charging, false, "intro dismissal should not start charge");
assert.strictEqual(game.ball.dead, true, "intro dismissal should not launch the ball");
pointerDown();
assert.strictEqual(game.state.charging, true, "second pointer press should start normal charging");
assert(game.state.power >= 0.08, "normal charging should seed launch power after the intro is gone");

resetIntroReady();
assert.strictEqual(keyDown("Space"), true, "space should remain browser-blocked while dismissing the intro");
assert.strictEqual(introVisible(), false, "first space press should dismiss the intro overlay");
assert.strictEqual(game.state.charging, false, "first space press should not start charge");
keyDown("Space");
assert.strictEqual(game.state.charging, false, "space key repeat from the intro press should not start charge");
keyUp("Space");
assert.strictEqual(game.ball.dead, true, "releasing the intro-dismiss space press should not launch");
keyDown("Space");
assert.strictEqual(game.state.charging, true, "second space press should start charge normally");
keyUp("Space");
assert.strictEqual(game.ball.dead, false, "releasing the second space press should launch normally");

resetIntroReady("navigator", true);
game.mp.roles.helm = 1;
assert.strictEqual(keyDown("Digit4"), true, "navigator card hotkey should be blocked from the browser");
assert.strictEqual(introVisible(), false, "first navigator hotkey should dismiss the intro overlay");
assert.strictEqual(game.mp.pendingCards.length, 0, "intro dismissal should not request a navigator card");
keyDown("Digit4");
assert.strictEqual(game.mp.pendingCards.length, 0, "navigator hotkey repeat from the intro press should not request a card");
keyUp("Digit4");
keyDown("Digit4");
assert.strictEqual(game.mp.pendingCards.length, 1, "second navigator hotkey should request a card normally");
keyUp("Digit4");

resetIntroReady();
assert.strictEqual(keyDown("Digit4"), true, "solo board hotkey should be blocked from the browser");
assert.strictEqual(introVisible(), false, "first solo board hotkey should dismiss the intro overlay");
assert.strictEqual(game.previews.length, 0, "intro dismissal should not create a solo board preview");
keyUp("Digit4");
const soloMaterialBefore = game.state.navigatorMaterial;
keyDown("Digit4");
assert.strictEqual(game.previews.length, 1, "solo board hotkey should create a board preview");
assert(game.state.navigatorMaterial < soloMaterialBefore, "solo board placement should spend navigator material");
assert(game.state.navigatorCooldown > 0, "solo board placement should start the shared board cooldown");
keyUp("Digit4");

for (const kind of ["guard", "ramp", "blast", "block"]) {
  resetClean();
  const placed = game.playCard(kind);
  assert.strictEqual(placed, true, `${kind} card should place a board preview`);
  const preview = game.previews[0];
  assert(Number.isInteger(preview.pinAId) && Number.isInteger(preview.pinBId), `${kind} board should mount between two pins`);
  const mountA = game.pins.find(p => p.id === preview.pinAId);
  const mountB = game.pins.find(p => p.id === preview.pinBId);
  assert(mountA && mountB, `${kind} mount pins should exist`);
  assert(Math.abs(preview.x - (mountA.x + mountB.x) / 2) < 0.001, `${kind} board x should sit at the pin midpoint`);
  assert(Math.abs(preview.y - (mountA.y + mountB.y) / 2) < 0.001, `${kind} board y should sit at the pin midpoint`);
  assert(Math.abs(preview.mountSpan - Math.hypot(mountA.x - mountB.x, mountA.y - mountB.y)) < 0.001, `${kind} board should store its pin span`);
  assert(game.boardMountWorldPoints(preview).length === 2, `${kind} board should expose mount hardware points`);
}

resetIntroReady("helm", true);
keyDown("Digit4");
assert.strictEqual(game.previews.length, 0, "network helm should not place local boards with navigator hotkeys");
keyUp("Digit4");

resetClean();
game.setRole("navigator", false);
const offlineCard = game.playCard("guard");
assert.strictEqual(offlineCard, false, "navigator should not report a card request while disconnected");
assert.strictEqual(game.mp.pendingCards.length, 0, "disconnected navigator should not create pending cards");

game.setRole("navigator", true);
const noHelmCard = game.playCard("guard");
assert.strictEqual(noHelmCard, false, "navigator should wait for a helm client before requesting cards");
assert.strictEqual(game.mp.pendingCards.length, 0, "navigator waiting for helm should not create pending cards");

game.mp.roles.helm = 1;
const onlineCard = game.playCard("guard");
assert.strictEqual(onlineCard, true, "connected navigator should be able to request a card");
assert.strictEqual(game.boards.length, 0, "navigator request should not create local boards");
assert.strictEqual(game.previews.length, 0, "navigator request should not create local previews");
assert.strictEqual(game.mp.pendingCards.length, 1, "connected navigator should create one pending card");

resetIntroReady("helm", true);
const remoteCard = game.playCard("guard", "nav-card-1");
assert.strictEqual(remoteCard, true, "helm should execute a valid remote navigator card request");
assert.strictEqual(game.previews.length, 1, "remote navigator card should create an authoritative board preview on helm");
let sent = game.sentMessages();
assert(sent.some(m => m.type === "card_result" && m.cardId === "nav-card-1" && m.accepted), "helm should acknowledge accepted remote card requests");
assert(sent.some(m => m.type === "snapshot" && m.reason === "card" && m.snapshot.previews.length === 1), "helm should immediately publish a snapshot after accepting a remote card");
game.updateBoards(game.constants.boardSpawnWarning + 0.01);
assert.strictEqual(game.boards.length, 1, "accepted board preview should spawn into a real board after the warning window");

resetIntroReady("navigator", true);
game.applyRoomState({ count: 2, roles: { helm: 1, navigator: 1 }, ready: {}, readyAll: false, latestSnapshotId: 7 });
const appliedSnapshot = game.applyNetworkSnapshotMessage({
  type: "snapshot",
  snapshotId: 7,
  snapshot: {
    ...game.snapshot(),
    state: { ...game.snapshot().state, score: 4321 }
  }
});
assert.strictEqual(appliedSnapshot, true, "navigator should still apply the real snapshot after room_state advertises its id");
assert.strictEqual(game.state.score, 4321, "snapshot payload should update navigator state");

resetClean();
const syncedBoard = game.makeBoard("guard", { expiresIn: 0.01, x: 420, y: 300 });
game.setRole("navigator", true);
game.updateBoards(1);
assert(game.boards.includes(syncedBoard), "navigator client should not locally expire authoritative boards");
game.setRole("solo", false);

console.log("game rule checks ok");
