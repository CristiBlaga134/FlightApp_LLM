const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer");

const VOLA_BASE_URL = "https://www.vola.ro/flight_search";
const SEARCH_TIMEOUT_MS = 90000;
const UI_SETTLE_MS = 3500;
const DIAGNOSTICS_DIR = path.join(__dirname, "..", "debug", "vola");

const CITY_TO_PRIMARY_AIRPORT = {
  Cluj: "CLJ",
  Bucuresti: "OTP",
  Iasi: "IAS",
  Sibiu: "SBZ",
  Timisoara: "TSR",
  Berlin: "BER",
  Amsterdam: "AMS",
  Paris: "CDG",
  Roma: "FCO",
  Londra: "LHR",
  Barcelona: "BCN",
  Madrid: "MAD",
  Lisabona: "LIS",
  Viena: "VIE",
  Praga: "PRG",
  Atena: "ATH",
  Zurich: "ZRH",
  Dublin: "DUB",
  Milano: "MXP",
  Istanbul: "IST",
  Dubai: "DXB",
  Copenhaga: "CPH",
};

let browser = null;
let scrapingInProgress = false;

function resolveSystemBrowserExecutable() {
  const fromEnv = process.env.VOLA_BROWSER_PATH || process.env.ESKY_BROWSER_PATH;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const candidates = [
    "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe",
    "C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureDiagnosticsDir() {
  if (!fs.existsSync(DIAGNOSTICS_DIR)) {
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
  }
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripDiacritics(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeComparableText(value) {
  return normalizeWhitespace(stripDiacritics(value)).toLowerCase();
}

function normalizeCity(city) {
  if (!city) return city;

  const normalized = String(city).trim().toLowerCase();
  const cityMap = {
    bucharest: "Bucuresti",
    bucuresti: "Bucuresti",
    rome: "Roma",
    roma: "Roma",
    london: "Londra",
    londra: "Londra",
    lisbon: "Lisabona",
    lisabona: "Lisabona",
    vienna: "Viena",
    viena: "Viena",
    prague: "Praga",
    praga: "Praga",
    athens: "Atena",
    atena: "Atena",
    milan: "Milano",
    milano: "Milano",
    copenhagen: "Copenhaga",
    copenhaga: "Copenhaga",
  };

  return cityMap[normalized] || String(city).trim();
}

function resolveAirportCode(city, airportCode) {
  if (airportCode) {
    return String(airportCode).trim().toUpperCase();
  }

  return CITY_TO_PRIMARY_AIRPORT[city] || null;
}

function normalizeCabinClassForVola(value) {
  const raw = String(value || "economy").trim().toLowerCase();

  if (raw.includes("premium")) return "PREMIUM_ECONOMY";
  if (raw.includes("business")) return "BUSINESS";
  if (raw.includes("first")) return "FIRST";
  return "ECONOMY";
}

function buildNormalizedSearch(searchQuery) {
  const originCity = normalizeCity(searchQuery?.originCity);
  const destinationCity = normalizeCity(searchQuery?.destinationCity);

  return {
    originCity,
    originAirportCode: resolveAirportCode(originCity, searchQuery?.originAirportCode),
    destinationCity,
    destinationAirportCode: resolveAirportCode(destinationCity, searchQuery?.destinationAirportCode),
    tripType: searchQuery?.tripType || "one_way",
    departureDate: searchQuery?.departureDate || null,
    returnDate: searchQuery?.returnDate || null,
    cabinClass: searchQuery?.cabinClass || "economy",
    cabinBags: Number.isFinite(Number(searchQuery?.cabinBags)) ? Number(searchQuery.cabinBags) : 0,
    checkedBags: Number.isFinite(Number(searchQuery?.checkedBags)) ? Number(searchQuery.checkedBags) : 0,
    passengers: Math.max(1, Number(searchQuery?.passengers || 1)),
  };
}

function buildVolaResultsUrl(searchQuery) {
  const normalizedSearch = buildNormalizedSearch(searchQuery);
  if (
    !normalizedSearch.originAirportCode ||
    !normalizedSearch.destinationAirportCode ||
    !normalizedSearch.departureDate
  ) {
    return null;
  }

  const params = new URLSearchParams({
    from: `AIRPORT:${normalizedSearch.originAirportCode}`,
    to: `AIRPORT:${normalizedSearch.destinationAirportCode}`,
    dd: normalizedSearch.departureDate,
    ad: String(normalizedSearch.passengers),
    cc: normalizeCabinClassForVola(normalizedSearch.cabinClass),
    cabin: String(Math.max(0, normalizedSearch.cabinBags || 0)),
    checked: String(Math.max(0, normalizedSearch.checkedBags || 0)),
  });

  if (normalizedSearch.tripType === "round_trip" && normalizedSearch.returnDate) {
    params.set("rd", normalizedSearch.returnDate);
  } else {
    params.set("ow", "1");
  }

  return `${VOLA_BASE_URL}?${params.toString()}`;
}

function formatIsoDateForVolaText(isoDate) {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(isoDate))) {
    return null;
  }

  const [year, month, day] = String(isoDate).split("-");
  return `${day}.${month}.${year}`;
}

function buildSearchMarkers(searchQuery) {
  const normalizedSearch = buildNormalizedSearch(searchQuery);

  return {
    originCity: normalizeComparableText(normalizedSearch.originCity),
    destinationCity: normalizeComparableText(normalizedSearch.destinationCity),
    departureDate: formatIsoDateForVolaText(normalizedSearch.departureDate),
    returnDate: formatIsoDateForVolaText(normalizedSearch.returnDate),
  };
}

function parseEuroPrice(text) {
  const matches = [...String(text || "").matchAll(/([0-9][0-9.\s]*)\s*€/g)];
  if (matches.length === 0) {
    return null;
  }

  const raw = matches[matches.length - 1][1];
  const normalized = raw.replace(/[^0-9]/g, "");
  return normalized ? Number(normalized) : null;
}

function parseDurationMinutes(text) {
  const value = normalizeWhitespace(text);
  const patterns = [
    /(\d+)\s*hr\s*(\d+)?\s*mins?/i,
    /(\d+)\s*h\s*(\d+)?\s*m/i,
    /(\d+)\s*ore?\s*(\d+)?\s*min/i,
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) continue;

    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    return (hours * 60) + minutes;
  }

  return null;
}

