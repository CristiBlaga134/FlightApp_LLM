const axios = require("axios");

const { getScraperReadiness } = require("./eSkyScraper");
const { buildPaymentProviderConfig } = require("./paymentProvider");
const { getSampleOffersInventory } = require("./searchFlights");

function deriveOllamaTagsUrl(ollamaUrl) {
  const fallbackUrl = "http://localhost:11434/api/tags";

  try {
    const target = new URL(String(ollamaUrl || "").trim() || "http://localhost:11434/api/generate");
    target.pathname = "/api/tags";
    target.search = "";
    target.hash = "";
    return target.toString();
  } catch {
    return fallbackUrl;
  }
}

async function getOllamaReadiness({ model, ollamaUrl }) {
  const tagsUrl = deriveOllamaTagsUrl(ollamaUrl);

  try {
    const response = await axios.get(tagsUrl, { timeout: 4000 });
    const installedModels = Array.isArray(response.data?.models)
      ? response.data.models
        .map((entry) => String(entry?.name || "").trim())
        .filter(Boolean)
      : [];
    const modelAvailable = installedModels.includes(model);

    return {
      ready: modelAvailable,
      reachable: true,
      model,
      tagsUrl,
      installedModelCount: installedModels.length,
      installedModels: installedModels.slice(0, 10),
      error: modelAvailable ? null : `Model ${model} is not installed in Ollama.`,
    };
  } catch (error) {
    return {
      ready: false,
      reachable: false,
      model,
      tagsUrl,
      installedModelCount: 0,
      installedModels: [],
      error: error?.message || "Could not reach Ollama.",
    };
  }
}

function getPaymentsReadiness() {
  const providerConfig = buildPaymentProviderConfig();

  return {
    ready: Boolean(providerConfig?.activeProvider),
    activeProvider: providerConfig?.activeProvider || null,
    integrationShape: providerConfig?.integrationShape || null,
    supportsPaymentSheet: Boolean(providerConfig?.supportsPaymentSheet),
    routes: providerConfig?.routes || null,
    stripePlaceholders: providerConfig?.stripePlaceholders || null,
  };
}

function getFallbackOffersReadiness() {
  try {
    const inventory = getSampleOffersInventory();
    const ready = Number(inventory?.totalOffers || 0) > 0;

    return {
      ready,
      totalOffers: Number(inventory?.totalOffers || 0),
      sampleRoutes: Array.isArray(inventory?.sampleRoutes) ? inventory.sampleRoutes : [],
      error: ready ? null : "No backup sample offers are available.",
    };
  } catch (error) {
    return {
      ready: false,
      totalOffers: 0,
      sampleRoutes: [],
      error: error?.message || "Could not load backup sample offers.",
    };
  }
}

async function getDemoReadiness({ model, ollamaUrl }) {
  const [ollama] = await Promise.all([
    getOllamaReadiness({ model, ollamaUrl }),
  ]);
  const scraper = getScraperReadiness();
  const payments = getPaymentsReadiness();
  const fallbackOffers = getFallbackOffersReadiness();
  const warnings = [];

  if (!ollama.ready) {
    warnings.push(ollama.error || `Ollama model ${model} is not ready.`);
  }

  if (!scraper.ready) {
    const scraperDetails = Array.isArray(scraper.errors) && scraper.errors.length > 0
      ? scraper.errors.join(" ")
      : "Live supplier browser checks are failing.";
    warnings.push(scraperDetails);
  }

  if (!fallbackOffers.ready) {
    warnings.push(fallbackOffers.error || "Backup sample offers are unavailable.");
  }

  if (!payments.ready) {
    warnings.push("Payment provider configuration is unavailable.");
  }

  return {
    ok: Boolean(ollama.ready && scraper.ready && fallbackOffers.ready && payments.ready),
    ollama,
    scraper,
    payments,
    fallbackOffers,
    warnings,
  };
}

module.exports = { getDemoReadiness };