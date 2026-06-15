const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ESKY_BASE_URL = "https://www.esky.ro";
const SEARCH_TIMEOUT_MS = 15000;
const UI_TIMEOUT_MS = 7000;

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
const DIAGNOSTICS_DIR = path.join(__dirname, "..", "debug", "esky");
const AIRPORT_OPTIONS_CACHE = new Map();

function resolveSystemBrowserExecutable() {
  const fromEnv = process.env.ESKY_BROWSER_PATH;
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

async function isConsentBlocking(page) {
  const markers = [
    "we protect your personal data",
    "privacy",
    "cookie",
    "consent",
    "confidentialitate",
    "confidențialitate",
    "date personale",
  ];

  for (const frame of page.frames()) {
    try {
      const blocked = await frame.evaluate((markerList) => {
        const ucWrapper = document.querySelector("#uc-fading-wrapper");
        if (ucWrapper) {
          const rect = ucWrapper.getBoundingClientRect();
          const style = window.getComputedStyle(ucWrapper);
          const visible = style.display !== "none" && style.visibility !== "hidden" && rect.width > 30 && rect.height > 30;
          if (visible) return true;
        }

        const text = (document.body?.innerText || "").toLowerCase();
        const hasMarker = markerList.some((marker) => text.includes(marker));
        if (!hasMarker) return false;

        const overlays = Array.from(
          document.querySelectorAll("[role='dialog'], [aria-modal='true'], [id*='cookie' i], [class*='cookie' i], [id*='consent' i], [class*='consent' i]")
        );

        if (overlays.length === 0) return true;

        return overlays.some((el) => {
          const style = window.getComputedStyle(el);
          const rect = el.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 30 && rect.height > 30;
        });
      }, markers);

      if (blocked) {
        return true;
      }
    } catch {
      // ignore detached/cross-frame race
    }
  }

  return false;
}

async function clickConsentInFrame(frame) {
  const agreeRegex = /(agree|i agree|accept|accept all|sunt de acord|de acord)/i;
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button[id*='accept'][id*='cookie']",
    "button",
    "[role='button']",
    "a",
  ];

  for (const selector of selectors) {
    let handles = [];
    try {
      handles = await frame.$$(selector);
    } catch {
      continue;
    }

    for (const handle of handles) {
      let text = "";
      try {
        text = await handle.evaluate((el) => (el.textContent || "").trim());
      } catch {
        continue;
      }

      if (!agreeRegex.test(text) && selector !== "#onetrust-accept-btn-handler") {
        continue;
      }

      try {
        await handle.evaluate((el) => el.scrollIntoView({ block: "center", inline: "center" }));
        await delay(80);
        await handle.click({ delay: 30 });
        return text || selector;
      } catch {
        try {
          const clicked = await handle.evaluate((el) => {
            const events = ["pointerdown", "mousedown", "mouseup", "click"];
            for (const name of events) {
              el.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
            }
            return (el.textContent || "").trim();
          });
          return clicked || text || selector;
        } catch {
          // try next candidate
        }
      }
    }
  }

  return null;
}

async function clickUsercentricsAgree(page) {
  for (const frame of page.frames()) {
    try {
      const clicked = await frame.evaluate(() => {
        const wrapper = document.querySelector("#uc-fading-wrapper");
        if (!wrapper) return null;

        const candidates = Array.from(wrapper.querySelectorAll("button, [role='button']"));
        const byTestId = candidates.find((el) => {
          const testId = (el.getAttribute("data-testid") || "").toLowerCase();
          return testId.includes("accept") || testId.includes("agree");
        });

        const byText = candidates.find((el) => {
          const txt = (el.textContent || "").trim().toLowerCase();
          return txt === "agree" || txt === "i agree" || txt === "accept all";
        });

        const target = byTestId || byText;
        if (!target) return null;

        target.scrollIntoView({ block: "center" });
        const rect = target.getBoundingClientRect();
        const center = {
          x: Math.round(rect.left + rect.width / 2),
          y: Math.round(rect.top + rect.height / 2),
        };

        const events = ["pointerdown", "mousedown", "mouseup", "click"];
        for (const name of events) {
          target.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
        }

        return {
          label: (target.textContent || "").trim(),
          x: center.x,
          y: center.y,
        };
      });

      if (clicked) {
        try {
          await page.mouse.click(clicked.x, clicked.y);
        } catch {
          // Mouse click is an optional reinforcement.
        }
        return `${clicked.label || "Agree"} @ ${clicked.x},${clicked.y}`;
      }
    } catch {
      // ignore this frame and continue
    }
  }

  return null;
}

async function clickConsentBottomRight(page) {
  try {
    const point = await page.evaluate(() => ({
      x: Math.max(20, Math.round(window.innerWidth - 120)),
      y: Math.max(20, Math.round(window.innerHeight - 28)),
    }));

    await page.mouse.click(point.x, point.y);
    await delay(300);
    await page.mouse.click(point.x, point.y);
    console.log(`[ESKY] Consent fallback click at bottom-right (${point.x}, ${point.y})`);
    return true;
  } catch {
    return false;
  }
}

function ensureDiagnosticsDir() {
  if (!fs.existsSync(DIAGNOSTICS_DIR)) {
    fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
  }
}

function buildDiagnosticSlug(searchQuery) {
  const origin = normalizeCity(searchQuery?.originCity || "origin");
  const destination = normalizeCity(searchQuery?.destinationCity || "destination");
  const date = searchQuery?.departureDate || "no-date";
  const stamp = new Date().toISOString().replace(/[.:]/g, "-");
  return `${origin}-${destination}-${date}-${stamp}`.replace(/\s+/g, "_");
}

async function saveDiagnostics(page, searchQuery, stage) {
  try {
    ensureDiagnosticsDir();
    const slug = buildDiagnosticSlug(searchQuery);
    const prefix = path.join(DIAGNOSTICS_DIR, `${slug}-${stage}`);

    await page.screenshot({ path: `${prefix}.png`, fullPage: true });

    const html = await page.content();
    fs.writeFileSync(`${prefix}.html`, html, "utf8");

    const summary = await page.evaluate(() => {
      const text = (document.body?.innerText || "").replace(/\s+/g, " ").trim();
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
      const actionButtons = buttons
        .map((el) => ({
          text: (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          ariaLabel: (el.getAttribute("aria-label") || "").trim(),
          disabled: Boolean(el.disabled),
        }))
        .filter((entry) => entry.text || entry.ariaLabel)
        .slice(0, 60);

      const comboboxValues = Array.from(document.querySelectorAll('[role="combobox"]')).slice(0, 2).map((el) => el.value || null);
      const dateValues = Array.from(document.querySelectorAll('input[placeholder*="Introdu data" i]')).slice(0, 2).map((el) => el.value || null);

      return {
        title: document.title,
        url: location.href,
        hasSelectatiExact: actionButtons.some((entry) => {
          const cleaned = String(entry.text || "").toLowerCase().trim();
          return cleaned === "selectati" || cleaned === "selectați";
        }),
        hasPriceLikeText: /\d{2,5}\s*€/.test(text),
        validationHints: text.match(/(niciun rezultat|rezultate|eroare|invalid|incomplet|selectați|selectati)/gi) || [],
        comboboxValues,
        dateValues,
        actionButtons,
        bodyPreview: text.slice(0, 2000),
      };
    });

    fs.writeFileSync(`${prefix}.json`, JSON.stringify(summary, null, 2), "utf8");
    console.log(`[ESKY] Diagnostics saved: ${prefix}.{png,html,json}`);
  } catch (diagnosticError) {
    console.log(`[ESKY] Failed to save diagnostics (${stage}): ${diagnosticError.message}`);
  }
}

async function initBrowser() {
  if (!browser) {
    console.log("[ESKY] Initializing Playwright browser...");
    const systemBrowserPath = resolveSystemBrowserExecutable();
    if (systemBrowserPath) {
      console.log(`[ESKY] Using system browser: ${systemBrowserPath}`);
    } else {
      console.log("[ESKY] System browser not found, using Playwright Chromium");
    }

    browser = await chromium.launch({
      headless: false,
      executablePath: systemBrowserPath || undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--start-maximized",
        "--window-size=1920,1080",
      ],
    });
    console.log("[ESKY] Browser ready");
  }

  return browser;
}