function parseStops(text) {
  const value = normalizeWhitespace(text);
  if (/\bdirect\b/i.test(value)) {
    return 0;
  }

  const match = value.match(/(\d+)\s+(?:escal(?:a|\u0103)|stop(?:uri)?|stops?)/i);
  return match ? Number(match[1]) : null;
}

function parseStageText(text) {
  const value = normalizeWhitespace(text);
  const departureMatch = value.match(/Plecare din\s+([^,]+),\s*([^,]+),\s*(\d{1,2}:\d{2})/i);
  const arrivalMatch = value.match(/Sosire (?:in|\u00een)\s+([^,]+),\s*([^,]+),\s*(\d{1,2}:\d{2})/i);

  return {
    departureCity: departureMatch?.[1]?.trim() || null,
    departureAirportName: departureMatch?.[2]?.trim() || null,
    departureTime: departureMatch?.[3] || null,
    arrivalCity: arrivalMatch?.[1]?.trim() || null,
    arrivalAirportName: arrivalMatch?.[2]?.trim() || null,
    arrivalTime: arrivalMatch?.[3] || null,
    durationMinutes: parseDurationMinutes(value),
    stops: parseStops(value),
  };
}

function pickAirline(carrierHints) {
  const candidates = (carrierHints || [])
    .map((entry) => normalizeWhitespace(entry))
    .filter((entry) => entry && !/^vola(\.ro)?$/i.test(entry));

  return candidates[0] || "Vola partner";
}

