require("@nomicfoundation/hardhat-toolbox");
require("@quai/hardhat-deploy-metadata");
require("dotenv").config();

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: { enabled: true, runs: 1000 },
      evmVersion: "london",
      metadata: { bytecodeHash: "ipfs" }, // required by Quai deploy-metadata plugin
    },
  },
  networks: {
    orchard: {
      url: process.env.QUAI_RPC_URL || "https://orchard.rpc.quai.network",
      chainId: 15000,
      accounts: process.env.QUAI_PRIVATE_KEY ? [process.env.QUAI_PRIVATE_KEY] : [],
    },
  },
};
