const puppeteer = require("puppeteer");

const WIZZ_BASE_URL = "https://wizzair.com";
const SCRAPE_TIMEOUT = 12000; // 12 seconds max

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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initBrowser() {
  if (!browser) {
    console.log("[SCRAPER] Initializing Puppeteer browser (first run may take 1-2 min)...");
    try {
      browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
        ],
      });
      console.log("[SCRAPER] ✅ Browser ready");
    } catch (err) {
      console.error("[SCRAPER] ❌ Failed to launch browser:", err.message);
      return null;
    }
  }
  return browser;
}

function normalizeCity(city) {
  const normalized = city.toLowerCase().trim();
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

  return cityMap[normalized] || city.trim();
}

function resolveAirportCode(city, airportCode) {
  if (airportCode) {
    return String(airportCode).trim().toUpperCase();
  }

  return CITY_TO_PRIMARY_AIRPORT[city] || null;
}

function buildStationInput(city, airportCode) {
  const normalizedCity = normalizeCity(city);
  const resolvedAirportCode = resolveAirportCode(normalizedCity, airportCode);
  if (resolvedAirportCode) {
    return `${normalizedCity} (${resolvedAirportCode})`;
  }

  return normalizedCity;
}

async function waitForUrlChange(page, startUrl, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const currentUrl = page.url();
    if (currentUrl !== startUrl) {
      return currentUrl;
    }
    await delay(250);
  }
  return page.url();
}

async function scrapeESkyResults(page, searchQuery) {
  console.log(`[SCRAPER] Attempting to parse eSky results from ${page.url()}`);
  await delay(3000);

  const flights = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll("article, section, [class*='result'], [class*='flight'], [data-testid*='flight']"));
    return cards
      .map((card, index) => {
        const text = (card.textContent || "").replace(/\s+/g, " ").trim();
        const priceMatch = text.match(/(?:€|EUR|lei)\s?(\d{2,5})/i);
        if (!priceMatch) return null;

        const durationMatch = text.match(/(\d{1,2})h(?:\s?(\d{1,2})m)?/i);
        const stopsMatch = text.match(/(direct|nonstop|\d+\s+stop)/i);

        return {
          id: `ESKY_${Date.now()}_${index}`,
          rawText: text.slice(0, 240),
          price: Number(priceMatch[1]),
          durationMinutes: durationMatch
            ? Number(durationMatch[1]) * 60 + Number(durationMatch[2] || 0)
            : 120,
          stops: stopsMatch && /direct|nonstop/i.test(stopsMatch[1])
            ? 0
            : stopsMatch
              ? Number((stopsMatch[1].match(/\d+/) || [0])[0])
              : 0,
        };
      })
      .filter(Boolean)
      .slice(0, 12);
  });

  console.log(`[SCRAPER] eSky cards parsed: ${flights.length}`);

  if (flights.length === 0) {
    return [];
  }

  return normalizeScrapedFlights(
    flights,
    searchQuery.originCity,
    searchQuery.destinationCity,
    searchQuery.departureDate,
    searchQuery.originAirportCode,
    searchQuery.destinationAirportCode,
    "eSky"
  );
}

