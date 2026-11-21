const { expect } = require("chai");
const { ethers } = require("ethers");
const { buildManifest, MAX_UINT } = require("../engine");
const erc = new ethers.Interface(["function approve(address,uint256)", "function setApprovalForAll(address,bool)", "function upgradeToAndCall(address,bytes)", "function transfer(address,uint256)"]);
const safe = new ethers.Interface(["function execTransaction(address,uint256,bytes,uint8,uint256,uint256,uint256,address,address,bytes)"]);
const A = "0x1111111111111111111111111111111111111111", B = "0x2222222222222222222222222222222222222222";

describe("Guardian engine", () => {
  it("flags unlimited approval as HIGH", () => {
    const m = buildManifest({ to: A, data: erc.encodeFunctionData("approve", [B, MAX_UINT]) });
    expect(m.risk.level).to.equal("HIGH");
    expect(m.decoded.summary).to.contain("UNLIMITED");
  });
  it("limited approval is only LOW", () => {
    expect(buildManifest({ to: A, data: erc.encodeFunctionData("approve", [B, 100]) }).risk.level).to.equal("LOW");
  });
  it("flags setApprovalForAll(true)", () => {
    expect(buildManifest({ to: A, data: erc.encodeFunctionData("setApprovalForAll", [B, true]) }).risk.level).to.equal("HIGH");
  });
  it("WazirX-style: Safe execTransaction hiding a delegatecall upgrade is HIGH and exposes the inner call", () => {
    const inner = erc.encodeFunctionData("upgradeToAndCall", [B, "0x"]);
    const data = safe.encodeFunctionData("execTransaction", [A, 0, inner, 1, 0, 0, 0, ethers.ZeroAddress, ethers.ZeroAddress, "0x"]);
    const m = buildManifest({ to: A, data });
    expect(m.risk.level).to.equal("HIGH");
    expect(m.decoded.summary).to.contain("DELEGATECALL");
    expect(m.decoded.summary).to.contain("REPLACE");
  });
  it("unknown selector is flagged, not guessed", () => {
    const m = buildManifest({ to: A, data: "0xdeadbeef" });
    expect(m.decoded.fn).to.equal("UNKNOWN");
    expect(m.risk.score).to.be.greaterThan(0);
  });
  it("manifest hash is deterministic and sensitive to calldata", () => {
    const d1 = erc.encodeFunctionData("transfer", [B, 1]), d2 = erc.encodeFunctionData("transfer", [B, 2]);
    expect(buildManifest({ to: A, data: d1 }).manifestHash).to.equal(buildManifest({ to: A, data: d1 }).manifestHash);
    expect(buildManifest({ to: A, data: d1 }).manifestHash).to.not.equal(buildManifest({ to: A, data: d2 }).manifestHash);
  });
});
