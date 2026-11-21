// Local attack-vs-protection demo on the in-process Hardhat EVM (same Solidity as Orchard).
// Run: npx hardhat run scripts/demo-local.js
const hre = require("hardhat");
const { buildManifest, MAX_UINT } = require("../engine");

async function expectRevert(label, fn) {
  try { const r = await fn(); if (r && r.wait) await r.wait(); return { scenario: label, expected: "REVERT", actual: "EXECUTED (BAD)", ok: false }; }
  catch (e) { return { scenario: label, expected: "REVERT", actual: "REVERTED: " + (e.message.match(/custom error '([^']+)'/) || [, "ok"])[1], ok: true }; }
}

async function main() {
  const { ethers } = hre;
  const target = await (await ethers.getContractFactory("MockTarget")).deploy();
  const sel = target.interface.getFunction("setValue").selector;
  const guard = await (await ethers.getContractFactory("IntentGuard")).deploy([await target.getAddress()], [sel], 0);
  const to = await target.getAddress();
  const rows = [];

  const data = target.interface.encodeFunctionData("setValue", [777]);
  const m = buildManifest({ to, data, chainId: 31337 });
  console.log("Wallet shows   :", data);
  console.log("Guardian shows :", m.decoded.summary, "| risk", m.risk.level, m.risk.score);
  const deadline = (await ethers.provider.getBlock("latest")).timestamp + 3600;
  const commit = async () => {
    const rc = await (await guard.commitIntent(to, 0, data, m.manifestHash, deadline)).wait();
    return rc.logs.map((l) => { try { return guard.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "IntentCommitted").args.intentId;
  };

  const id1 = await commit();
  await (await guard.executeIntent(id1, data)).wait();
  rows.push({ scenario: "execute committed calldata", expected: "SUCCESS", actual: "value=" + (await target.value()), ok: (await target.value()) === 777n });
  rows.push(await expectRevert("replay executed intent", () => guard.executeIntent(id1, data)));
  const id2 = await commit();
  rows.push(await expectRevert("tampered calldata 777->999", () => guard.executeIntent(id2, target.interface.encodeFunctionData("setValue", [999]))));
  const evil = new ethers.Interface(["function approve(address,uint256)"]).encodeFunctionData("approve", ["0x" + "22".repeat(20), MAX_UINT]);
  rows.push(await expectRevert("unlimited approve()", () => guard.commitIntent(to, 0, evil, ethers.ZeroHash, deadline)));
  const other = target.interface.encodeFunctionData("setOther", [5]);
  rows.push(await expectRevert("non-allowlisted function", () => guard.commitIntent(to, 0, other, ethers.ZeroHash, deadline)));

  console.table(rows);
  if (!rows.every((r) => r.ok)) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; });
