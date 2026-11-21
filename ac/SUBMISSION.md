# Transaction Guardian AI - Quai Orchard submission

## One-liner
A security layer that decodes transaction calldata into a human-readable manifest, scores its risk, and commits the approved intent on Quai. A smart contract (IntentGuard) only executes calldata that matches that commitment.

## Problem
WazirX, July 2024: signers approved a multisig transaction that looked different from what it did ($230M+). Wallets show hex; users click Confirm; signed transactions can't be reversed.

## What we built
1. **Decoder + manifest** (`engine/`): decodes ERC-20/721 approvals, permits, upgrades, ownership changes, and Safe `execTransaction` (including the nested inner call and DELEGATECALL). Unknown selectors are flagged, never guessed. Produces a canonical manifest, `manifestHash`, `calldataHash`.
2. **Deterministic risk scorer**: unlimited approval, setApprovalForAll, upgrade/admin change, delegatecall, unknown function, value limits. Score 0-100 with reasons. (An LLM explanation layer is optional and advisory only; the rules decide.)
3. **IntentGuard** (Solidity 0.8.20, EVM london, Quai toolchain: `quais`, `@quai/hardhat-deploy-metadata`): owner-only commit; target+selector allowlist; max value; expiry; exact calldata-hash match on execute; manifest hash bound to the commitment; single-use intents (replay blocked); reentrancy guard; common approval selectors default-denied.
4. **Demo page** (`demo/index.html`): wallet-view (raw hex) vs Guardian-view, risk badge, on-chain hashes, tamper simulation.

## Why the blockchain is essential
The binding between "what the user reviewed" and "what executes" is enforced on-chain by the contract. Remove the chain and an attacker can swap calldata after review with nothing to stop it.

## Verified results (real output)
- `npx hardhat compile`: OK (solc 0.8.20, evm london)
- `npx hardhat test`: **11 passing** (5 contract + 6 engine)
- `npx hardhat run scripts/demo-local.js` (local EVM, same Solidity):
  - execute committed calldata: success
  - replay: reverted (IntentNotFound)
  - tampered calldata 777->999: reverted (IntentMismatch)
  - unlimited approve(): reverted (DangerousApprovalBlocked)
  - non-allowlisted function: reverted (TargetNotAllowed)

## Quai Orchard deployment status
- Config targets Orchard Cyprus-1, chainId 15000, RPC `https://orchard.rpc.quai.network` (answers; verified by balance/block queries).
- Deployer testnet wallet: `0x0046C02D248D291cCf88ce4A63CD4bb4180eCD3b` (fresh, testnet only).
- **NOT YET DEPLOYED**: the wallet has 0 QUAI. The faucet in the docs (`orchard.faucet.quai.network`) does not resolve (NXDOMAIN), and the organizer note says faucet instructions are unverified. Needs test QUAI from organizers.
- When funded: `npm run deploy:orchard` then `npm run e2e:orchard` (both written, not yet run against the chain). Contract address and tx hashes will be saved to `deployments/orchard.json`. Do not claim a deployment until that file exists.

## Limitations (say these before the judges ask)
- The hash proves the reviewed manifest matches the calldata, not that the decoder is correct.
- Protection applies to transactions routed through IntentGuard; an EOA can still sign directly.
- No proxy-implementation verification, no limited-approval path (approvals are blocked outright), no audit, no multisig lifecycle yet.
- Risk scoring is rule-based and not benchmarked.

## Roadmap
SDK/API for wallets and exchanges; multisig integration (the WazirX case); limited-approval support; simulation; Pelagus signing flow via quais BrowserProvider.

## Run it
```
npm install
npx hardhat test
npx hardhat run scripts/demo-local.js
# open demo/index.html in Chrome
# after funding the wallet in .env:
npm run deploy:orchard && npm run e2e:orchard
```
Private keys live only in `.env` (gitignored). Never paste them into chats.

## 60-second pitch
"WazirX lost $230 million because signers approved a transaction that looked different from what it did. Wallets show hex. Guardian decodes it into plain English, even inside a multisig wrapper, scores the risk, and commits the approved intent on Quai. Our IntentGuard contract only executes calldata that matches that commitment, so a swapped payload reverts. Here, an unlimited approval is flagged HIGH and blocked, a tampered payload reverts with IntentMismatch, and replays fail. Next: an SDK for wallets and multisigs."