function cardMatchesSearch(cardText, searchQuery) {
  const comparableText = normalizeComparableText(cardText);
  const markers = buildSearchMarkers(searchQuery);

  if (markers.originCity && !comparableText.includes(markers.originCity)) {
    return false;
  }

  if (markers.destinationCity && !comparableText.includes(markers.destinationCity)) {
    return false;
  }

  if (markers.departureDate && !comparableText.includes(markers.departureDate)) {
    return false;
  }

  if (markers.returnDate && !comparableText.includes(markers.returnDate)) {
    return false;
  }

  return true;
}

async function waitForLiveResults(page, searchQuery) {
  const markers = buildSearchMarkers(searchQuery);

  await page.waitForFunction(
    (expected) => {
      const normalize = (value) =>
        String(value || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();

      const loader = document.querySelector('[data-testid="flight-offers-loader"]');
      if (loader) {
        return false;
      }

      const noMatches = document.querySelector('[data-testid="no-matching-flights"]');
      if (noMatches) {
        return true;
      }

      const regularResults = document.querySelector('#regular-search-results, [data-testid="regular-search-view"]');

      const cards = Array.from(document.querySelectorAll("article.result-wrapper"))
        .filter((article) => {
          const rect = article.getBoundingClientRect();
          const style = window.getComputedStyle(article);
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 20 && rect.height > 20;
        })
        .map((article) => normalize(article.textContent || ""));

      if (cards.length === 0) {
        return Boolean(regularResults);
      }

      return cards.some((text) => {
        if (expected.originCity && !text.includes(expected.originCity)) {
          return false;
        }

        if (expected.destinationCity && !text.includes(expected.destinationCity)) {
          return false;
        }

        if (expected.departureDate && !text.includes(expected.departureDate)) {
          return false;
        }

        if (expected.returnDate && !text.includes(expected.returnDate)) {
          return false;
        }

        return true;
      });
    },
    { timeout: 45000 },
    markers
  );
}

async function saveDiagnostics(page, searchQuery, stage) {
  try {
    ensureDiagnosticsDir();
    const origin = normalizeWhitespace(searchQuery?.originCity || "origin").replace(/\s+/g, "_");
    const destination = normalizeWhitespace(searchQuery?.destinationCity || "destination").replace(/\s+/g, "_");
    const date = normalizeWhitespace(searchQuery?.departureDate || "no-date");
    const stamp = new Date().toISOString().replace(/[.:]/g, "-");
    const prefix = path.join(DIAGNOSTICS_DIR, `${origin}-${destination}-${date}-${stage}-${stamp}`);

    await page.screenshot({ path: `${prefix}.png`, fullPage: true });
    const html = await page.content();
    fs.writeFileSync(`${prefix}.html`, html, "utf8");
  } catch {
    // best effort only
  }
}

async function initBrowser() {
  if (browser) {
    try {
      await browser.version();
    } catch {
      console.log("[VOLA] Stale browser detected, relaunching...");
      browser = null;
    }
  }

  if (!browser) {
    const executablePath = resolveSystemBrowserExecutable();
    browser = await puppeteer.launch({
      headless: false,
      executablePath: executablePath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--window-size=1920,1080",
      ],
    });

    browser.on("disconnected", () => {
      console.log("[VOLA] Browser disconnected, resetting instance");
      browser = null;
    });
  }

  return browser;
}

