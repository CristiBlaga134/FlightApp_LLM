const { getDemoReadiness } = require("../services/demoReadiness");

const MODEL = process.env.OLLAMA_MODEL || "qwen2.5:7b";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434/api/generate";

function printCheck(label, ready, detail) {
  const prefix = ready ? "[OK]" : "[FAIL]";
  console.log(`${prefix} ${label}${detail ? `: ${detail}` : ""}`);
}

async function main() {
  const readiness = await getDemoReadiness({ model: MODEL, ollamaUrl: OLLAMA_URL });

  console.log(`Demo readiness for ${MODEL}`);
  console.log("");

  printCheck(
    "Ollama",
    readiness.ollama.ready,
    readiness.ollama.ready
      ? `${readiness.ollama.model} available via ${readiness.ollama.tagsUrl}`
      : readiness.ollama.error
  );
  printCheck(
    "eSky scraper",
    readiness.scraper.ready,
    readiness.scraper.ready
      ? readiness.scraper.browserExecutable
      : (readiness.scraper.errors || []).join(" ") || "Scraper checks failed."
  );
  printCheck(
    "Backup sample offers",
    readiness.fallbackOffers.ready,
    `${readiness.fallbackOffers.totalOffers} offers loaded${
      readiness.fallbackOffers.sampleRoutes.length > 0
        ? ` (${readiness.fallbackOffers.sampleRoutes.join(", ")})`
        : ""
    }`
  );
  printCheck(
    "Payment provider",
    readiness.payments.ready,
    readiness.payments.ready
      ? `${readiness.payments.activeProvider} (${readiness.payments.integrationShape})`
      : "Provider config unavailable"
  );

  if (readiness.warnings.length > 0) {
    console.log("");
    console.log("Warnings:");
    for (const warning of readiness.warnings) {
      console.log(`- ${warning}`);
    }
  }

  console.log("");
  console.log(`Demo ready: ${readiness.ok ? "YES" : "NO"}`);

  if (!readiness.ok) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});