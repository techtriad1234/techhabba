require("dotenv").config();
const quais = require("quais");
(async () => {
  const w = new quais.Wallet(process.env.QUAI_PRIVATE_KEY);
  for (const url of ["https://orchard.rpc.quai.network", "https://orchard.rpc.quai.network/cyprus1"]) {
    try {
      const p = new quais.JsonRpcProvider(url, undefined, { usePathing: true });
      const bal = await p.getBalance(w.address);
      console.log(url, "->", w.address, "balance:", quais.formatQuai(bal), "QUAI; block", await p.getBlockNumber());
    } catch (e) { console.log(url, "-> ERROR", e.shortMessage || e.message); }
  }
})();
