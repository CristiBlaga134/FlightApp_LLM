const fs = require("fs");
const puppeteer = require("puppeteer");
const { buildVolaResultsUrl } = require("../services/volaScraper");

const searchQuery = {
  originCity: process.env.VOLA_FROM || "Bucuresti",
  originAirportCode: process.env.VOLA_FROM_CODE || null,
  destinationCity: process.env.VOLA_TO || "Londra",
  destinationAirportCode: process.env.VOLA_TO_CODE || "LHR",
  departureDate: process.env.VOLA_DEPARTURE || "2026-05-13",
  returnDate: process.env.VOLA_RETURN || null,
  tripType: process.env.VOLA_TRIP_TYPE || "one_way",
  cabinClass: process.env.VOLA_CABIN_CLASS || "economy",
  cabinBags: Number(process.env.VOLA_CABIN_BAGS || 0),
  checkedBags: Number(process.env.VOLA_CHECKED_BAGS || 0),
  passengers: Math.max(1, Number(process.env.VOLA_PASSENGERS || 1)),
};

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

  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

async function acceptCookies(page) {
  const allowButton = await page.$("#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll");
  if (!allowButton) return;

  await allowButton.click();
  await delay(900);
}

async function clickButtonByText(page, selector, targetTexts) {
  const clicked = await page.evaluate(({ query, targets }) => {
    const normalize = (value) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const expected = targets.map(normalize);
    const elements = Array.from(document.querySelectorAll(query));
    for (const element of elements) {
      const text = normalize(element.textContent || element.getAttribute("aria-label") || "");
      if (!text) continue;
      if (expected.some((target) => text.includes(target))) {
        element.click();
        return true;
      }
    }

    return false;
  }, { query: selector, targets: targetTexts });

  if (!clicked) {
    throw new Error(`Could not click element for text: ${targetTexts.join(", ")}`);
  }
}

async function ensureTripType(page, tripType) {
  if (tripType !== "one_way") {
    return;
  }

  await clickButtonByText(page, "button", ["Dus-intors", "Dus-întors"]);
  await delay(600);
  await clickButtonByText(page, "button, [role='option'], li", ["Doar dus"]);
  await delay(700);
}

async function openPopover(page, index) {
  const popoverButtons = await page.$$("button.popover__button");
  if (!popoverButtons[index]) {
    throw new Error(`Missing Vola popover button at index ${index}`);
  }

  await popoverButtons[index].click();
  await delay(700);
}

async function typeIntoField(page, selector, value) {
  await page.waitForSelector(selector, { visible: true, timeout: 15000 });
  const input = await page.$(selector);
  if (!input) {
    throw new Error(`Missing input: ${selector}`);
  }

  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await input.type(value, { delay: 120 });
}

async function pickDestination(page, destinationCity) {
  await openPopover(page, 2);
  await typeIntoField(page, 'input[aria-label="Către"]', destinationCity);
  await delay(1000);

  const clicked = await page.evaluate((city) => {
    const normalize = (value) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();

    const target = normalize(city);
    const options = Array.from(document.querySelectorAll('[role="option"]'));
    const preferred = options.find((option) => {
      const text = normalize(option.textContent || "");
      return text.includes(target) && text.includes("oras") && !text.includes("+250 km") && !text.includes("tara");
    });
    const fallback = options.find((option) => {
      const text = normalize(option.textContent || "");
      return text.includes(target) && !text.includes("+250 km") && !text.includes("tara");
    });

    const choice = preferred || fallback;
    if (!choice) {
      return false;
    }

    choice.click();
    return true;
  }, destinationCity);

  if (!clicked) {
    throw new Error(`Could not pick Vola destination for ${destinationCity}`);
  }

  await delay(900);
}

async function pickDates(page, departureDate, returnDate) {
  await page.click("#date-picker-trigger-btn-1");
  await delay(700);

  await page.waitForSelector(`button[id$="${departureDate}"]`, { visible: true, timeout: 20000 });
  await page.click(`button[id$="${departureDate}"]`);
  await delay(600);

  if (returnDate) {
    await page.waitForSelector(`button[id$="${returnDate}"]`, { visible: true, timeout: 20000 });
    await page.click(`button[id$="${returnDate}"]`);
    await delay(600);
  }

  await clickButtonByText(page, "button", ["Continua", "Continuă"]);
  await delay(800);
}

async function submitSearch(page) {
  const buttons = await page.$$('[data-testid="search-flight-btn"]');
  if (!buttons.length) {
    throw new Error("Missing Vola search button");
  }

  await buttons[0].click();
}

async function fallbackToDirectResults(page, query) {
  const finalUrl = buildVolaResultsUrl(query);
  if (!finalUrl) {
    throw new Error("Could not build Vola results URL for visual fallback");
  }

  await page.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
  console.log(`Opened direct Vola results URL: ${finalUrl}`);
}

async function runVisualDemo() {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 120,
    executablePath: resolveSystemBrowserExecutable(),
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    defaultViewport: null,
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  try {
    console.log("Opening Vola homepage...");
    await page.goto("https://www.vola.ro/", { waitUntil: "domcontentloaded", timeout: 90000 });
    await delay(1800);
    await acceptCookies(page);

    await ensureTripType(page, searchQuery.tripType);

    if (normalizeText(searchQuery.originCity) !== "bucuresti") {
      console.log(`Origin ${searchQuery.originCity} is not the default homepage value, using direct results fallback.`);
      await fallbackToDirectResults(page, searchQuery);
    } else {
      console.log(`Keeping default Vola origin: ${searchQuery.originCity}`);
      console.log(`Typing destination: ${searchQuery.destinationCity}`);
      await pickDestination(page, searchQuery.destinationCity);
      console.log(`Selecting dates: ${searchQuery.departureDate}${searchQuery.returnDate ? ` -> ${searchQuery.returnDate}` : ""}`);
      await pickDates(page, searchQuery.departureDate, searchQuery.returnDate);
      console.log("Submitting Vola search...");
      await submitSearch(page);
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90000 }).catch(() => {});
    }

    console.log("Vola visual demo is open. Close the browser window when you are done.");
    await new Promise((resolve) => browser.on("disconnected", resolve));
  } catch (error) {
    console.error("Visual Vola demo failed:", error.message);
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

runVisualDemo().catch((error) => {
  console.error(error);
  process.exit(1);
});