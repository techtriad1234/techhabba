// Deploys MockTarget + IntentGuard to Quai Orchard (Cyprus-1, chainId 15000) with quais + IPFS metadata.
// Run: npx hardhat run scripts/deploy-orchard.js --network orchard
const fs = require("fs");
const hre = require("hardhat");
const quais = require("quais");

async function main() {
  const rpc = process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network";
  const pk = process.env.QUAI_PRIVATE_KEY;
  if (!pk) throw new Error("QUAI_PRIVATE_KEY missing in .env (run: node scripts/newwallet.js)");

  const provider = new quais.JsonRpcProvider(rpc, undefined, { usePathing: true });
  const wallet = new quais.Wallet(pk, provider);
  const bal = await provider.getBalance(wallet.address);
  console.log("Deployer:", wallet.address, "balance:", quais.formatQuai(bal), "QUAI");
  if (bal === 0n) throw new Error("Deployer has 0 QUAI. Fund " + wallet.address + " from the Orchard faucet first.");

  const deployOne = async (name, args) => {
    const artifact = await hre.artifacts.readArtifact(name);
    const ipfsHash = await hre.deployMetadata.pushMetadataToIPFS(name);
    const factory = new quais.ContractFactory(artifact.abi, artifact.bytecode, wallet, ipfsHash);
    const c = await factory.deploy(...args);
    const tx = c.deploymentTransaction();
    await c.waitForDeployment();
    console.log(name, "deployed:", await c.getAddress(), "tx:", tx.hash);
    return { address: await c.getAddress(), txHash: tx.hash, ipfsHash, abi: artifact.abi };
  };

  const target = await deployOne("MockTarget", []);
  const selector = new quais.Interface(target.abi).getFunction("setValue").selector;
  const guard = await deployOne("IntentGuard", [[target.address], [selector], BigInt(process.env.MAX_CALL_VALUE || "0")]);

  fs.mkdirSync("deployments", { recursive: true });
  fs.writeFileSync("deployments/orchard.json", JSON.stringify({
    network: "Quai Orchard Cyprus-1", chainId: 15000, deployer: wallet.address, selector,
    MockTarget: { address: target.address, txHash: target.txHash, ipfsHash: target.ipfsHash },
    IntentGuard: { address: guard.address, txHash: guard.txHash, ipfsHash: guard.ipfsHash },
    explorer: "https://orchard.quaiscan.io/address/" + guard.address,
  }, null, 2));
  console.log("Saved deployments/orchard.json");
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
