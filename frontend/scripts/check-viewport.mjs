/**
 * Real-viewport layout check (ticket #38 acceptance).
 *
 * Drives the installed Chromium-based browser over the DevTools protocol at an
 * exact 1920x1080 viewport and measures the document: the control room must
 * never scroll horizontally, and at xl the page itself must not scroll
 * vertically either — only panel bodies do.
 *
 * Usage: node scripts/check-viewport.mjs [url] [width] [height]
 * Requires a running server (npm run build && npx next start -p 3111).
 */

import { spawn } from "node:child_process";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] ?? "http://localhost:3111/";
const WIDTH = Number(process.argv[3] ?? 1920);
const HEIGHT = Number(process.argv[4] ?? 1080);
const PORT = 9333;

const CANDIDATES = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
];

const browser = CANDIDATES.find((p) => existsSync(p));
if (!browser) {
  console.error("No Chromium-based browser found; skipping viewport check.");
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "blaze-viewport-"));
const child = spawn(
  browser,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function target() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page");
      if (page?.webSocketDebuggerUrl) return page.webSocketDebuggerUrl;
    } catch {
      /* browser not up yet */
    }
    await sleep(250);
  }
  throw new Error("DevTools endpoint never became available");
}

const wsUrl = await target();
const ws = new WebSocket(wsUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});

let id = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    id += 1;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
// Exact CSS viewport, independent of window chrome.
await send("Emulation.setDeviceMetricsOverride", {
  width: WIDTH,
  height: HEIGHT,
  deviceScaleFactor: 1,
  mobile: false,
});
await send("Page.navigate", { url: URL_ });
await sleep(3500); // load + hydrate + arm the mock stream

// `--play` replays the whole mock stream at x5 first: an empty control room
// never overflows, so the layout must be measured FULL of scenario content.
if (process.argv.includes("--play")) {
  await send("Runtime.evaluate", {
    expression: `(() => {
      const btn = [...document.querySelectorAll("button")];
      const x5 = btn.find((b) => b.textContent.trim() === "x5");
      if (x5) x5.click();
      const play = btn.find((b) => /play/i.test(b.textContent));
      if (play) play.click();
      return !!x5 + "/" + !!play;
    })()`,
    returnByValue: true,
  });
  // 160 s of scenario at x5 = 32 s, plus margin for the final renders.
  for (let i = 0; i < 45; i += 1) {
    await sleep(1000);
    const { result: r } = await send("Runtime.evaluate", {
      expression: `document.body.innerText.includes("70/70") || /event 70\\s*\\/\\s*70/.test(document.body.innerText)`,
      returnByValue: true,
    });
    if (r.value) break;
  }
  await sleep(1500);
}

const probe = `(() => {
  const de = document.documentElement;
  const body = document.body;
  const offenders = [];
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.right > ${WIDTH} + 1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        cls: (el.className && el.className.baseVal !== undefined ? el.className.baseVal : String(el.className || "")).slice(0, 70),
        right: Math.round(r.right),
      });
    }
  }
  const regions = {};
  for (const rid of ${JSON.stringify([
    "header-status",
    "cloud-llm-claim",
    "tactical-map",
    "radio-timeline",
    "radio-event-cards",
    "agent-trace",
    "situation-snapshot",
    "tactical-plan",
    "safety-critic",
    "approval-gate",
    "dispatch-panel",
    "nvidia-metrics",
  ])}) {
    const el = document.getElementById(rid);
    if (!el) { regions[rid] = null; continue; }
    const r = el.getBoundingClientRect();
    regions[rid] = { top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  }
  return JSON.stringify({
    innerW: window.innerWidth, innerH: window.innerHeight,
    playerText: (document.getElementById("player-bar")?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 120),
    dispatchText: (document.getElementById("dispatch-panel")?.innerText || "").replace(/\\s+/g, " ").trim().slice(0, 80),
    bodyChars: document.body.innerText.length,
    docScrollW: de.scrollWidth, docClientW: de.clientWidth,
    docScrollH: de.scrollHeight, docClientH: de.clientHeight,
    bodyScrollW: body.scrollWidth, bodyScrollH: body.scrollHeight,
    offenders: offenders.slice(0, 12),
    offenderCount: offenders.length,
    regions,
    externalUrls: [...document.querySelectorAll("[src],[href]")]
      .map((e) => e.getAttribute("src") || e.getAttribute("href"))
      .filter((u) => u && /^https?:\\/\\//.test(u) && !u.startsWith(location.origin)),
  });
})()`;

