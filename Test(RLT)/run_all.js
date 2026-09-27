/* Node driver for the RLT harness.
 *
 *   python "test(rlt)/app.py"          # serve backend + static on :8111
 *   node "test(rlt)/run_all.js"        # execute the suite, print, exit(1) on FAIL
 *
 * Options:  --base=http://127.0.0.1:8111   --key=pyro_live_...   --save=results.json
 */
"use strict";

const path = require("path");

const args = process.argv.slice(2);
function argOf(prefix, dflt) {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : dflt;
}

const base = argOf("--base=", "http://127.0.0.1:8111");
const apiKey = argOf("--key=", "");
const savePath = argOf("--save=", "");

const harness = require(path.join(__dirname, "public", "app.js"));

async function main() {
  // Fail fast with a clear message if the harness server is not up.
  try {
    const health = await fetch(base + "/health");
    if (!health.ok) throw new Error("status " + health.status);
  } catch (e) {
    console.error("Cannot reach harness server at " + base + " — start it first:");
    console.error('  python "test(rlt)/app.py"');
    console.error(String(e));
    process.exit(2);
  }

  const summary = await harness.runAll({
    base,
    apiKey,
    onGroup: (title) => console.log("\n—— " + title + " ——"),
    onResult: (r) => console.log(harness.fmtResult(r))
  });

  console.log("\n========================================");
  console.log(
    "TOTAL " + summary.total +
    "   PASS " + summary.pass +
    "   FAIL " + summary.fail +
    "   PROBE " + summary.probe +
    (summary.probeFail ? " (mismatched " + summary.probeFail + ")" : "")
  );

  if (savePath) {
    const fs = require("fs");
    const out = path.resolve(savePath);
    fs.writeFileSync(out, JSON.stringify(summary, null, 2));
    console.log("saved → " + out);
  }

  process.exit(summary.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("driver crashed:", e);
  process.exit(3);
});
