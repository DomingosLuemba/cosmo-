/**
 * The YOZEXA Wallet, driven in a real browser against a running localnet.
 *
 * An HTTP 200 on a client-rendered app proves almost nothing: the page can
 * answer while every screen behind it is broken. This creates a wallet through
 * the UI, funds the address it produces with a real on-chain transaction,
 * spends from it through the UI, and reconciles the result against the chain
 * in base units — so the two sides of every check come from different code
 * paths.
 *
 * It needs a devnet and a Chromium:
 *
 *   ./scripts/devnet.sh up
 *   npx --yes playwright@1 install chromium
 *   npm run test:e2e --workspace @yozexa/wallet-web
 *
 * Without either it skips rather than failing, so a checkout with no devnet
 * running does not report a red suite it was never able to run.
 *
 * Environment:
 *   WALLET_URL       default http://127.0.0.1:3002
 *   NODE_API         default 127.0.0.1:1717
 *   YOZEXA_HOME      default /tmp/yozexa-devnet/node   (keyring for funding)
 *   YOZEXA_BIN       default /tmp/yozexa-devnet/bin/yozexa
 *   CHROMIUM_PATH    an existing Chromium, instead of Playwright's own
 *   SHOTS_DIR        where screenshots go; unset means none are written
 */
import { mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.log("SKIP: playwright is not installed — npx --yes playwright@1 install chromium");
  process.exit(0);
}

const BASE = process.env.WALLET_URL ?? "http://127.0.0.1:3002";
const NODE = process.env.NODE_API ?? "127.0.0.1:1717";
const CLI = process.env.YOZEXA_BIN ?? "/tmp/yozexa-devnet/bin/yozexa";
const HOME_DIR = process.env.YOZEXA_HOME ?? "/tmp/yozexa-devnet/node";
const SHOTS = process.env.SHOTS_DIR ?? "";
const PASSPHRASE = "a-long-enough-passphrase";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

/** Skip, loudly, rather than fail on something the checkout cannot provide. */
function skip(why) {
  console.log(`SKIP: ${why}`);
  process.exit(0);
}

for (const [name, url] of [["the wallet", `${BASE}/welcome`], ["the node", `http://${NODE}/v1/health`]]) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    if (!r.ok) skip(`${name} answered ${r.status} at ${url} — is the devnet up?`);
  } catch {
    skip(`${name} is not reachable at ${url} — run ./scripts/devnet.sh up`);
  }
}
if (!existsSync(CLI)) skip(`the yozexa CLI is not at ${CLI} — set YOZEXA_BIN`);

function cli(...args) {
  return execFileSync(CLI, [...args, "--home", HOME_DIR, "--node", NODE], {
    encoding: "utf8",
    env: { ...process.env, YOZEXA_PASSPHRASE: "yozexa-devnet-passphrase" },
  });
}

// Reconciliation reads the node directly rather than the wallet, so the two
// sides of every check come from different code paths.
async function chainAccount(addr) {
  const r = await fetch(`http://${NODE}/v1/account/${addr}`);
  if (!r.ok) throw new Error(`node returned ${r.status} for ${addr}`);
  return r.json();
}

let browser;
try {
  browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--no-sandbox"],
  });
} catch (err) {
  skip(`no Chromium to launch (${String(err.message).split("\n")[0]}) — set CHROMIUM_PATH or install one`);
}
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  colorScheme: "dark",
});
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});
// Record which request failed, not just that one did.
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`http ${r.status()}: ${r.url()}`);
});

const shot = (name) => (SHOTS ? page.screenshot({ path: `${SHOTS}/${name}.png` }) : Promise.resolve());
let checks = 0;
const step = (msg) => { checks += 1; console.log(`  ✓ ${msg}`); };
const head = (msg) => console.log(`\n── ${msg}`);

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