const { result } = await send("Runtime.evaluate", {
  expression: probe,
  returnByValue: true,
});
const data = JSON.parse(result.value);

const hScroll = data.docScrollW > data.docClientW;
const vScroll = data.docScrollH > data.docClientH;
// The single-screen contract only applies at the xl breakpoint (80rem) and up.
// Below it the panels deliberately stack and the page scrolls vertically; only
// the no-horizontal-scroll rule is universal.
const singleScreen = WIDTH >= 1280;

console.log(`viewport requested  ${WIDTH}x${HEIGHT}`);
console.log(`viewport actual     ${data.innerW}x${data.innerH}`);
console.log(`player              ${data.playerText}`);
console.log(`dispatch panel      ${data.dispatchText}`);
console.log(`rendered text chars ${data.bodyChars}`);
if (data.innerW !== WIDTH || data.innerH !== HEIGHT) {
  console.log("!! emulated viewport does not match the requested size");
}
console.log(
  `horizontal scroll   ${hScroll ? "FAIL" : "PASS"}  (scrollWidth ${data.docScrollW} vs clientWidth ${data.docClientW})`,
);
console.log(
  singleScreen
    ? `page vertical scroll ${vScroll ? "FAIL" : "PASS"}  (scrollHeight ${data.docScrollH} vs clientHeight ${data.docClientH})`
    : `page vertical scroll n/a   (below xl the page is meant to stack and scroll: ${data.docScrollH}px)`,
);
console.log(`elements past right edge: ${data.offenderCount}`);
for (const o of data.offenders) {
  console.log(`  <${o.tag}> #${o.id ?? "-"} right=${o.right} .${o.cls}`);
}
console.log(`external subresource URLs: ${data.externalUrls.length}`);
for (const u of data.externalUrls) console.log(`  ${u}`);
console.log("regions:");
const missing = [];
for (const [rid, box] of Object.entries(data.regions)) {
  if (!box) {
    missing.push(rid);
    console.log(`  ${rid.padEnd(20)} MISSING`);
  } else {
    const clipped =
      singleScreen && box.bottom > HEIGHT + 1 ? "  <-- BELOW THE FOLD" : "";
    console.log(
      `  ${rid.padEnd(20)} ${String(box.w).padStart(5)}x${String(box.h).padStart(4)} @ y ${box.top}..${box.bottom}${clipped}`,
    );
  }
}

await send("Page.captureScreenshot", { format: "png" })
  .then(async ({ data: png }) => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(profile, "..", "blaze-1920.png"), Buffer.from(png, "base64"));
    console.log(`screenshot: ${join(profile, "..", "blaze-1920.png")}`);
  })
  .catch(() => {});

ws.close();
child.kill();

const belowFold = Object.entries(data.regions).filter(
  ([, b]) => b && b.bottom > HEIGHT + 1,
);
const ok =
  !hScroll &&
  data.offenderCount === 0 &&
  missing.length === 0 &&
  data.externalUrls.length === 0 &&
  // Single-screen rules: only enforced at xl and up.
  (!singleScreen || (!vScroll && belowFold.length === 0));
console.log(ok ? "\nVIEWPORT CHECK: PASS" : "\nVIEWPORT CHECK: FAIL");
process.exit(ok ? 0 : 1);
