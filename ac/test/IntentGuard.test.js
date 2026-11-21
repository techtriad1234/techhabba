const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("IntentGuard", function () {
  async function fixture() {
    const [owner, other] = await ethers.getSigners();
    const Target = await ethers.getContractFactory("MockTarget");
    const target = await Target.deploy();
    const selector = target.interface.getFunction("setValue").selector;
    const Guard = await ethers.getContractFactory("IntentGuard");
    const guard = await Guard.deploy([await target.getAddress()], [selector], 0);
    return { owner, other, target, guard, selector };
  }

  it("commits and executes exactly the committed calldata", async function () {
    const { target, guard } = await fixture();
    const data = target.interface.encodeFunctionData("setValue", [42]);
    const manifestHash = ethers.keccak256(ethers.toUtf8Bytes("set target value to 42"));
    const block = await ethers.provider.getBlock("latest");
    const deadline = block.timestamp + 600;
    const tx = await guard.commitIntent(await target.getAddress(), 0, data, manifestHash, deadline);
    const receipt = await tx.wait();
    const event = receipt.logs.map((x) => { try { return guard.interface.parseLog(x); } catch { return null; } })
      .find((x) => x && x.name === "IntentCommitted");
    await guard.executeIntent(event.args.intentId, data);
    expect(await target.value()).to.equal(42);
  });

  it("rejects altered calldata", async function () {
    const { target, guard } = await fixture();
    const data = target.interface.encodeFunctionData("setValue", [42]);
    const altered = target.interface.encodeFunctionData("setValue", [43]);
    const block = await ethers.provider.getBlock("latest");
    const tx = await guard.commitIntent(await target.getAddress(), 0, data, ethers.ZeroHash, block.timestamp + 600);
    const receipt = await tx.wait();
    const event = receipt.logs.map((x) => { try { return guard.interface.parseLog(x); } catch { return null; } })
      .find((x) => x && x.name === "IntentCommitted");
    await expect(guard.executeIntent(event.args.intentId, altered)).to.be.revertedWithCustomError(guard, "IntentMismatch");
  });

  it("rejects a non-allowlisted selector", async function () {
    const { target, guard } = await fixture();
    const data = target.interface.encodeFunctionData("setOther", [7]);
    const block = await ethers.provider.getBlock("latest");
    await expect(guard.commitIntent(await target.getAddress(), 0, data, ethers.ZeroHash, block.timestamp + 600))
      .to.be.revertedWithCustomError(guard, "TargetNotAllowed");
  });

  it("blocks common unlimited-approval entry points even if allowlisted", async function () {
    const [owner] = await ethers.getSigners();
    const Target = await ethers.getContractFactory("MockTarget");
    const target = await Target.deploy();
    const approvalSelector = ethers.id("approve(address,uint256)").slice(0, 10);
    const Guard = await ethers.getContractFactory("IntentGuard");
    const guard = await Guard.deploy([await target.getAddress()], [approvalSelector], 0);
    const data = ethers.concat([approvalSelector, ethers.zeroPadValue(owner.address, 32), ethers.zeroPadValue("0xffff", 32)]);
    const block = await ethers.provider.getBlock("latest");
    await expect(guard.commitIntent(await target.getAddress(), 0, data, ethers.ZeroHash, block.timestamp + 600))
      .to.be.revertedWithCustomError(guard, "DangerousApprovalBlocked");
  });

  it("rejects callers other than the owner", async function () {
    const { target, guard, other } = await fixture();
    const data = target.interface.encodeFunctionData("setValue", [42]);
    const block = await ethers.provider.getBlock("latest");
    await expect(guard.connect(other).commitIntent(await target.getAddress(), 0, data, ethers.ZeroHash, block.timestamp + 600))
      .to.be.revertedWithCustomError(guard, "NotOwner");
  });
});

// Minimal target used only by the local test suite.