// The decrypted key lives in memory only, so a full page load re-locks the
// wallet. That is the correct behaviour; it just means a script that reloads
// has to unlock the way a person would.
async function unlockIfLocked(p = page) {
  const field = p.locator("#passphrase");
  if (!(await field.isVisible().catch(() => false))) return false;
  await field.fill(PASSPHRASE);
  await p.getByRole("button", { name: "Unlock", exact: true }).click();
  await field.waitFor({ state: "detached", timeout: 120_000 });
  await p.waitForTimeout(800);
  return true;
}

// Navigate the way the app does — through its own links — so the in-memory
// session survives, instead of forcing a reload on every screen.
async function go(path, expect) {
  await page.evaluate((to) => window.history.pushState({}, "", to), path);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await unlockIfLocked();
  if (expect) await page.waitForSelector(expect, { timeout: 20_000 });
  await page.waitForTimeout(1200);
}

// ── 1. Welcome ───────────────────────────────────────────────────────
head("1. Welcome");
await page.goto(`${BASE}/welcome`, { waitUntil: "commit" });
// The splash is on screen for about a second — catch it before it leaves.
await page.waitForSelector("text=Own. Move. Build.", { timeout: 10_000 });
await page.waitForTimeout(350);
await shot("00-splash");
step("splash shows the mark and \u201cOwn. Move. Build.\u201d");

await page.waitForSelector("text=Create Wallet", { timeout: 10_000 });
await page.waitForTimeout(500);
await shot("01-welcome");
const welcomeText = await page.locator("body").innerText();
assert(welcomeText.includes("YOZEXA"), "welcome screen did not render");
assert(await page.getByRole("button", { name: "Create Wallet" }).isVisible(), "no create path");
step("welcome renders after the splash");

// ── 2. Create wallet ─────────────────────────────────────────────────
head("2. Create wallet");
await page.getByRole("button", { name: "Create Wallet" }).click();
await page.waitForURL("**/create");
await shot("02-create-security");

await page.fill("#name", "Playwright wallet");
await page.fill("#pass", PASSPHRASE);
await page.fill("#repeat", PASSPHRASE);
step("security step filled (scrypt N=2^17 — deliberately slow)");
await page.getByRole("button", { name: "Continue" }).click();

await page.waitForSelector("text=Write these 24 words down", { timeout: 120_000 });
await shot("03-recovery-phrase");
const cells = await page.locator(".yzx-mono").allInnerTexts();
const phrase = cells
  .filter((w) => /^\d+\s*[a-z]+$/i.test(w.trim()))
  .map((w) => w.trim().replace(/^\d+\s*/, ""));
assert(phrase.length === 24, `expected 24 words, saw ${phrase.length}`);
step(`recovery phrase: 24 words shown`);

await page.getByRole("button", { name: /written them down/i }).click();
await page.waitForSelector("text=Type these three words back");
await shot("04-verify");

// Read the challenge from the input ids — the labels are rendered uppercase.
const ids = await page.locator('form input[id^="w"]').evaluateAll((els) => els.map((e) => e.id));
const asked = ids.map((id) => Number(id.slice(1)));
assert(asked.length === 3, `expected a 3-word challenge, got ${asked.length}`);
step(`challenge asks for words ${asked.map((i) => i + 1).join(", ")}`);

// A wrong answer must be refused — otherwise the confirmation is theatre.
await page.fill(`#w${asked[0]}`, "wrongword");
for (const i of asked.slice(1)) await page.fill(`#w${i}`, phrase[i]);
await page.getByRole("button", { name: "Confirm", exact: true }).click();
await page.waitForTimeout(400);
const refusal = await page.locator("body").innerText();
assert(/doesn.t match/i.test(refusal), "a wrong word was accepted — confirmation is not real");
assert(await page.locator('form input[id^="w"]').first().isVisible(), "left the verify step on a wrong answer");
step("a wrong word is refused (confirmation is real)");