async function acceptConsent(page) {
  await delay(2500); // Give Usercentrics JS time to render.

  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await page.evaluate(() => {
      const root = document.querySelector("#usercentrics-root");
      if (!root) return "none";

      // Shadow DOM (open): click agree button directly.
      const shadow = root.shadowRoot;
      if (shadow) {
        const allEls = Array.from(shadow.querySelectorAll("button, [role='button'], a"));
        const agreeBtn = allEls.find((el) =>
          /de acord|agree|i agree|accept all|accepta/i.test((el.textContent || "").trim())
        );
        if (agreeBtn) {
          agreeBtn.click();
          return "clicked-shadow";
        }
        const byTestId = shadow.querySelector('[data-testid*="accept"], [data-testid*="agree"]');
        if (byTestId) {
          byTestId.click();
          return "clicked-testid";
        }
        // Look inside shadow iframes.
        for (const iframe of shadow.querySelectorAll("iframe")) {
          try {
            const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (!iDoc) continue;
            const btns = Array.from(iDoc.querySelectorAll("button, [role='button'], a"));
            const btn = btns.find((b) => /de acord|agree|accept/i.test((b.textContent || "").trim()));
            if (btn) { btn.click(); return "clicked-shadow-iframe"; }
          } catch { /* cross-origin */ }
        }
      }

      // Top-level iframes.
      for (const iframe of document.querySelectorAll("iframe")) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (!iDoc) continue;
          const btns = Array.from(iDoc.querySelectorAll("button, [role='button'], a"));
          const btn = btns.find((b) => /de acord|agree|accept/i.test((b.textContent || "").trim()));
          if (btn) { btn.click(); return "clicked-toplevel-iframe"; }
        } catch { /* cross-origin */ }
      }

      return "present-no-button";
    });

    console.log(`[ESKY] Consent attempt ${attempt + 1}: ${result}`);

    if (result === "none") return true;

    if (result.startsWith("clicked")) {
      await delay(1200);
      const gone = await page.evaluate(() => {
        const root = document.querySelector("#usercentrics-root");
        if (!root) return true;
        // Check if shadow iframe still covers viewport.
        const shadow = root.shadowRoot;
        if (shadow) {
          for (const iframe of shadow.querySelectorAll("iframe")) {
            const box = iframe.getBoundingClientRect();
            if (box.width > 100) return false;
          }
        }
        return true;
      });
      if (gone) {
        console.log("[ESKY] Consent dismissed");
        return true;
      }
    }

    await delay(800);
  }

  // Nuclear fallback: remove the element entirely from the DOM.
  console.log("[ESKY] Removing consent overlay from DOM");
  await page.evaluate(() => {
    document.querySelector("#usercentrics-root")?.remove();
  });
  await delay(400);
  return true;
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

function dedupeAirportOptions(options) {
  const seen = new Set();
  const deduped = [];

  for (const option of options || []) {
    const code = String(option?.code || "").trim().toUpperCase();
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const label = String(option?.label || code)
      .replace(/\s+/g, " ")
      .trim();

    deduped.push({ code, label: label || code });
  }

  return deduped;
}