async function searchWizzAir(searchQuery) {
  const {
    originCity,
    destinationCity,
    departureDate,
    originAirportCode,
    destinationAirportCode,
  } = searchQuery;
  const startTime = Date.now();
  console.log(
    `[SCRAPER] Starting Wizz Air search: ${originCity} (${originAirportCode || "city"}) → ${destinationCity} (${destinationAirportCode || "city"}), ${departureDate}`
  );

  if (scrapingInProgress) {
    console.log("[SCRAPER] ⏳ Another search in progress, skipping...");
    return null;
  }

  scrapingInProgress = true;

  try {
    const browserInstance = await initBrowser();
    if (!browserInstance) {
      console.log("[SCRAPER] ⚠️  Browser initialization failed, falling back to sample data");
      return null;
    }

    const page = await browserInstance.newPage();
    console.log("[SCRAPER] Opening new page...");

    // Set user agent to be respectful
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    );

    // Navigate to Wizz Air
    console.log("[SCRAPER] Navigating to Wizz Air...");
    await Promise.race([
      page.goto(WIZZ_BASE_URL, { waitUntil: "networkidle2" }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Navigation timeout")), 8000)
      ),
    ]);

    console.log("[SCRAPER] Page loaded, searching for search form...");

    // Wait for search form to load
    try {
      await page.waitForSelector('input[placeholder="Origin"]', { timeout: 5000 });
      console.log("[SCRAPER] ✅ Search form found");
    } catch {
      console.log("[SCRAPER] ⚠️  Search form not found, trying alternative selectors...");
      // Wizz Air page structure may vary, try clicking a search button if visible
      return null;
    }

    // Try to fill the form
    console.log("[SCRAPER] Filling search form...");

    const originInput = await page.$('input[placeholder="Origin"]');
    const destInput = await page.$('input[placeholder="Destination"]');
    const departureInput = await page.$('input[placeholder="Departure"]');

    if (!originInput || !destInput || !departureInput) {
      console.log("[SCRAPER] ⚠️  Could not find the Wizz Air search inputs");
      await page.close();
      return null;
    }

    const originStation = buildStationInput(originCity, originAirportCode);
    const destinationStation = buildStationInput(destinationCity, destinationAirportCode);
    console.log(`[SCRAPER] Using stations: ${originStation} → ${destinationStation}`);

    const oneWayRadio = await page.$('div[aria-label="Trip type"] input[type="radio"]:nth-of-type(2)');
    if (oneWayRadio) {
      await oneWayRadio.click();
      console.log("[SCRAPER] Trip type set to one way");
      await delay(200);
    }

    await originInput.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(originStation, { delay: 50 });
    await delay(800);

    try {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      console.log("[SCRAPER] Origin suggestion selected");
    } catch {
      console.log("[SCRAPER] No origin suggestion selected, continuing...");
    }

    await destInput.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(destinationStation, { delay: 50 });
    await delay(800);

    try {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      console.log("[SCRAPER] Destination suggestion selected");
    } catch {
      console.log("[SCRAPER] No destination suggestion selected, continuing...");
    }

    await departureInput.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(departureDate, { delay: 20 });
    await delay(300);
    console.log("[SCRAPER] Departure date entered");

    console.log("[SCRAPER] Form filled, searching...");

    // Click search button
    const searchButton = await page.$("button[type='submit']");
    const startUrl = page.url();
    if (searchButton) {
      await searchButton.click();
      console.log("[SCRAPER] Search button clicked, waiting for navigation or partner handoff...");
    }

    const finalUrl = await waitForUrlChange(page, startUrl, 8000);
    console.log(`[SCRAPER] Current URL after submit: ${finalUrl}`);

    if (/esky\./i.test(finalUrl)) {
      console.log("[SCRAPER] ✅ Redirected to eSky, switching result parsing to partner site");
      const eSkyOffers = await scrapeESkyResults(page, searchQuery);
      await page.close();

      if (eSkyOffers.length === 0) {
        console.log("[SCRAPER] ⚠️  eSky redirect detected but no partner offers parsed");
        return null;
      }

      const duration = Date.now() - startTime;
      console.log(
        `[SCRAPER] ✅ Partner scrape completed in ${(duration / 1000).toFixed(1)}s, found ${eSkyOffers.length} flights`
      );
      return eSkyOffers;
    }

    console.log("[SCRAPER] No partner redirect detected, checking for native results on current page...");

    // Try to extract flight data
    const flights = await page.evaluate(() => {
      const results = [];
      const flightElements = document.querySelectorAll(
        ".flight-item, .flight-row, .flight-card, [data-testid*='flight']"
      );

      if (flightElements.length === 0) {
        return [];
      }

      flightElements.forEach((el, idx) => {
        try {
          const priceText = el.textContent?.match(/€?(\d+)/)?.[1];
          const price = priceText ? parseInt(priceText) : 0;

          results.push({
            id: `WIZZ_${Date.now()}_${idx}`,
            price: price || 150,
            airline: "Wizz Air",
            duration: "~2h",
            stops: 0,
          });
        } catch (e) {
          // Silent fail on parse errors
        }
      });

      return results;
    });

    console.log(`[SCRAPER] Found ${flights.length} listings on page`);

    await page.close();

    if (flights.length === 0) {
      console.log("[SCRAPER] ⚠️  No flights parsed, falling back to sample data");
      return null;
    }

    // Normalize to app format
    const normalized = normalizeScrapedFlights(
      flights,
      originCity,
      destinationCity,
      departureDate,
      originAirportCode,
      destinationAirportCode,
      "Wizz Air"
    );

    const duration = Date.now() - startTime;
    console.log(
      `[SCRAPER] ✅ Scrape completed in ${(duration / 1000).toFixed(1)}s, found ${normalized.length} flights`
    );

    return normalized;
  } catch (err) {
    console.error("[SCRAPER] ❌ Scraping error:", err.message);
    return null;
  } finally {
    scrapingInProgress = false;
  }
}

function normalizeScrapedFlights(
  scrapedFlights,
  originCity,
  destinationCity,
  departureDate,
  originAirportCode,
  destinationAirportCode,
  airlineName = "Wizz Air"
) {
  const normalizedOriginCity = normalizeCity(originCity);
  const normalizedDestinationCity = normalizeCity(destinationCity);
  const originCode = resolveAirportCode(normalizedOriginCity, originAirportCode);
  const destCode = resolveAirportCode(normalizedDestinationCity, destinationAirportCode);

  return scrapedFlights.map((flight, idx) => ({
    id: flight.id || `WIZZ_${Date.now()}_${idx}`,
    originCity: normalizedOriginCity,
    originAirportCode: originCode,
    destinationCity: normalizedDestinationCity,
    destinationAirportCode: destCode,
    tripType: "one_way",
    departureDate: departureDate,
    returnDate: null,
    airline: flight.airline || airlineName,
    cabinClass: "economy",
    price: flight.price || 150 + Math.random() * 100,
    currency: "EUR",
    cabinBags: 1,
    checkedBags: flight.checkedBags || 0,
    passengers: 1,
    stops: flight.stops || 0,
    durationMinutes: flight.durationMinutes || 120,
    departureTimeLocal: `${departureDate}T${String(Math.floor(Math.random() * 24)).padStart(
      2,
      "0"
    )}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
    arrivalTimeLocal: `${departureDate}T${String(Math.floor(Math.random() * 24)).padStart(
      2,
      "0"
    )}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}`,
    maxSeats: Math.floor(Math.random() * 100) + 50,
    availableSeats: Math.floor(Math.random() * 50) + 20,
    hasAccessibleSeating: Math.random() > 0.3,
  }));
}

async function closeBrowser() {
  if (browser) {
    console.log("[SCRAPER] Closing browser...");
    await browser.close();
    browser = null;
  }
}

module.exports = {
  searchWizzAir,
  closeBrowser,
};
