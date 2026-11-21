// Creates a FRESH Quai testnet wallet in the Cyprus-1 zone and writes the key to .env only.
// The private key is never printed. Only the public address is shown.
const fs = require("fs");
const crypto = require("crypto");
const quais = require("quais");
let w, n = 0;
do { w = new quais.Wallet("0x" + crypto.randomBytes(32).toString("hex")); n++; }
while (quais.getZoneForAddress(w.address) !== quais.Zone.Cyprus1 || !quais.isQuaiAddress(w.address));
let env = fs.existsSync(".env") ? fs.readFileSync(".env", "utf8") : fs.readFileSync(".env.example", "utf8");
if (/^QUAI_PRIVATE_KEY=.+/m.test(env)) { console.log("QUAI_PRIVATE_KEY already set in .env; not overwriting."); process.exit(0); }
env = env.replace(/^QUAI_PRIVATE_KEY=.*$/m, "QUAI_PRIVATE_KEY=" + w.privateKey);
fs.writeFileSync(".env", env);
console.log("New Cyprus-1 testnet address (public):", w.address, "(tries:", n + ")");