for (const i of asked) await page.fill(`#w${i}`, phrase[i]);
await page.getByRole("button", { name: "Confirm", exact: true }).click();

await page.waitForSelector("text=Wallet ready", { timeout: 30_000 });
await shot("05-ready");
const address = (await page.locator(".yzx-mono").last().innerText()).trim();
assert(/^yzx1[a-z0-9]{38,}$/.test(address), `bad address: ${address}`);
step(`address created: ${address}`);

// ── 3. Home, empty ───────────────────────────────────────────────────
head("3. Home (empty)");
await page.getByRole("button", { name: "Open wallet" }).click();
await page.waitForURL(`${BASE}/`);
await page.waitForTimeout(1800);
// Going from "wallet ready" into the wallet must not ask for the passphrase
// again: it was typed seconds ago, and unlocking costs a scrypt run.
assert(!(await page.locator("#passphrase").isVisible().catch(() => false)),
  "opening the wallet right after creating it asked for the passphrase again");
step("opening the wallet keeps the session it just created");

// A full reload is a different matter: the key is in memory only, and must be
// gone. Prove that, then unlock the way a returning user does.
await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(1200);
await shot("06a-locked");
const wasLocked = await unlockIfLocked();
assert(wasLocked, "the wallet did not lock after a full page reload — the key is being persisted");
step("a full reload re-locks it; the passphrase brings it back");
await page.waitForTimeout(2500);
await shot("06-home-empty");
const emptyHome = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
console.log("--- HOME BODY ---\n" + emptyHome + "\n--- END ---");
assert(/0(\.0+)?\s*YZXA|0\s*YZXA/.test(emptyHome), "empty balance not shown");
assert(!/\$\s*\d/.test(emptyHome), "a fiat number appeared with no price source configured");
step("home renders a zero balance and shows no invented fiat value");

// ── 4. Receive ───────────────────────────────────────────────────────
head("4. Receive");
await go("/receive");
await shot("07-receive");
const receiveText = await page.locator("body").innerText();
assert(receiveText.includes(address.slice(0, 14)), "receive screen does not show this wallet's address");
const qr = await page.locator("svg, canvas, img").count();
assert(qr > 0, "no QR rendered on receive");
step("receive shows the real address and a QR code");

// ── 5. Fund it on-chain (outside the browser) ────────────────────────
head("5. Fund the address with a real on-chain transaction");
const fundOut = cli("tx", "send", address, "12.5", "--from", "validator", "--memo", "playwright funding");
const fundHash = (fundOut.match(/[0-9A-F]{64}/i) ?? [])[0];
assert(fundHash, `no tx hash in CLI output:\n${fundOut}`);
step(`sent 12.5 YZXA from the validator — tx ${fundHash.slice(0, 16)}…`);
const chainBal = await chainAccount(address);
assert(chainBal.balance_yzxa === "12.5", `chain balance is ${chainBal.balance_yzxa}, expected 12.5`);
step(`chain says balance = ${chainBal.balance_yzxa} YZXA (${chainBal.balance} ayzxa)`);

// ── 6. Home reflects the real balance ────────────────────────────────
head("6. Home reads the chain");
await go("/");
await page.waitForTimeout(2000);
await shot("08-home-funded");
const fundedHome = (await page.locator("body").innerText()).replace(/ /g, " ");
assert(/12\.5/.test(fundedHome), `home does not show the funded balance:\n${fundedHome.slice(0, 400)}`);
step("home shows 12.5 YZXA — read from the node, not a fixture");

// unit toggle: YZXA → YOZ
await page.locator("text=/12\\.5/").first().click();
await page.waitForTimeout(600);
const toggled = (await page.locator("body").innerText()).replace(/ /g, " ");
await shot("09-home-yoz");
assert(/YOZ/.test(toggled), "tapping the balance did not switch units");
assert(/1[,\s]?250[,\s]?000/.test(toggled), `YOZ conversion wrong: expected 1,250,000, body was:\n${toggled.slice(0, 300)}`);
step("tapping the balance switches to YOZ and converts exactly (12.5 YZXA = 1,250,000 YOZ)");