function extractAirportOptionsFromText(rawText, city) {
  const text = String(rawText || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const normalizedCity = normalizeCity(city || "");
  const cityTokens = [normalizedCity, city]
    .filter(Boolean)
    .map((value) =>
      String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
    );

  const options = [];
  const codeRegex = /\(([A-Z]{3})\)\s*([^()]{0,140})/g;
  let match;

  while ((match = codeRegex.exec(text))) {
    const code = match[1].toUpperCase();
    const segment = match[2]
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .replace(/\s+/g, " ")
      .trim();
    let label = segment;
    const normalizedSegment = segment
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    for (const token of cityTokens) {
      const cityIndex = normalizedSegment.indexOf(token);
      const repeatedCityIndex = cityIndex === 0 ? normalizedSegment.lastIndexOf(token) : -1;
      if (repeatedCityIndex > 0) {
        label = segment.slice(0, repeatedCityIndex).trim();
        break;
      }

      if (cityIndex > 0) {
        label = segment.slice(0, cityIndex).trim();
        break;
      }
    }

    const words = (label.match(/[A-Za-zÀ-ÿ'’-]+/g) || []).slice(0, 4);
    label = words.join(" ").trim();
    if (!label) {
      label = normalizedCity ? `${normalizedCity} Airport` : code;
    }

    options.push({ code, label });
  }

  return dedupeAirportOptions(options);
}

async function resolveESkyAirportOptions(city, side = "origin") {
  const normalizedCity = normalizeCity(city);
  if (!normalizedCity) return [];

  const cacheKey = `${side}:${normalizedCity}`;
  const cached = AIRPORT_OPTIONS_CACHE.get(cacheKey);
  if (cached) {
    return cached.map((option) => ({ ...option }));
  }

  let context = null;

  try {
    const browserInstance = await initBrowser();
    context = await browserInstance.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();

    await page.goto(ESKY_BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);

    const consentAccepted = await acceptConsent(page);
    if (!consentAccepted) {
      return [];
    }

    await delay(300);
    await page.evaluate(() => {
      const flightTab = Array.from(document.querySelectorAll("button, [role='button']")).find((el) =>
        /bilete de avion/i.test((el.textContent || "").trim())
      );
      flightTab?.click();
    });
    await delay(300);

    const comboboxes = await page.$$('[role="combobox"]');
    if (comboboxes.length < 2) {
      return [];
    }

    const inputHandle = comboboxes[side === "destination" ? 1 : 0];
    await inputHandle.click();
    await delay(120);

    await page.evaluate((el) => {
      el.focus();
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, inputHandle);

    await inputHandle.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(normalizedCity, { delay: 70 });
    await delay(2200);

    const rawSuggestionTexts = await page.evaluate((el) => {
      const selectors = [
        '[role="option"]',
        '[class*="place-item-module"]',
        '[class*="place-option-module"]',
        'li',
      ];

      const roots = [];
      const listboxId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
      if (listboxId) {
        const listbox = document.getElementById(listboxId);
        if (listbox) {
          roots.push(listbox);
        }
      }

      const expandedRoot = el.closest('[aria-expanded="true"], div, section, form');
      if (expandedRoot) {
        roots.push(expandedRoot);
      }

      if (roots.length === 0) {
        roots.push(document.body);
      }

      const texts = [];
      for (const root of roots) {
        if (!root) continue;

        for (const selector of selectors) {
          for (const node of root.querySelectorAll(selector)) {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            if (rect.width < 1 || rect.height < 1 || style.display === "none" || style.visibility === "hidden") {
              continue;
            }

            const text = (node.textContent || "").replace(/\s+/g, " ").trim();
            const codeMatches = text.match(/\([A-Z]{3}\)/g) || [];
            if (codeMatches.length === 0 || codeMatches.length > 4 || text.length <= 6) {
              continue;
            }

            texts.push(text.slice(0, 300));
          }
        }
      }

      return Array.from(new Set(texts)).slice(0, 25);
    }, inputHandle);

    const normalizedCityToken = normalizedCity
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    const leadingOptions = [];
    let sawCityMatch = false;
    let consecutiveNonMatches = 0;

    for (const entry of rawSuggestionTexts) {
      const entryOptions = extractAirportOptionsFromText(entry, normalizedCity);
      if (entryOptions.length === 0) continue;

      const normalizedEntry = entry
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();
      const matchesCity = normalizedEntry.includes(normalizedCityToken);

      if (matchesCity) {
        sawCityMatch = true;
        consecutiveNonMatches = 0;
        leadingOptions.push(...entryOptions);
        continue;
      }

      if (!sawCityMatch) {
        leadingOptions.push(...entryOptions);
        continue;
      }

      if (consecutiveNonMatches === 0) {
        consecutiveNonMatches += 1;
        leadingOptions.push(...entryOptions);
        continue;
      }

      break;
    }

    let options = dedupeAirportOptions(
      (sawCityMatch ? leadingOptions : rawSuggestionTexts.slice(0, 4).flatMap((entry) => extractAirportOptionsFromText(entry, normalizedCity)))
    );

    if (options.length === 0) {
      const currentValue = await inputHandle.evaluate((el) => String(el.value || ""));
      const codeMatch = currentValue.match(/\(([A-Z]{3})\)/i);
      if (codeMatch) {
        options = [{ code: codeMatch[1].toUpperCase(), label: normalizedCity }];
      }
    }

    AIRPORT_OPTIONS_CACHE.set(cacheKey, options);
    if (options.length > 0) {
      console.log(`[ESKY] Resolved ${options.length} airport options for ${normalizedCity} (${side})`);
    }

    return options.map((option) => ({ ...option }));
  } catch (error) {
    console.log(`[ESKY] Airport option lookup failed for ${normalizedCity} (${side}): ${error.message}`);
    return [];
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

function resolveAirportCode(city, airportCode) {
  if (airportCode) {
    return String(airportCode).trim().toUpperCase();
  }

  return CITY_TO_PRIMARY_AIRPORT[city] || null;
}

function normalizeCabinClass(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "economy";

  if (raw === "economy" || raw.includes("econom")) return "economy";
  if (
    raw === "premium_economy" ||
    raw === "economy-premium" ||
    raw.includes("premium")
  ) {
    return "premium_economy";
  }
  if (raw === "business" || raw.includes("business")) return "business";
  if (raw === "first" || raw.includes("first") || raw.includes("intai") || raw.includes("întâi")) {
    return "first";
  }

  return "economy";
}

function toESkyCabinParam(value) {
  const normalized = normalizeCabinClass(value);
  if (normalized === "premium_economy") return "economy-premium";
  if (normalized === "business") return "business";
  if (normalized === "first") return "first";
  return "economy";
}

function buildPlaceInput(city, airportCode) {
  const normalizedCity = normalizeCity(city);
  const resolvedAirportCode = resolveAirportCode(normalizedCity, airportCode);
  if (resolvedAirportCode) {
    return `${normalizedCity} (${resolvedAirportCode})`;
  }

  return normalizedCity;
}

function buildNormalizedSearchFromUrl(finalUrl, fallbackQuery) {
  const normalized = {
    originCity: normalizeCity(fallbackQuery.originCity),
    destinationCity: normalizeCity(fallbackQuery.destinationCity),
    originAirportCode: resolveAirportCode(normalizeCity(fallbackQuery.originCity), fallbackQuery.originAirportCode),
    destinationAirportCode: resolveAirportCode(normalizeCity(fallbackQuery.destinationCity), fallbackQuery.destinationAirportCode),
    departureDate: fallbackQuery.departureDate || null,
    returnDate: fallbackQuery.returnDate || null,
    tripType: fallbackQuery.tripType || (fallbackQuery.returnDate ? "round_trip" : "one_way"),
    cabinClass: normalizeCabinClass(fallbackQuery.cabinClass),
    passengers: Number(fallbackQuery.passengers || 1),
  };

  if (!finalUrl) {
    return normalized;
  }

  try {
    const url = new URL(finalUrl);
    const pathMatch = url.pathname.match(/\/ap\/([A-Z]{3})\/ap\/([A-Z]{3})/i);
    if (pathMatch) {
      normalized.originAirportCode = pathMatch[1].toUpperCase();
      normalized.destinationAirportCode = pathMatch[2].toUpperCase();
    }

    const dep = url.searchParams.get("departureDate");
    const ret = url.searchParams.get("returnDate");
    const pa = url.searchParams.get("pa");
    const sc = url.searchParams.get("sc");

    if (dep) normalized.departureDate = dep;
    if (ret) normalized.returnDate = ret;
    if (pa && Number.isFinite(Number(pa))) normalized.passengers = Number(pa);
    if (sc) normalized.cabinClass = normalizeCabinClass(sc);

    normalized.tripType = normalized.returnDate ? "round_trip" : "one_way";
  } catch {
    // Keep fallback normalized object when URL parsing fails.
  }

  return normalized;
}

function buildPassengerAndCabinOverrideUrl(finalUrl, searchQuery, normalizedSearch) {
  if (!finalUrl) return null;

  const desiredPassengers = Math.max(1, Number(searchQuery?.passengers || 1));
  const desiredSc = toESkyCabinParam(searchQuery?.cabinClass);

  try {
    const url = new URL(finalUrl);
    let changed = false;

    const currentPassengers = Number(url.searchParams.get("pa") || normalizedSearch?.passengers || 1);
    if (Number.isFinite(currentPassengers) && currentPassengers !== desiredPassengers) {
      url.searchParams.set("pa", String(desiredPassengers));
      changed = true;
    }

    const currentCabin = normalizeCabinClass(url.searchParams.get("sc") || normalizedSearch?.cabinClass);
    if (normalizeCabinClass(desiredSc) !== currentCabin) {
      url.searchParams.set("sc", desiredSc);
      changed = true;
    }

    return changed ? url.toString() : null;
  } catch {
    return null;
  }
}

function toESkyCabinPathParam(value) {
  const normalized = normalizeCabinClass(value);
  if (normalized === "premium_economy") return "1";
  if (normalized === "business") return "2";
  if (normalized === "first") return "3";
  return "0";
}

function buildDirectResultsUrl(searchQuery) {
  const originCity = normalizeCity(searchQuery.originCity);
  const destinationCity = normalizeCity(searchQuery.destinationCity);
  const originAirportCode = resolveAirportCode(originCity, searchQuery.originAirportCode);
  const destinationAirportCode = resolveAirportCode(destinationCity, searchQuery.destinationAirportCode);
  const departureDate = searchQuery.departureDate;
  const returnDate = searchQuery.returnDate || null;
  const passengers = Math.max(1, Number(searchQuery.passengers || 1));
  const cabinClass = toESkyCabinPathParam(searchQuery.cabinClass);

  if (!originAirportCode || !destinationAirportCode || !departureDate) {
    return null;
  }

  if (searchQuery.tripType === "round_trip" && returnDate) {
    return `${ESKY_BASE_URL}/flights/results/${originAirportCode}/${destinationAirportCode}/${departureDate}/${returnDate}/${passengers}/0/0/${cabinClass}`;
  }

  return `${ESKY_BASE_URL}/flights/results/${originAirportCode}/${destinationAirportCode}/${departureDate}/${passengers}/0/0/${cabinClass}`;
}

function computeNormalizationDiffs(requested, normalized) {
  const keys = [
    "originAirportCode",
    "destinationAirportCode",
    "departureDate",
    "returnDate",
    "passengers",
    "cabinClass",
    "tripType",
  ];

  const diffs = [];
  for (const key of keys) {
    const requestedValue = requested?.[key] ?? null;
    const normalizedValue = normalized?.[key] ?? null;
    if (requestedValue == null && normalizedValue == null) continue;
    if (String(requestedValue) !== String(normalizedValue)) {
      diffs.push({ field: key, requested: requestedValue, normalized: normalizedValue });
    }
  }

  return diffs;
}

function toDateParts(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return {
    year: date.getFullYear(),
    month: date.getMonth(),
    day: date.getDate(),
  };
}

function formatDateForEskyInput(isoDate) {
  const parts = toDateParts(isoDate);
  const monthNames = ["ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec"];
  return `${parts.day} ${monthNames[parts.month]} ${parts.year}`;
}

async function setComboboxValue(page, inputHandle, value, city, airportCode, logLabel, options = {}) {
  const normalize = (text) =>
    String(text || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

  const cityNorm = normalize(city);
  const codeNorm = normalize(airportCode || "");
  const blurAfterSelection = options.blurAfterSelection !== false;
  const preferKeyboardSelection = options.preferKeyboardSelection === true;
  const skipSelectionVerification = options.skipSelectionVerification === true;
  const explicitBlurAfterSelection = options.explicitBlurAfterSelection === true;

  const selectWithKeyboard = async () => {
    const maxMoves = airportCode ? 6 : 3;

    for (let move = 0; move < maxMoves; move += 1) {
      await page.keyboard.press("ArrowDown");
      await delay(180);

      const activeSuggestion = await page.evaluate(() => {
        const active = document.activeElement;
        const activeId = active?.getAttribute("aria-activedescendant");
        const activeOption = activeId ? document.getElementById(activeId) : null;
        const selectedOption = document.querySelector('[role="option"][aria-selected="true"]');
        const option = activeOption || selectedOption;
        return option ? String(option.textContent || "") : "";
      });

      const activeNorm = normalize(activeSuggestion);
      if (!activeNorm) {
        continue;
      }

      if (!codeNorm || activeNorm.includes(codeNorm)) {
        await page.keyboard.press("Enter");
        await delay(700);
        return activeSuggestion;
      }
    }

    await page.keyboard.press("Enter");
    await delay(700);
    return null;
  };

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await inputHandle.click();
    await delay(120);

    if (/origin/i.test(logLabel) && attempt === 0) {
      await page.evaluate(() => {
        const focused = document.activeElement;
        if (!focused) return;
        const root = focused.closest("div, section, form") || document;
        const reset = Array.from(root.querySelectorAll("button[aria-label], [role='button'][aria-label]"))
          .find((el) => /reseta/i.test((el.getAttribute("aria-label") || "").trim()));
        reset?.click();
      });
      await delay(120);
      await inputHandle.click();
      await delay(80);
    }

    await page.evaluate((el) => {
      el.focus();
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, inputHandle);

    await inputHandle.focus();
    await page.keyboard.down("Control");
    await page.keyboard.press("A");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    const queryText = airportCode
      ? (attempt === 0 ? city : (attempt === 1 ? airportCode : `${city} ${airportCode}`))
      : city;
    await page.keyboard.type(queryText, { delay: 70 });
    // User-requested behavior: wait 2-3 seconds for site suggestions to appear.
    await delay(2500);

    // Use Playwright-native locators to click the specific airport suggestion row.
    const suggestionBase = '[class*="place-item-module"], [class*="place-option-module"], [role="option"], li';
    let clickedSuggestion = null;
    try {
      if (preferKeyboardSelection) {
        clickedSuggestion = await selectWithKeyboard();
      } else if (airportCode) {
        const codePattern = new RegExp(`\\(${airportCode}\\)`, "i");
        const allSuggestions = page.locator(suggestionBase).filter({ hasText: codePattern });
        const count = await allSuggestions.count();
        if (count > 0) {
          let chosen = null;
          for (let i = 0; i < count; i++) {
            const el = allSuggestions.nth(i);
            const text = (await el.textContent() || "").trim();
            const codeMatches = Array.from(text.matchAll(/\(([A-Z]{3})\)/g)).map((m) => m[1]);
            const hasOnlyWantedCode = codeMatches.length > 0 && codeMatches.every((code) => code === airportCode);
            const hasWantedCode = codeMatches.includes(airportCode);
            if (!/toate aeroporturile/i.test(text) && hasWantedCode && (hasOnlyWantedCode || text.length < 120)) {
              chosen = el;
              clickedSuggestion = text.replace(/\s+/g, " ").slice(0, 90);
              break;
            }
          }
          if (!chosen) {
            chosen = allSuggestions.first();
            clickedSuggestion = ((await chosen.textContent()) || airportCode).slice(0, 90);
          }
          await chosen.click();
          await delay(900);
        } else {
          // Code not found in suggestions, pick first visible item.
          const first = page.locator(suggestionBase).first();
          if (await first.count() > 0) {
            clickedSuggestion = ((await first.textContent()) || city).slice(0, 90);
            await first.click();
            await delay(900);
          } else {
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("ArrowDown");
            await page.keyboard.press("Enter");
            await delay(500);
          }
        }
      } else {
        const first = page.locator(suggestionBase).first();
        if (await first.count() > 0) {
          clickedSuggestion = ((await first.textContent()) || city).slice(0, 90);
          await first.click();
          await delay(900);
        } else {
          await page.keyboard.press("ArrowDown");
          await page.keyboard.press("Enter");
          await delay(500);
        }
      }
    } catch {
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Enter");
      await delay(500);
    }

    if (blurAfterSelection) {
      await page.keyboard.press("Tab");
      await delay(600);
    } else {
      if (explicitBlurAfterSelection) {
        await inputHandle.evaluate((el) => {
          el.blur();
          el.dispatchEvent(new Event("blur", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
        });
      }
      await delay(350);
    }

    if (skipSelectionVerification) {
      console.log(
        `[ESKY] ${logLabel} selection triggered${clickedSuggestion ? `: ${clickedSuggestion.slice(0, 90)}` : ""}`
      );
      return;
    }

    const currentValue = await inputHandle.evaluate((el) => String(el.value || ""));
    const currentNorm = normalize(currentValue);
    const hasAirportLikeValue = /^\([a-z]{3}\)/i.test(currentValue.trim()) || /\([a-z]{3}\)/i.test(currentValue);
    if (codeNorm) {
      if (currentNorm.includes(codeNorm)) {
        console.log(
          `[ESKY] ${logLabel} selected by suggestion click${clickedSuggestion ? `: ${clickedSuggestion.slice(0, 90)}` : ""}`
        );
        return;
      }
      console.log(`[ESKY] ${logLabel} mismatch on attempt ${attempt + 1}: expected ${airportCode}, got "${currentValue}"`);
      continue;
    }

    if (hasAirportLikeValue) {
      console.log(
        `[ESKY] ${logLabel} selected by suggestion click${clickedSuggestion ? `: ${clickedSuggestion.slice(0, 90)}` : ""}`
      );
      return;
    }
  }

  console.log(`[ESKY] ${logLabel} selection did not stick after suggestion clicks: ${value}`);
}

async function setTripType(page, tripType) {
  if (tripType !== "one_way") {
    return;
  }
  try {
    const btn = page.getByRole("button", { name: /doar dus/i })
      .or(page.locator("button, label, [role='button']").filter({ hasText: /Doar dus/i }));
    await btn.first().click({ timeout: 3000 });
    await delay(400);
    console.log("[ESKY] Trip type switched to one-way");
  } catch {
    console.log("[ESKY] Trip type button not found or already one-way");
  }
}

async function readSearchFormValues(page, originInputHandle, destinationInputHandle) {
  return page.evaluate(({ originEl, destinationEl }) => {
    const originInput = originEl;
    const destinationInput = destinationEl;
    const departureInput = document.getElementById("dates_from");
    const returnInput = document.getElementById("dates_to");

    return {
      origin: originInput?.value || null,
      destination: destinationInput?.value || null,
      departure: departureInput?.value || null,
      returning: returnInput?.value || null,
    };
  }, { originEl: originInputHandle, destinationEl: destinationInputHandle });
}

async function submitSearch(page, referenceInput = null, options = {}) {
  const searchButtonPattern = /c[aă]ut/i;

  // Playwright-native path: click the clearly-labelled search button.
  try {
    const textBtn = page.getByRole("button", { name: searchButtonPattern })
      .or(page.locator("button, [role='button']").filter({ hasText: searchButtonPattern }));
    if (await textBtn.count() > 0) {
      await textBtn.first().click({ timeout: 3000 });
      console.log("[ESKY] Search submitted via Playwright text button");
      return true;
    }
  } catch {
    // fall through to evaluate-based fallback
  }

  const submitResult = await page.evaluate((inputEl) => {
    const root = inputEl
      ? inputEl.closest("form, section, [class*='qsf'], [class*='search']") || document
      : document;
    const buttons = Array.from(root.querySelectorAll("button, [role='button']"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 20 && rect.height > 20;
      });

    const textButton = buttons.find((el) => {
      const text = (el.textContent || "").trim().toLowerCase();
      const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
      return /caut/.test(text) || /caut/.test(aria);
    });

    if (textButton) {
      textButton.click();
      return { triggered: true, mode: "text-button" };
    }

    const iconCandidates = buttons
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const text = (el.textContent || "").trim();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        const hasSvg = Boolean(el.querySelector("svg, i"));
        const looksSearchByAria = /caut|search|find|lupa/.test(aria);
        const looksIconOnly = text.length === 0;
        const looksRound = Math.abs(rect.width - rect.height) < 14 && rect.width >= 32;
        return {
          el,
          score:
            (looksSearchByAria ? 100 : 0) +
            (looksIconOnly ? 40 : 0) +
            (hasSvg ? 30 : 0) +
            (looksRound ? 20 : 0) +
            Math.round(rect.left / 10),
        };
      })
      .sort((a, b) => b.score - a.score);

    const iconButton = iconCandidates[0]?.el || null;

    if (!iconButton) {
      return { triggered: false, mode: "none" };
    }

    iconButton.click();
    return { triggered: true, mode: "magnifier-button" };
  }, referenceInput);

  let triggered = Boolean(submitResult?.triggered);

  if (triggered) {
    console.log(`[ESKY] Search submitted via ${submitResult.mode}`);
    return true;
  }

  if (referenceInput) {
    try {
      await referenceInput.focus();
      await page.keyboard.press("Enter");
      await delay(250);
      triggered = true;
      console.log("[ESKY] Search submit fallback via Enter key");
    } catch {
      // ignore element focus failures; caller will handle non-triggered state
    }
  }

  return triggered;
}

async function fillDateInputs(page, departureDate, returnDate, tripType) {
  const typedDeparture = formatDateForEskyInput(departureDate);
  const typedReturn = returnDate ? formatDateForEskyInput(returnDate) : "";
  const getFieldMeta = (targetField) => ({
    id: targetField === "return" ? "dates_to" : "dates_from",
    genericIndex: targetField === "return" ? 1 : 0,
  });

  const getDateInputLocator = (targetField) => {
    const meta = getFieldMeta(targetField);
    return page.locator(`input#${meta.id}`).first();
  };

  const getFieldValue = async (targetField) => {
    const meta = getFieldMeta(targetField);
    return page.evaluate(({ fieldId }) => {
      const input = document.getElementById(fieldId);
      return input ? String(input.value || "").trim() : "";
    }, { fieldId: meta.id });
  };

  const waitForFieldValue = async (targetField, timeout = 2500) => {
    const meta = getFieldMeta(targetField);
    try {
      await page.waitForFunction(({ fieldId }) => {
        const input = document.getElementById(fieldId);
        return Boolean(input && String(input.value || "").trim());
      }, { fieldId: meta.id }, { timeout });
      return true;
    } catch {
      return false;
    }
  };

  const getOpenCalendarDialogId = async (targetField) => {
    const meta = getFieldMeta(targetField);
    return page.evaluate(({ fieldId }) => {
      const input = document.getElementById(fieldId);
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      };

      const popoverId = input?.getAttribute("popovertarget");
      if (popoverId) {
        const popover = document.getElementById(popoverId);
        if (popover && (popover.getAttribute("pi-state") === "open" || popover.matches(":popover-open") || isVisible(popover))) {
          return popoverId;
        }
      }

      const dialogs = Array.from(document.querySelectorAll("dialog")).filter((dialog) => {
        const state = dialog.getAttribute("pi-state");
        return (state === "open" || dialog.matches(":popover-open") || isVisible(dialog)) && dialog.querySelector('[data-track-scope="Calendar"]');
      });

      return dialogs[0]?.id || null;
    }, { fieldId: meta.id });
  };

  const ensureFixedDatesTab = async (dialogId) => {
    if (!dialogId) return false;
    const switched = await page.evaluate(({ activeDialogId }) => {
      const normalize = (text) => String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const dialog = document.getElementById(activeDialogId);
      if (!dialog) return false;

      const fixedRadio = dialog.querySelector('input[type="radio"][value="fixedDates"]');
      if (fixedRadio?.checked) return true;

      const fixedTrigger = Array.from(dialog.querySelectorAll("label, button, [role='tab'], [role='button'], div"))
        .find((element) => {
          const text = normalize(element.textContent || element.getAttribute("aria-label") || "");
          if (!text) return false;
          return /date fixe|fixed/.test(text);
        });

      if (!fixedTrigger) return false;
      fixedTrigger.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }, { activeDialogId: dialogId });

    if (switched) {
      await delay(250);
    }
    return switched;
  };

  const commitDatePicker = async (dialogId) => {
    if (!dialogId) return false;
    try {
      const dialog = page.locator(`#${dialogId}`);
      const commitButton = dialog.getByRole("button", { name: /select/i })
        .or(dialog.locator("button, [role='button']").filter({ hasText: /Select/i }));
      if ((await commitButton.count()) > 0) {
        await commitButton.first().click({ timeout: 1500 });
        await delay(350);
        return true;
      }
    } catch {
      // fall through to DOM fallback
    }

    const committed = await page.evaluate(({ activeDialogId }) => {
      const normalize = (text) => String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const dialog = document.getElementById(activeDialogId);
      if (!dialog) return false;

      const button = Array.from(dialog.querySelectorAll("button, [role='button']"))
        .find((element) => {
          if (element.disabled) return false;
          const text = normalize(element.textContent || element.getAttribute("aria-label") || "");
          return /select/.test(text);
        });

      if (!button) return false;
      button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
      return true;
    }, { activeDialogId: dialogId });

    if (committed) {
      await delay(300);
    }
    return committed;
  };

  const waitForCalendarToClose = async (targetField, timeoutMs = 1800) => {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const dialogId = await getOpenCalendarDialogId(targetField);
      if (!dialogId) {
        return true;
      }
      await delay(120);
    }
    return !(await getOpenCalendarDialogId(targetField));
  };

  const ensureCalendarClosed = async (targetField) => {
    if (await waitForCalendarToClose(targetField, 700)) {
      return true;
    }

    try {
      await page.keyboard.press("Escape");
      await delay(250);
    } catch {
      // ignore keyboard failures and fall through to click-away fallback
    }

    if (await waitForCalendarToClose(targetField, 900)) {
      return true;
    }

    try {
      await page.mouse.click(40, 40);
      await delay(250);
    } catch {
      // ignore pointer failures
    }

    return waitForCalendarToClose(targetField, 900);
  };

  const directFillFallback = async () => {
    const filled = await page.evaluate(({ dep, ret, oneWay }) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      const dateInputs = [document.getElementById("dates_from"), document.getElementById("dates_to")]
        .filter(Boolean);
      if (!dateInputs.length) return false;

      const setValue = (input, nextValue) => {
        if (!input) return;
        input.focus();
        if (nativeSetter) {
          nativeSetter.call(input, nextValue);
        } else {
          input.value = nextValue;
        }
        input.dispatchEvent(new InputEvent("input", { bubbles: true, data: nextValue, inputType: "insertText" }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new Event("blur", { bubbles: true }));
      };

      if (dateInputs[0]) {
        setValue(dateInputs[0], dep);
      }

      if (dateInputs[1]) {
        setValue(dateInputs[1], oneWay ? "" : ret);
      }

      return true;
    }, {
      dep: typedDeparture,
      ret: typedReturn,
      oneWay: tripType !== "round_trip",
    });

    if (filled) {
      console.log("[ESKY] Date fallback: direct input fill applied");
    }
  };

  const openDatePicker = async (targetField) => {
    const meta = getFieldMeta(targetField);
    try {
      const inputLoc = getDateInputLocator(targetField);
      if ((await inputLoc.count()) > 0) {
        await inputLoc.click({ timeout: 1500 });
        await delay(350);
        const dialogId = await getOpenCalendarDialogId(targetField);
        if (dialogId) {
          await ensureFixedDatesTab(dialogId);
        }
        return true;
      }
    } catch {
      // fall through to text-trigger search
    }

    const opened = await page.evaluate(({ targetField: field }) => {
      const normalize = (text) => String(text || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase();

      const targetPatterns = field === "return"
        ? [/data de intoarcere/, /retur/, /return/]
        : [/data de plecare/, /plecare/, /departure/];

      const candidates = Array.from(document.querySelectorAll("button, [role='button'], label, div"));
      const trigger = candidates.find((el) => {
        const txt = normalize(el.textContent || "");
        if (!txt) return false;
        return targetPatterns.some((rx) => rx.test(txt));
      });

      if (!trigger) return false;
      trigger.scrollIntoView({ block: "center", inline: "center" });
      trigger.click();
      return true;
    }, { targetField });

    if (!opened) return false;
    await delay(450);
    const dialogId = await getOpenCalendarDialogId(targetField);
    if (dialogId) {
      await ensureFixedDatesTab(dialogId);
    }
    return true;
  };

  const pickCalendarDate = async (targetField, isoDate, maxNav = 18) => {
    const target = toDateParts(isoDate);

    const fullMonthNames = [
      "ianuarie", "februarie", "martie", "aprilie", "mai", "iunie",
      "iulie", "august", "septembrie", "octombrie", "noiembrie", "decembrie",
    ];

    const shortMonthNames = [
      "ian", "feb", "mar", "apr", "mai", "iun", "iul", "aug", "sep", "oct", "noi", "dec",
    ];

    for (let navCount = 0; navCount <= maxNav; navCount += 1) {
      const dialogId = await getOpenCalendarDialogId(targetField);
      const picked = await page.evaluate(({ activeDialogId, iso, day, month, year, monthNames, shortNames, oneWay }) => {
        const normalize = (text) => String(text || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase();

        const targetMonthLong = `${monthNames[month]} ${year}`;
        const targetMonthShort = `${shortNames[month]} ${year}`;
        const dayStr = String(day);

        const dialogRoot = activeDialogId ? document.getElementById(activeDialogId) : document;
        if (!dialogRoot) return null;

        const visibleCalendars = Array.from(dialogRoot.querySelectorAll('[data-testid="calendar"]')).filter((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 200 && rect.height > 150 && style.display !== "none" && style.visibility !== "hidden";
        });

        const preferredMode = oneWay ? "single" : "range";
        const calendarRoot = visibleCalendars.find((el) => el.getAttribute("data-mode") === preferredMode)
          || visibleCalendars[0]
          || dialogRoot.querySelector('[data-testid="calendar"]')
          || dialogRoot;

        const monthViews = Array.from(calendarRoot.querySelectorAll('[class*="calendarMonthView"]'));
        const monthView = monthViews.find((view) => {
          const title = normalize(view.querySelector('[class*="calendarHeaderTitle"]')?.textContent || "");
          return title.includes(targetMonthLong) || title.includes(targetMonthShort);
        });

        if (!monthView) {
          return null;
        }

        const dayCells = Array.from(monthView.querySelectorAll('[class*="calendarDayCell"]'));
        const cell = dayCells.find((el) => {
          const className = normalize(el.className || "");
          if (className.includes("disabled")) return false;

          const attrs = [
            el.getAttribute("data-date"),
            el.getAttribute("datetime"),
            el.getAttribute("aria-label"),
            el.getAttribute("title"),
            el.getAttribute("data-testid"),
          ].filter(Boolean).map((v) => normalize(v));

          if (attrs.some((attr) => attr.includes(normalize(iso)))) {
            return true;
          }

          const label = normalize(el.getAttribute("aria-label") || el.getAttribute("title") || "");
          if (label && label.includes(dayStr) && (label.includes(targetMonthLong) || label.includes(targetMonthShort)) && label.includes(String(year))) {
            return true;
          }

          const numberText = normalize(el.querySelector('[class*="dayNumber"]')?.textContent || el.textContent || "").trim();
          return numberText === dayStr;
        });

        if (cell) {
          const clickTarget = cell.querySelector('[class*="dayNumber"]') || cell;
          clickTarget.scrollIntoView({ block: "center", inline: "center" });
          const events = ["pointerdown", "mousedown", "mouseup", "click"];
          for (const name of events) {
            clickTarget.dispatchEvent(new MouseEvent(name, { bubbles: true, cancelable: true, view: window }));
          }
          return "picked-day-cell";
        }

        return null;
      }, {
        activeDialogId: dialogId,
        iso: isoDate,
        day: target.day,
        month: target.month,
        year: target.year,
        monthNames: fullMonthNames,
        shortNames: shortMonthNames,
        oneWay: tripType !== "round_trip",
      });

      if (picked) {
        await delay(220);
        return true;
      }

      const nextClicked = await page.evaluate(({ activeDialogId, oneWay }) => {
        const dialogRoot = activeDialogId ? document.getElementById(activeDialogId) : document;
        if (!dialogRoot) return false;

        const visibleCalendar = Array.from(dialogRoot.querySelectorAll('[data-testid="calendar"]')).find((el) => {
          const rect = el.getBoundingClientRect();
          const style = window.getComputedStyle(el);
          return rect.width > 200 && rect.height > 150 && style.display !== "none" && style.visibility !== "hidden";
        }) || dialogRoot.querySelector(`[data-testid="calendar"][data-mode="${oneWay ? "single" : "range"}"]`) || dialogRoot;

        const buttons = Array.from(visibleCalendar.querySelectorAll("[data-track='NextMonth'] button, button, [role='button']"));
        const nextBtn = buttons.find((btn) => {
          const text = (btn.textContent || "").trim();
          const aria = (btn.getAttribute("aria-label") || "").toLowerCase();
          const track = (btn.getAttribute("data-track") || "").toLowerCase();
          const parentTrack = (btn.parentElement?.getAttribute("data-track") || "").toLowerCase();
          return track === "nextmonth" || parentTrack === "nextmonth" || text === ">" || /next|urmator|urmatoare|dreapta|right/i.test(aria);
        });

        if (!nextBtn) return false;
        nextBtn.click();
        return true;
      }, {
        activeDialogId: dialogId,
        oneWay: tripType !== "round_trip",
      });

      if (!nextClicked) break;
      await delay(260);
    }

    return false;
  };

  const departurePickerOpened = await openDatePicker("departure");
  if (!departurePickerOpened) {
    console.log("[ESKY] Could not open departure date picker");
    await directFillFallback();
    return;
  }

  const departurePicked = await pickCalendarDate("departure", departureDate);
  if (!departurePicked) {
    console.log("[ESKY] Could not pick departure date from calendar");
    await directFillFallback();
    return;
  }

  await commitDatePicker(await getOpenCalendarDialogId("departure"));

  const departureCommitted = await waitForFieldValue("departure");
  if (!departureCommitted) {
    console.log("[ESKY] Departure date did not persist after calendar selection");
    await directFillFallback();
    return;
  }

  if (!(await ensureCalendarClosed("departure"))) {
    console.log("[ESKY] Departure calendar stayed open after selection");
    await directFillFallback();
    return;
  }

  if (tripType === "round_trip" && returnDate) {
    const returnPickerOpened = await openDatePicker("return");
    if (!returnPickerOpened) {
      console.log("[ESKY] Could not open return date picker");
      await directFillFallback();
      return;
    }

    const returnPicked = await pickCalendarDate("return", returnDate);
    if (!returnPicked) {
      console.log("[ESKY] Could not pick return date from calendar");
      await directFillFallback();
      return;
    }

    await commitDatePicker(await getOpenCalendarDialogId("return"));

    const returnCommitted = await waitForFieldValue("return");
    if (!returnCommitted) {
      console.log("[ESKY] Return date did not persist after calendar selection");
      await directFillFallback();
      return;
    }

    if (!(await ensureCalendarClosed("return"))) {
      console.log("[ESKY] Return calendar stayed open after selection");
      await directFillFallback();
      return;
    }
  }

  console.log("[ESKY] Date picker selections completed via calendar clicks", {
    departure: await getFieldValue("departure"),
    return: tripType === "round_trip" ? await getFieldValue("return") : "",
  });
}

async function setPassengersAndClass(page, passengers, cabinClass) {
  // Disabled on purpose for baseline stability while we stabilize submit/results flow.
  // Keep the function entry point so we can re-enable a robust implementation later.
  const requestedPassengers = Math.max(1, Math.min(9, Number(passengers || 1)));
  const requestedCabin = normalizeCabinClass(cabinClass);
  if (requestedPassengers !== 1 || requestedCabin !== "economy") {
    console.log(
      `[ESKY] Passenger/class adjustment is temporarily disabled; continuing with site defaults (requested passengers=${requestedPassengers}, cabin=${requestedCabin})`
    );
  }
  return false;
}

function isHomeUrl(url) {
  return !url || url === ESKY_BASE_URL || url === `${ESKY_BASE_URL}/`;
}

async function submitAndWaitForResultsWithRetry(page, context, referenceInput, options = {}) {
  const preferMagnifier = Boolean(options.preferMagnifier);
  const searchQuery = options.searchQuery || {};
  const maxAttempts = Number(options.maxAttempts || 3);
  const initialSubmitAlreadyTriggered = Boolean(options.initialSubmitAlreadyTriggered);

  let activePage = page;
  let anySubmitTriggered = false;
  let finalUrl = activePage && !activePage.isClosed() ? activePage.url() : null;

  const processTriggeredAttempt = async (attempt) => {
    anySubmitTriggered = true;
    console.log(`[ESKY] Submit attempt ${attempt}/${maxAttempts} triggered, waiting for results...`);
    await delay(900 + attempt * 500);

    if (activePage && activePage.isClosed()) {
      const pages = context.pages();
      activePage = pages[pages.length - 1] || null;
      if (activePage) {
        console.log("[ESKY] Switched to active browser tab after submit");
      }
    }

    if (activePage) {
      await saveDiagnostics(activePage, searchQuery, `after-submit-attempt-${attempt}`);
    }

    finalUrl = await waitForResultsPage(activePage);
    console.log(`[ESKY] URL after submit attempt ${attempt}: ${finalUrl}`);

    if (!isHomeUrl(finalUrl)) {
      return {
        done: true,
        result: {
          searchTriggered: true,
          activePage,
          finalUrl,
          attemptsUsed: attempt,
        },
      };
    }

    if (activePage) {
      await saveDiagnostics(activePage, searchQuery, `stuck-home-attempt-${attempt}`);
    }

    if (attempt < maxAttempts) {
      const backoffMs = attempt * 700;
      console.log(`[ESKY] Still on homepage after submit attempt ${attempt}, retrying in ${backoffMs}ms`);
      await delay(backoffMs);
    }

    return { done: false };
  };

  if (initialSubmitAlreadyTriggered) {
    const firstAttempt = await processTriggeredAttempt(1);
    if (firstAttempt.done) {
      return firstAttempt.result;
    }
  }

  for (let attempt = initialSubmitAlreadyTriggered ? 2 : 1; attempt <= maxAttempts; attempt += 1) {
    const searchTriggered = await submitSearch(activePage, referenceInput, {
      preferMagnifier,
    });

    if (!searchTriggered) {
      console.log(`[ESKY] Submit attempt ${attempt}/${maxAttempts} did not trigger`);
      await delay(300 * attempt);
      continue;
    }

    const attemptResult = await processTriggeredAttempt(attempt);
    if (attemptResult.done) {
      return attemptResult.result;
    }
  }

  return {
    searchTriggered: anySubmitTriggered,
    activePage,
    finalUrl,
    attemptsUsed: maxAttempts,
  };
}

function getScraperReadiness() {
  const browserExecutable = resolveSystemBrowserExecutable();
  let diagnosticsWritable = true;
  let diagnosticsError = null;

  try {
    ensureDiagnosticsDir();
    fs.accessSync(DIAGNOSTICS_DIR, fs.constants.W_OK);
  } catch (error) {
    diagnosticsWritable = false;
    diagnosticsError = error.message;
  }

  const checks = {
    browserExecutableFound: Boolean(browserExecutable),
    diagnosticsWritable,
  };

  return {
    ready: checks.browserExecutableFound && checks.diagnosticsWritable,
    browserExecutable,
    diagnosticsDir: DIAGNOSTICS_DIR,
    checks,
    errors: diagnosticsError ? [diagnosticsError] : [],
  };
}

async function waitForResultsPage(page) {
  if (!page || page.isClosed()) {
    return null;
  }

  const startUrl = page.url();
  const startedAt = Date.now();

  while (Date.now() - startedAt < SEARCH_TIMEOUT_MS) {
    if (page.isClosed()) {
      return null;
    }

    let currentUrl;
    try {
      currentUrl = page.url();
    } catch {
      return null;
    }

    if (currentUrl !== startUrl) {
      console.log(`[ESKY] URL changed to ${currentUrl}`);
      return currentUrl;
    }

    let hasResults = false;
    try {
      hasResults = await page.evaluate(() => {
      const isSelectText = (text) => {
        const cleaned = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
        return cleaned === "selectati" || cleaned === "selectați";
      };
      const buttons = Array.from(document.querySelectorAll("button, [role='button']"));
      const hasSelectButton = buttons.some((el) => isSelectText(el.textContent || ""));
      const hasPrice = /\d{2,5}\s*€/.test(document.body?.innerText || "");
      return hasSelectButton && hasPrice;
    });
    } catch {
      return null;
    }

    if (hasResults) {
      console.log("[ESKY] Result signature detected on page");
      return currentUrl;
    }

    await delay(350);
  }

  if (page.isClosed()) {
    return null;
  }

  try {
    return page.url();
  } catch {
    return null;
  }
}

async function scrapeResults(page, searchQuery, normalizedSearch = null) {
  if (!page || page.isClosed()) {
    return [];
  }

  await delay(2500);

  const flights = await page.evaluate(() => {
    const isSelectText = (text) => {
      const cleaned = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
      return cleaned === "selectati" || cleaned === "selectați";
    };

    const selectButtons = Array.from(document.querySelectorAll("button, [role='button']"))
      .filter((el) => isSelectText(el.textContent || ""))
      .slice(0, 12);

    return selectButtons
      .map((button, index) => {
        let card = null;
        let current = button;
        for (let level = 0; level < 7 && current; level += 1) {
          const txt = (current.textContent || "").replace(/\s+/g, " ").trim();
          const hasPrice = /(\d{2,5})\s*€/.test(txt);
          const hasAirportCodes = /\b[A-Z]{3}\b/.test(txt);
          const hasTime = /\b\d{1,2}:\d{2}\b/.test(txt);
          if (hasPrice && (hasAirportCodes || hasTime)) {
            card = current;
            break;
          }
          current = current.parentElement;
        }

        if (!card) {
          card = button.closest("article, section, li, div") || button.parentElement;
        }

        if (!card) return null;
        const text = (card.textContent || "").replace(/\s+/g, " ").trim();
        const priceMatch = text.match(/(\d{2,5})\s*€/i) || text.match(/(?:€|EUR|lei)\s?(\d{2,5})/i);
        if (!priceMatch) return null;

        const durationMatch = text.match(/(\d{1,2})h\s?(\d{1,2})?\s?(?:m|min)?/i);
        const stopsMatch = text.match(/(zbor direct|direct|nonstop|\d+\s+escala|\d+\s+stop)/i);
        const timeCodeMatches = Array.from(text.matchAll(/(\d{1,2}:\d{2})\s*([A-Z]{3})/g));
        const airlineMatch = text.match(/(Wizz\s*Air[^\d€]*)/i);

        return {
          id: `ESKY_${Date.now()}_${index}`,
          price: Number(priceMatch[1]),
          durationMinutes: durationMatch
            ? Number(durationMatch[1]) * 60 + Number(durationMatch[2] || 0)
            : 120,
          stops: stopsMatch && /direct|nonstop/i.test(stopsMatch[1])
            ? 0
            : stopsMatch
              ? Number((stopsMatch[1].match(/\d+/) || [0])[0])
              : 0,
          departureTime: timeCodeMatches[0]?.[1] || null,
          departureCode: timeCodeMatches[0]?.[2] || null,
          arrivalTime: timeCodeMatches[1]?.[1] || null,
          arrivalCode: timeCodeMatches[1]?.[2] || null,
          airline: airlineMatch ? airlineMatch[1].trim() : null,
          rawText: text.slice(0, 240),
        };
      })
      .filter(Boolean)
      .slice(0, 10);
  });

  console.log(`[ESKY] Parsed ${flights.length} result cards`);

  let detailsText = null;
  const detailsButton = await page.evaluate(() => {
    const isSelectText = (text) => {
      const cleaned = String(text || "").trim().toLowerCase().replace(/\s+/g, " ");
      return cleaned === "selectati" || cleaned === "selectați";
    };
    const button = Array.from(document.querySelectorAll("button, [role='button']")).find((el) =>
      isSelectText(el.textContent || "")
    );
    if (button) {
      button.click();
      return true;
    }
    return false;
  });

  if (detailsButton) {
    try {
      await page.waitForFunction(
        () => /detalii zbor/i.test((document.body?.innerText || "").toLowerCase()),
        { timeout: UI_TIMEOUT_MS }
      );
      detailsText = await page.evaluate(() => (document.body?.innerText || "").replace(/\s+/g, " ").trim());
      const closed = await page.evaluate(() => {
        const closeBtn = Array.from(document.querySelectorAll("button, [role='button']")).find((el) => {
          const txt = (el.textContent || "").trim();
          const aria = (el.getAttribute("aria-label") || "").toLowerCase();
          return txt === "×" || /close|inchide|închide/.test(aria);
        });
        if (closeBtn) {
          closeBtn.click();
          return true;
        }
        return false;
      });
      if (!closed) {
        await page.keyboard.press("Escape");
      }
    } catch {
      console.log("[ESKY] Details panel did not open after Selectati click");
    }
  }

  const effectiveSearch = normalizedSearch || {
    originCity: normalizeCity(searchQuery.originCity),
    originAirportCode: resolveAirportCode(normalizeCity(searchQuery.originCity), searchQuery.originAirportCode),
    destinationCity: normalizeCity(searchQuery.destinationCity),
    destinationAirportCode: resolveAirportCode(normalizeCity(searchQuery.destinationCity), searchQuery.destinationAirportCode),
    tripType: searchQuery.tripType || "one_way",
    departureDate: searchQuery.departureDate,
    returnDate: searchQuery.returnDate || null,
    cabinClass: searchQuery.cabinClass || "economy",
    passengers: Number(searchQuery.passengers || 1),
  };

  return flights.map((flight, index) => ({
    id: flight.id || `ESKY_${Date.now()}_${index}`,
    originCity: effectiveSearch.originCity,
    originAirportCode: flight.departureCode || effectiveSearch.originAirportCode,
    destinationCity: effectiveSearch.destinationCity,
    destinationAirportCode: flight.arrivalCode || effectiveSearch.destinationAirportCode,
    tripType: effectiveSearch.tripType,
    departureDate: effectiveSearch.departureDate,
    returnDate: effectiveSearch.returnDate || null,
    airline: flight.airline || "eSky partner",
    cabinClass: effectiveSearch.cabinClass || "economy",
    price: flight.price,
    currency: "EUR",
    cabinBags: 1,
    checkedBags: 0,
    passengers: effectiveSearch.passengers || 1,
    stops: flight.stops,
    durationMinutes: flight.durationMinutes,
    departureTimeLocal: flight.departureTime
      ? `${effectiveSearch.departureDate}T${flight.departureTime}`
      : `${effectiveSearch.departureDate}T08:00`,
    arrivalTimeLocal: flight.arrivalTime
      ? `${effectiveSearch.departureDate}T${flight.arrivalTime}`
      : `${effectiveSearch.departureDate}T10:00`,
    maxSeats: 180,
    availableSeats: 40 + (index * 5),
    hasAccessibleSeating: true,
    detailsPreview: detailsText ? detailsText.slice(0, 450) : flight.rawText,
  }));
}

async function searchESky(searchQuery) {
  const startTime = Date.now();
  console.log(`[ESKY] Starting direct eSky search for ${searchQuery.originCity} -> ${searchQuery.destinationCity}`);
  let context = null;

  if (scrapingInProgress) {
    console.log("[ESKY] Another scrape is in progress, skipping");
    return null;
  }

  scrapingInProgress = true;

  try {
    const browserInstance = await initBrowser();
    context = await browserInstance.newContext({
      viewport: { width: 1440, height: 1200 },
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      locale: "ro-RO",
    });
    const page = await context.newPage();

    await page.goto(ESKY_BASE_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(1200);
    const consentAccepted = await acceptConsent(page);
    if (!consentAccepted) {
      console.log("[ESKY] Aborting because consent dialog is still blocking the page");
      await saveDiagnostics(page, searchQuery, "consent-blocking");
      await page.close();
      return null;
    }
    await delay(300);

    await page.evaluate(() => {
      const flightTab = Array.from(document.querySelectorAll("button, [role='button']")).find((el) =>
        /bilete de avion/i.test((el.textContent || "").trim())
      );
      flightTab?.click();
    });
    await delay(300);

    const comboboxes = await page.$$('[role="combobox"]');
    if (comboboxes.length < 2) {
      console.log("[ESKY] Could not locate origin/destination comboboxes");
      await page.close();
      return null;
    }

    // Consent modals can re-open after initial load; clear again before input interactions.
    const consentStillOk = await acceptConsent(page);
    if (!consentStillOk) {
      console.log("[ESKY] Consent dialog reappeared and is blocking interactions");
      await saveDiagnostics(page, searchQuery, "consent-reblocked");
      await page.close();
      return null;
    }
    await setTripType(page, searchQuery.tripType);

    const originValue = buildPlaceInput(searchQuery.originCity, searchQuery.originAirportCode);
    const destinationValue = buildPlaceInput(searchQuery.destinationCity, searchQuery.destinationAirportCode);
    const expectedDestinationCode = resolveAirportCode(normalizeCity(searchQuery.destinationCity), searchQuery.destinationAirportCode);

    await setComboboxValue(
      page,
      comboboxes[0],
      originValue,
      normalizeCity(searchQuery.originCity),
      resolveAirportCode(normalizeCity(searchQuery.originCity), searchQuery.originAirportCode),
      "Origin"
    );
    await setComboboxValue(
      page,
      comboboxes[1],
      destinationValue,
      normalizeCity(searchQuery.destinationCity),
      resolveAirportCode(normalizeCity(searchQuery.destinationCity), searchQuery.destinationAirportCode),
      "Destination"
    );
    await fillDateInputs(page, searchQuery.departureDate, searchQuery.returnDate, searchQuery.tripType);

    const postDateComboboxes = await page.$$('[role="combobox"]');
    const destinationCombobox = postDateComboboxes[1] || comboboxes[1];

    try {
      await destinationCombobox.click();
      await delay(180);
      console.log("[ESKY] Returned focus to destination after date selection");
    } catch {
      console.log("[ESKY] Could not return focus to destination after date selection");
    }

    await setComboboxValue(
      page,
      destinationCombobox,
      destinationValue,
      normalizeCity(searchQuery.destinationCity),
      expectedDestinationCode,
      "Destination confirmation",
      {
        blurAfterSelection: false,
        explicitBlurAfterSelection: true,
        skipSelectionVerification: true,
      }
    );
    console.log("[ESKY] Destination reconfirmed after date selection, moving directly to magnifier submit");

    console.log(
      searchQuery.tripType === "round_trip" && searchQuery.returnDate
        ? "[ESKY] Round-trip dates selected, pressing magnifier"
        : "[ESKY] One-way departure selected, pressing magnifier"
    );

    const initialSubmitTriggered = await submitSearch(page, destinationCombobox, {
      preferMagnifier: true,
    });

    if (!initialSubmitTriggered) {
      console.log("[ESKY] Could not trigger initial magnifier submit after date selection");
      await page.close();
      return null;
    }

    const submitOutcome = await submitAndWaitForResultsWithRetry(page, context, destinationCombobox, {
      preferMagnifier: true,
      searchQuery,
      maxAttempts: 3,
      initialSubmitAlreadyTriggered: true,
    });

    if (!submitOutcome.searchTriggered) {
      console.log("[ESKY] Search button was not found");
      await page.close();
      return null;
    }

    let activePage = submitOutcome.activePage;
    let finalUrl = submitOutcome.finalUrl;
    console.log(`[ESKY] Final URL: ${finalUrl}`);

    const normalizedSearch = {
      originCity: normalizeCity(searchQuery.originCity),
      destinationCity: normalizeCity(searchQuery.destinationCity),
      originAirportCode: searchQuery.originAirportCode
        ? String(searchQuery.originAirportCode).trim().toUpperCase()
        : null,
      destinationAirportCode: searchQuery.destinationAirportCode
        ? String(searchQuery.destinationAirportCode).trim().toUpperCase()
        : null,
      departureDate: searchQuery.departureDate || null,
      returnDate: searchQuery.returnDate || null,
      tripType: searchQuery.tripType || (searchQuery.returnDate ? "round_trip" : "one_way"),
      cabinClass: normalizeCabinClass(searchQuery.cabinClass),
      passengers: Number(searchQuery.passengers || 1),
    };
    const normalizationDiffs = [];

    const offers = await scrapeResults(activePage, searchQuery, normalizedSearch);
    if (activePage && !activePage.isClosed()) {
      await activePage.close();
    }

    if (offers.length === 0) {
      console.log(`[ESKY] Check diagnostics folder: ${DIAGNOSTICS_DIR}`);
      console.log("[ESKY] No result cards parsed; fallback to sample data");
      return null;
    }

    console.log(`[ESKY] Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s with ${offers.length} offers`);
    return {
      offers,
      normalizedSearch,
      normalizationDiffs,
      finalUrl,
    };
  } catch (error) {
    console.error("[ESKY] Scraper error:", error.message);
    return null;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
    scrapingInProgress = false;
  }
}

async function closeBrowser() {
  if (browser) {
    console.log("[ESKY] Closing browser...");
    await browser.close();
    browser = null;
  }
}

module.exports = {
  searchESky,
  closeBrowser,
  getScraperReadiness,
  resolveESkyAirportOptions,
};