async function scrapeResultCards(page, searchQuery, bookingUrl) {
  const normalizedSearch = buildNormalizedSearch(searchQuery);
  const rawCards = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();

    return Array.from(document.querySelectorAll("article.result-wrapper"))
      .map((article, index) => ({
        index,
        visible: (() => {
          const rect = article.getBoundingClientRect();
          const style = window.getComputedStyle(article);
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 20 && rect.height > 20;
        })(),
        articleText: clean(article.textContent),
        buttonText: clean(article.querySelector('[data-testid="flight-offer-continue-btn"]')?.textContent || ""),
        stageTexts: Array.from(article.querySelectorAll("li.stage")).map((node) => clean(node.textContent)),
        carrierHints: Array.from(
          article.querySelectorAll('[class*="carrier"], [data-testid*="carrier"], img[alt]')
        )
          .map((node) => clean(node.getAttribute("alt") || node.textContent || ""))
          .filter(Boolean),
      }));
  });

  return rawCards
    .filter((card) => card.visible)
    .filter((card) => cardMatchesSearch(card.articleText, searchQuery))
    .slice(0, 8)
    .map((card, index) => {
      const primaryStage = parseStageText(card.stageTexts[0] || card.articleText);
      const price = parseEuroPrice(card.buttonText || card.articleText);
      if (!Number.isFinite(price)) {
        return null;
      }

      const departureDate = normalizedSearch.departureDate || searchQuery?.departureDate || null;
      const departureTime = primaryStage.departureTime || "08:00";
      const arrivalTime = primaryStage.arrivalTime || "10:00";

      return {
        id: `VOLA_${Date.now()}_${index}`,
        originCity: primaryStage.departureCity || normalizedSearch.originCity,
        originAirportCode: normalizedSearch.originAirportCode,
        destinationCity: primaryStage.arrivalCity || normalizedSearch.destinationCity,
        destinationAirportCode: normalizedSearch.destinationAirportCode,
        tripType: normalizedSearch.tripType,
        departureDate,
        returnDate: normalizedSearch.returnDate || null,
        airline: pickAirline(card.carrierHints),
        cabinClass: normalizedSearch.cabinClass,
        price,
        currency: "EUR",
        cabinBags: normalizedSearch.cabinBags,
        checkedBags: normalizedSearch.checkedBags,
        passengers: normalizedSearch.passengers,
        stops: primaryStage.stops,
        durationMinutes: primaryStage.durationMinutes || 0,
        departureTimeLocal: departureDate ? `${departureDate}T${departureTime}` : departureTime,
        arrivalTimeLocal: departureDate ? `${departureDate}T${arrivalTime}` : arrivalTime,
        maxSeats: 180,
        availableSeats: 32 + (index * 4),
        hasAccessibleSeating: true,
        supplier: "Vola",
        bookingUrl,
        detailsPreview: card.articleText,
      };
    })
    .filter(Boolean);
}

async function searchVola(searchQuery) {
  if (scrapingInProgress) {
    return null;
  }

  const finalUrl = buildVolaResultsUrl(searchQuery);
  if (!finalUrl) {
    return null;
  }

  let page = null;
  scrapingInProgress = true;

  try {
    const browserInstance = await initBrowser();
    const existingPages = await browserInstance.pages();
    page = existingPages[0] || await browserInstance.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36");
    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await page.setViewport({ width: 1440, height: 1600 });
    await page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: SEARCH_TIMEOUT_MS });
    await delay(UI_SETTLE_MS);
    await waitForLiveResults(page, searchQuery);

    const hasCards = await page.$("article.result-wrapper");
    const hasNoMatchesState = await page.$('[data-testid="no-matching-flights"]');
    if (!hasCards) {
      await saveDiagnostics(page, searchQuery, hasNoMatchesState ? "no-matching-flights" : "no-cards");
      return {
        offers: [],
        normalizedSearch: buildNormalizedSearch(searchQuery),
        finalUrl,
      };
    }

    const offers = await scrapeResultCards(page, searchQuery, finalUrl);
    return {
      offers,
      normalizedSearch: buildNormalizedSearch(searchQuery),
      finalUrl,
    };
  } catch (error) {
    if (page) {
      await saveDiagnostics(page, searchQuery, "search-error");
    }
    throw error;
  } finally {
    scrapingInProgress = false;
    if (page) {
      await page.close().catch(() => {});
    }
  }
}

async function closeVolaBrowser() {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

module.exports = {
  searchVola,
  buildVolaResultsUrl,
  closeVolaBrowser,
};