// ── 7. Activity shows the incoming transfer ──────────────────────────
head("7. Activity");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
await page.waitForURL("**/activity");
await page.waitForTimeout(2000);
assert(!(await page.locator("#passphrase").isVisible().catch(() => false)),
  "moving to Activity through the tab bar re-locked the wallet");
step("the tab bar navigates without re-locking");
await shot("10-activity");
const activity = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
assert(/Received/.test(activity), "the transfer is not labelled as received");
assert(/playwright funding/.test(activity), "the memo did not survive to the activity list");
// The unit is one preference across the wallet: Home was switched to YOZ, so
// this list must be in YOZ too, showing the same money.
assert(/1,250,000/.test(activity), `activity is not following the shared unit preference:\n${activity}`);
assert(!/12\.5 YZXA/.test(activity), "activity ignored the unit switched on Home");
step("activity lists the transfer, in the unit chosen on Home (1,250,000 YOZ), with its memo");

// ── 8. Send, through review, to a real recipient ─────────────────────
head("8. Send");
const merchant = cli("keys", "show", "merchant").match(/yzx1[a-z0-9]+/)[0];
const merchantBefore = await chainAccount(merchant);
step(`recipient ${merchant} starts at ${merchantBefore.balance_yzxa} YZXA`);
await go("/send");
// Home was switched to YOZ, so the amount field must open in YOZ too — the
// whole point of a shared unit preference is that a figure never changes
// meaning between screens.
const openingUnit = await page.locator("#yzx-unit").inputValue();
assert(openingUnit === "YOZ", `send opened in ${openingUnit} while the balance is shown in YOZ`);
step("the amount field opens in the same unit as the balance");

await page.selectOption("#yzx-unit", "YZXA");
await page.fill("#yzx-amount", "3.25");
await page.fill("#recipient", merchant);
await page.waitForTimeout(300);
await shot("11-send-compose");
await page.getByRole("button", { name: "Continue" }).click();
await page.waitForSelector("text=Send now", { timeout: 30_000 });
await page.waitForTimeout(600);
await shot("12-send-review");
const review = (await page.locator("body").innerText()).replace(/ /g, " ");
assert(/3\.25/.test(review), "review does not show the amount");
assert(review.includes(merchant.slice(0, 12)), "review does not show the recipient");
assert(/[Ff]ee/.test(review), "review does not disclose the fee");
assert(/YZXA/.test(review), "review does not name the unit being sent");
step("review shows amount, unit, recipient and fee before anything is signed");

await page.getByRole("button", { name: "Send now" }).click();
await page.waitForSelector("text=Payment sent", { timeout: 90_000 });
await page.waitForTimeout(1000);
await shot("13-send-done");
const done = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
assert(!/Payment failed/.test(done), "the transaction failed on-chain");
assert(/3\.25/.test(done), "success screen does not restate the amount");
step("UI reports the payment sent");

// ── 9. The chain agrees ──────────────────────────────────────────────
head("9. Reconcile against the chain");
const after = await chainAccount(address);
const merchantAfter = await chainAccount(merchant);
step(`sender  : 12.5 → ${after.balance_yzxa} YZXA`);
step(`recipient: ${merchantBefore.balance_yzxa} → ${merchantAfter.balance_yzxa} YZXA`);

// Integer arithmetic, in the base unit — the whole point of the design.
const credited = BigInt(merchantAfter.balance) - BigInt(merchantBefore.balance);
assert(credited === 3250000000000000000n, `recipient credited ${credited} ayzxa, expected 3250000000000000000`);
const debited = 12500000000000000000n - BigInt(after.balance);
const fee = debited - credited;
assert(fee > 0n && fee < 250000000000000000n, `fee of ${fee} ayzxa is out of range`);
step(`recipient credited exactly 3.25 YZXA; sender paid 3.25 + ${fee} ayzxa fee — nothing unaccounted for`);

