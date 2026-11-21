// End-to-end attack-vs-protection demo against the DEPLOYED Orchard contracts.
// Run (after deploy): node scripts/e2e-orchard.js
require("dotenv").config();
const fs = require("fs");
const quais = require("quais");
const { ethers } = require("ethers");
const { buildManifest, MAX_UINT } = require("../engine");

async function expectRevert(label, fn) {
  try { const r = await fn(); await (r.wait ? r.wait() : r); return { label, expected: "REVERT", actual: "EXECUTED (BAD)", ok: false }; }
  catch (e) { return { label, expected: "REVERT", actual: "REVERTED", ok: true }; }
}

(async () => {
  const dep = JSON.parse(fs.readFileSync("deployments/orchard.json", "utf8"));
  const art = JSON.parse(fs.readFileSync("artifacts/contracts/IntentGuard.sol/IntentGuard.json", "utf8"));
  const tart = JSON.parse(fs.readFileSync("artifacts/contracts/MockTarget.sol/MockTarget.json", "utf8"));
  const provider = new quais.JsonRpcProvider(process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network", undefined, { usePathing: true });
  const wallet = new quais.Wallet(process.env.QUAI_PRIVATE_KEY, provider);
  const guard = new quais.Contract(dep.IntentGuard.address, art.abi, wallet);
  const target = new quais.Contract(dep.MockTarget.address, tart.abi, wallet);
  const tiface = new ethers.Interface(tart.abi);
  const rows = [];

  // 1. Honest flow: decode -> manifest -> commit -> execute
  const data = tiface.encodeFunctionData("setValue", [777]);
  const m = buildManifest({ to: dep.MockTarget.address, data });
  console.log("Wallet would show:", data);
  console.log("Guardian shows   :", m.decoded.summary, "| risk", m.risk.level, m.risk.score);
  const deadline = Math.floor(Date.now() / 1000) + 3600;
  const ctx = await guard.commitIntent(dep.MockTarget.address, 0, data, m.manifestHash, deadline);
  const rc = await ctx.wait();
  const ev = rc.logs.map((l) => { try { return guard.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "IntentCommitted");
  console.log("Committed intent tx:", ctx.hash);
  const etx = await guard.executeIntent(ev.args.intentId, data);
  await etx.wait();
  rows.push({ label: "execute committed calldata", expected: "SUCCESS", actual: "value=" + (await target.value()), ok: (await target.value()) === 777n, tx: etx.hash });

  // 2. Replay of the same intent
  rows.push(await expectRevert("replay executed intent", () => guard.executeIntent(ev.args.intentId, data)));

  // 3. Tampered calldata (attacker swaps 777 -> 999 after review)
  const ctx2 = await guard.commitIntent(dep.MockTarget.address, 0, data, m.manifestHash, deadline);
  const rc2 = await ctx2.wait();
  const ev2 = rc2.logs.map((l) => { try { return guard.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "IntentCommitted");
  rows.push(await expectRevert("tampered calldata (777 -> 999)", () => guard.executeIntent(ev2.args.intentId, tiface.encodeFunctionData("setValue", [999]))));

  // 4. Unlimited approval attempt
  const evil = new ethers.Interface(["function approve(address,uint256)"]).encodeFunctionData("approve", ["0x" + "22".repeat(20), MAX_UINT]);
  rows.push(await expectRevert("unlimited approve() commit", () => guard.commitIntent(dep.MockTarget.address, 0, evil, ethers.ZeroHash, deadline)));

  console.table(rows);
  process.exitCode = rows.every((r) => r.ok) ? 0 : 1;
})().catch((e) => { console.error(e); process.exitCode = 1; });
