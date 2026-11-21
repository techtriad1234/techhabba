// Transaction Guardian engine: decode calldata -> human manifest -> deterministic risk score -> hashes.
const { ethers } = require("ethers");

const MAX_UINT = (1n << 256n) - 1n;
const ABI = [
  "function approve(address spender, uint256 amount)",
  "function increaseAllowance(address spender, uint256 added)",
  "function transfer(address to, uint256 amount)",
  "function transferFrom(address from, address to, uint256 amount)",
  "function setApprovalForAll(address operator, bool approved)",
  "function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)",
  "function upgradeTo(address newImplementation)",
  "function upgradeToAndCall(address newImplementation, bytes data)",
  "function changeAdmin(address newAdmin)",
  "function transferOwnership(address newOwner)",
  "function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures)",
  "function setValue(uint256 v)",
  "function setOther(uint256 v)",
];
const iface = new ethers.Interface(ABI);
const short = (x) => String(x).slice(0, 8) + "..." + String(x).slice(-4);

function describe(name, a, nestedSummary) {
  switch (name) {
    case "approve":
    case "increaseAllowance":
      return a[1] === MAX_UINT
        ? `Allow ${short(a[0])} to spend UNLIMITED of your tokens`
        : `Allow ${short(a[0])} to spend up to ${a[1]} token units`;
    case "setApprovalForAll":
      return a[1] ? `Give ${short(a[0])} control over ALL your NFTs in this collection` : `Revoke ${short(a[0])} control over your NFTs`;
    case "permit": return `Signed permit allowing ${short(a[1])} to spend ${a[2] === MAX_UINT ? "UNLIMITED" : a[2]} tokens`;
    case "transfer": return `Send ${a[1]} token units to ${short(a[0])}`;
    case "transferFrom": return `Move ${a[2]} token units from ${short(a[0])} to ${short(a[1])}`;
    case "upgradeTo": return `REPLACE this contract's code with the logic at ${short(a[0])}`;
    case "upgradeToAndCall": return `REPLACE this contract's code with ${short(a[0])} and run extra code`;
    case "changeAdmin": return `Hand ADMIN control to ${short(a[0])}`;
    case "transferOwnership": return `Hand OWNERSHIP to ${short(a[0])}`;
    case "execTransaction": {
      const op = Number(a[3]) === 1 ? " via DELEGATECALL (runs foreign code with the wallet's authority)" : "";
      return `Multisig executes${op}: [${nestedSummary}] on ${short(a[0])}`;
    }
    case "setValue": return `Set demo value to ${a[0]}`;
    case "setOther": return `Set demo 'other' value to ${a[0]}`;
    default: return name;
  }
}

function decode({ to, value = 0n, data, _depth = 0 }) {
  const out = { to, value: BigInt(value).toString(), selector: (data || "0x").slice(0, 10), fn: null, args: [], summary: "", nested: null };
  if (!data || data === "0x") { out.fn = "nativeTransfer"; out.summary = `Send ${value} wei to ${to}`; return out; }
  let parsed;
  try { parsed = iface.parseTransaction({ data }); } catch { parsed = null; }
  if (!parsed) { out.fn = "UNKNOWN"; out.summary = `Unknown function ${out.selector} on ${to} (cannot be explained)`; return out; }
  out.fn = parsed.name;
  const raw = Array.from(parsed.args);
  out.args = raw.map((x) => (typeof x === "bigint" ? x.toString() : String(x)));
  let nestedSummary = "";
  if (parsed.name === "execTransaction" && _depth < 3) {
    out.nested = decode({ to: raw[0], value: raw[1], data: raw[2], _depth: _depth + 1 });
    out.delegatecall = Number(raw[3]) === 1;
    nestedSummary = out.nested.summary;
  }
  out.summary = describe(parsed.name, raw, nestedSummary);
  return out;
}

function flatten(d) { return d.nested ? [d, ...flatten(d.nested)] : [d]; }

function score(d, opts = {}) {
  const reasons = []; let s = 0;
  const add = (pts, why) => { s += pts; reasons.push(`+${pts} ${why}`); };
  for (const x of flatten(d)) {
    if (["approve", "increaseAllowance"].includes(x.fn) && BigInt(x.args[1]) === MAX_UINT) add(60, "unlimited token approval");
    else if (["approve", "increaseAllowance"].includes(x.fn)) add(15, "token spending approval");
    if (x.fn === "setApprovalForAll" && x.args[1] === "true") add(60, "blanket NFT approval (setApprovalForAll)");
    if (x.fn === "permit") add(40, "permit signature can grant spending rights");
    if (["upgradeTo", "upgradeToAndCall", "changeAdmin"].includes(x.fn)) add(70, "contract code/admin replacement");
    if (x.fn === "transferOwnership") add(55, "ownership transfer");
    if (x.delegatecall) add(70, "DELEGATECALL executes external code with wallet authority");
    if (x.fn === "UNKNOWN") add(30, "unknown function: cannot be decoded");
    if (x.fn === "execTransaction") add(10, "multisig wrapper hides the inner call from signers");
    if (opts.maxSafeWei !== undefined && BigInt(x.value) > BigInt(opts.maxSafeWei)) add(25, "value above safe threshold");
    if (opts.knownTargets && x.fn !== "nativeTransfer" && !opts.knownTargets.map((a) => a.toLowerCase()).includes(String(x.to).toLowerCase())) add(15, "target not on known-good list");
  }
  s = Math.min(100, s);
  return { score: s, level: s >= 60 ? "HIGH" : s >= 25 ? "MEDIUM" : "LOW", reasons };
}

function canonicalJson(o) {
  const norm = (v) => Array.isArray(v) ? v.map(norm)
    : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, norm(v[k])])) : v;
  return JSON.stringify(norm(o));
}

function buildManifest(tx, opts) {
  const decoded = decode(tx);
  const risk = score(decoded, opts);
  const core = { chainId: tx.chainId ?? 15000, to: tx.to, value: decoded.value, calldata: tx.data, summary: decoded.summary, fn: decoded.fn, risk: { score: risk.score, level: risk.level } };
  const canonical = canonicalJson(core);
  return { decoded, risk, canonical, manifestHash: ethers.keccak256(ethers.toUtf8Bytes(canonical)), calldataHash: ethers.keccak256(tx.data) };
}

module.exports = { decode, score, buildManifest, canonicalJson, MAX_UINT };
