const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const htmlPath = path.join(root, "public", "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scriptMatch = html.match(/<script[^>]*>([\s\S]*?)<\/script>/i);
assert(scriptMatch, "public/index.html should contain an inline game script");

const noop = () => {};
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
  addEventListener: noop,
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
global.addEventListener = noop;
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

console.log("game rule checks ok");