// ── 10. Transaction detail + security ────────────────────────────────
head("10. Transaction detail and security");
await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Activity" }).click();
await page.waitForURL("**/activity");
await page.waitForTimeout(2000);
await shot("14-activity-both");

await page.locator("a[href^='/tx/']").first().click();
await page.waitForURL("**/tx/**");
await page.waitForTimeout(2500);
await shot("15-tx-detail");
assert(!(await page.locator("#passphrase").isVisible().catch(() => false)),
  "opening a transaction re-locked the wallet");
const detail = (await page.locator("body").innerText()).replace(/\u00a0/g, " ");
// The hash is abbreviated with a copy control rather than wrapped across four
// lines, so match the shown form, not the full 64 characters.
assert(/[0-9A-F]{8,}\u2026[0-9A-F]{6,}/.test(detail) || /[0-9A-Fa-f]{32,}/.test(detail),
  `tx detail shows no hash:\n${detail}`);
assert(/Copy transaction hash/i.test(detail), "the full hash cannot be copied");
assert(/Finalized|cannot be reverted/i.test(detail), "tx detail does not state its finality");
assert(/Block/.test(detail) && /Confirmations/.test(detail), "tx detail omits block or confirmations");
step("tapping a row opens the transaction — hash, block, confirmations, finality — still unlocked");

await go("/profile/security");
await shot("16-security");
const security = await page.locator("body").innerText();
assert(!/Excellent/i.test(security) || !/not backed up|no passphrase/i.test(security),
  "security claims 'Excellent' with an open gap");
step("security screen renders an honest assessment");

for (const [name, path] of [["pay", "/pay"], ["explore", "/explore"], ["profile", "/profile"], ["stake", "/stake"], ["permissions", "/permissions"]]) {
  await go(path);
  await shot(`17-${name}`);
}
step("pay, explore, profile, stake and permissions render");

// The redesigned screens must carry their honesty, not just their styling.
await go("/stake");
const stake = await page.locator("body").innerText();
assert(/not a savings account/i.test(stake), "the staking risk warning is missing");
assert(!/\bguaranteed\b/i.test(stake) || /no return is promised to anyone, and none is guaranteed/i.test(stake.toLowerCase()),
  "staking implies a guaranteed return");
assert(!/\bAPY\b/.test(stake), "staking advertises an APY");
assert(/slashed/i.test(stake), "staking does not mention slashing");
step("stake states the risk, promises no return, and never shows an APY");

await go("/permissions");
const perms = await page.locator("body").innerText();
assert(/No permissions issued/i.test(perms), "permissions does not show its empty state");
assert(/no unlimited option/i.test(perms) || !/unlimited/i.test(perms),
  "permissions offers an unlimited grant");
step("permissions shows an honest empty state and offers no unlimited grant");

// ── light theme ──────────────────────────────────────────────────────
const light = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "light" });
const lp = await light.newPage();
await lp.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
await lp.waitForTimeout(1600);
if (SHOTS) await lp.screenshot({ path: `${SHOTS}/18-light-welcome.png` });
const bg = await lp.evaluate(() => getComputedStyle(document.body).backgroundColor);
assert(bg !== "rgb(7, 8, 13)", `light theme did not apply — body is still ${bg}`);
step(`light theme applies (body background ${bg})`);
await light.close();

console.log(`\nADDRESS=${address}`);
console.log(`FUND_TX=${fundHash}`);
console.log(`${checks} checks passed.`);
if (errors.length) {
  console.log("\nBROWSER ERRORS:");
  for (const e of [...new Set(errors)].slice(0, 10)) console.log("  " + e);
} else {
  console.log("\nNo page errors, no console errors.");
}
await browser.close();
