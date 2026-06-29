require("dotenv").config();
const express = require("express");
const http = require("http");
const axios = require("axios");
const cors = require("cors");
const { searchFlights } = require("./services/searchFlights");
const {
  searchESky,
  closeBrowser,
  getScraperReadiness,
  resolveESkyAirportOptions,
} = require("./services/eSkyScraper");
const { searchVola, buildVolaResultsUrl } = require("./services/volaScraper");
const {
  buildPaymentProviderConfig,
  createPaymentSession,
  confirmPaymentSession,
  handlePaymentWebhook,
} = require("./services/paymentProvider");
const { getDemoReadiness } = require("./services/demoReadiness");

const app = express();
app.use(cors());
app.use(express.json());

const OLLAMA_URL = "http://localhost:11434/api/generate";
const MODEL = "qwen2.5:7b";
const CHAT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_CHAT_SESSIONS = 200;
const chatSessions = new Map();

function createRequestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createChatSessionId() {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSessionId(value) {
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(trimmed)) return null;

  return trimmed;
}

function clonePendingNormalization(value) {
  if (!value) return null;

  return {
    requestedSearch: { ...(value.requestedSearch || {}) },
    normalizedSearch: { ...(value.normalizedSearch || {}) },
    normalizationDiffs: Array.isArray(value.normalizationDiffs)
      ? value.normalizationDiffs.map((diff) => ({ ...diff }))
      : [],
    offers: Array.isArray(value.offers)
      ? value.offers.map((offer) => ({ ...offer }))
      : [],
  };
}

function pruneChatSessions(now = Date.now()) {
  for (const [sessionId, session] of chatSessions.entries()) {
    if (now - (session.updatedAt || 0) > CHAT_SESSION_TTL_MS) {
      chatSessions.delete(sessionId);
    }
  }

  if (chatSessions.size <= MAX_CHAT_SESSIONS) {
    return;
  }

  const overflow = chatSessions.size - MAX_CHAT_SESSIONS;
  const oldestSessions = [...chatSessions.entries()]
    .sort((a, b) => (a[1].updatedAt || 0) - (b[1].updatedAt || 0))
    .slice(0, overflow);

  for (const [sessionId] of oldestSessions) {
    chatSessions.delete(sessionId);
  }
}

function getChatSession(sessionId) {
  pruneChatSessions();
  const existing = chatSessions.get(sessionId);

  if (!existing) {
    return {
      sessionState: {},
      pendingFields: [],
      pendingNormalization: null,
    };
  }

  return {
    sessionState: { ...(existing.sessionState || {}) },
    pendingFields: Array.isArray(existing.pendingFields) ? [...existing.pendingFields] : [],
    pendingNormalization: clonePendingNormalization(existing.pendingNormalization),
  };
}

function saveChatSession(sessionId, session) {
  chatSessions.set(sessionId, {
    sessionState: { ...(session?.sessionState || {}) },
    pendingFields: Array.isArray(session?.pendingFields) ? [...session.pendingFields] : [],
    pendingNormalization: clonePendingNormalization(session?.pendingNormalization),
    updatedAt: Date.now(),
  });

  pruneChatSessions();
}

function clearChatSession(sessionId) {
  chatSessions.delete(sessionId);
}

function logChatEvent(requestId, event, details = {}) {
  console.log(JSON.stringify({ scope: "chat", requestId, event, ...details }));
}

function buildEskyResultsUrl(searchState) {
  const cabin = {
    economy: "0",
    premium_economy: "1",
    business: "2",
    first: "3",
  };

  const origin = searchState?.originAirportCode ?? "";
  const destination = searchState?.destinationAirportCode ?? "";
  const departureDate = searchState?.departureDate ?? "";
  const returnDate = searchState?.returnDate ?? "";
  const passengers = Math.max(1, Number(searchState?.passengers || 1));
  const cabinClass = cabin[searchState?.cabinClass] ?? "0";

  if (!origin || !destination || !departureDate) {
    return null;
  }

  if (searchState?.tripType === "round_trip" && returnDate) {
    return `https://www.esky.ro/flights/results/${origin}/${destination}/${departureDate}/${returnDate}/${passengers}/0/0/${cabinClass}`;
  }

  return `https://www.esky.ro/flights/results/${origin}/${destination}/${departureDate}/${passengers}/0/0/${cabinClass}`;
}

function attachOfferMetadata(offers, supplier, fallbackBookingUrl = null) {
  return (offers || []).map((offer) => ({
    ...offer,
    supplier: offer?.supplier || supplier,
    bookingUrl:
      offer?.bookingUrl ??
      fallbackBookingUrl ??
      (supplier === "Vola" ? buildVolaResultsUrl(offer) : buildEskyResultsUrl(offer)),
  }));
}

function dedupeOffers(offers) {
  const seen = new Set();
  const deduped = [];

  for (const offer of offers || []) {
    const key = [
      offer?.supplier || "unknown",
      offer?.price ?? "na",
      offer?.originAirportCode || offer?.originCity || "origin",
      offer?.destinationAirportCode || offer?.destinationCity || "destination",
      offer?.departureDate || "date",
      offer?.departureTimeLocal || "time",
      offer?.arrivalTimeLocal || "arrival",
    ].join("|");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(offer);
  }

  return deduped;
}

function sortOffersByPrice(offers) {
  return [...(offers || [])].sort((left, right) => {
    const leftPrice = Number.isFinite(Number(left?.price)) ? Number(left.price) : Number.MAX_SAFE_INTEGER;
    const rightPrice = Number.isFinite(Number(right?.price)) ? Number(right.price) : Number.MAX_SAFE_INTEGER;
    if (leftPrice !== rightPrice) {
      return leftPrice - rightPrice;
    }

    const leftDuration = Number.isFinite(Number(left?.durationMinutes)) ? Number(left.durationMinutes) : Number.MAX_SAFE_INTEGER;
    const rightDuration = Number.isFinite(Number(right?.durationMinutes)) ? Number(right.durationMinutes) : Number.MAX_SAFE_INTEGER;
    return leftDuration - rightDuration;
  });
}

function interleaveOffersBySupplier(offers, limit = 8) {
  const sortedOffers = sortOffersByPrice(offers);
  if (sortedOffers.length <= limit) {
    return sortedOffers;
  }

  const supplierBuckets = new Map();
  const supplierOrder = [];

  for (const offer of sortedOffers) {
    const supplier = offer?.supplier || "Unknown";
    if (!supplierBuckets.has(supplier)) {
      supplierBuckets.set(supplier, []);
      supplierOrder.push(supplier);
    }
    supplierBuckets.get(supplier).push(offer);
  }

  if (supplierOrder.length <= 1) {
    return sortedOffers.slice(0, limit);
  }

  const interleaved = [];

  while (interleaved.length < limit) {
    let addedOffer = false;

    for (const supplier of supplierOrder) {
      const bucket = supplierBuckets.get(supplier);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      interleaved.push(bucket.shift());
      addedOffer = true;

      if (interleaved.length >= limit) {
        break;
      }
    }

    if (!addedOffer) {
      break;
    }
  }

  return interleaved;
}

function buildOfferComparison(offers) {
  const comparableOffers = sortOffersByPrice(
    (offers || []).filter((offer) => Number.isFinite(Number(offer?.price)))
  );
  if (comparableOffers.length === 0) {
    return null;
  }

  const cheapestOffer = comparableOffers[0];
  const nextOffer = comparableOffers[1] || null;
  const currency = cheapestOffer.currency || "EUR";
  const supplierBreakdown = [];
  const seenSuppliers = new Set();

  for (const offer of comparableOffers) {
    const supplier = offer.supplier || "Unknown";
    if (seenSuppliers.has(supplier)) continue;
    seenSuppliers.add(supplier);
    supplierBreakdown.push({
      supplier,
      price: offer.price,
      currency: offer.currency || currency,
      offerId: offer.id,
    });
  }

  const savingsVsNext = nextOffer ? Math.max(0, Number(nextOffer.price) - Number(cheapestOffer.price)) : null;
  const breakdownText = supplierBreakdown
    .map((entry) => `${entry.supplier} ${entry.price} ${entry.currency}`)
    .join(" · ");
  const leadText = savingsVsNext && savingsVsNext > 0
    ? `${cheapestOffer.supplier} is currently cheapest at ${cheapestOffer.price} ${currency}, saving ${savingsVsNext} ${currency} versus the next option.`
    : `${cheapestOffer.supplier} is currently cheapest at ${cheapestOffer.price} ${currency}.`;

  return {
    cheapestOfferId: cheapestOffer.id,
    supplier: cheapestOffer.supplier || "Unknown",
    price: cheapestOffer.price,
    currency,
    savingsVsNext,
    summary: supplierBreakdown.length > 1 ? `${leadText} Compare: ${breakdownText}.` : leadText,
    supplierBreakdown,
  };
}

const CITY_AIRPORT_OPTIONS = {
  Bucuresti: [
    { code: "OTP", label: "Otopeni Henri Coanda" },
    { code: "BBU", label: "Aurel Vlaicu Baneasa" },
  ],
  Roma: [
    { code: "FCO", label: "Fiumicino" },
    { code: "CIA", label: "Ciampino" },
  ],
  Londra: [
    { code: "LHR", label: "Heathrow" },
    { code: "LTN", label: "Luton" },
    { code: "STN", label: "Stansted" },
  ],
  Milano: [
    { code: "MXP", label: "Malpensa" },
    { code: "BGY", label: "Bergamo" },
  ],
  Paris: [
    { code: "CDG", label: "Charles de Gaulle" },
    { code: "ORY", label: "Orly" },
  ],
};

const AIRPORT_ALIASES = {
  otp: { city: "Bucuresti", code: "OTP" },
  otopeni: { city: "Bucuresti", code: "OTP" },
  henri: { city: "Bucuresti", code: "OTP" },
  coanda: { city: "Bucuresti", code: "OTP" },
  "henri coanda": { city: "Bucuresti", code: "OTP" },
  bbu: { city: "Bucuresti", code: "BBU" },
  baneasa: { city: "Bucuresti", code: "BBU" },
  "aurel vlaicu": { city: "Bucuresti", code: "BBU" },
  lhr: { city: "Londra", code: "LHR" },
  heathrow: { city: "Londra", code: "LHR" },
  ltn: { city: "Londra", code: "LTN" },
  luton: { city: "Londra", code: "LTN" },
  stn: { city: "Londra", code: "STN" },
  stansted: { city: "Londra", code: "STN" },
  mxp: { city: "Milano", code: "MXP" },
  malpensa: { city: "Milano", code: "MXP" },
  bgy: { city: "Milano", code: "BGY" },
  bergamo: { city: "Milano", code: "BGY" },
  fco: { city: "Roma", code: "FCO" },
  fiumicino: { city: "Roma", code: "FCO" },
  cia: { city: "Roma", code: "CIA" },
  ciampino: { city: "Roma", code: "CIA" },
  cdg: { city: "Paris", code: "CDG" },
  "charles de gaulle": { city: "Paris", code: "CDG" },
  ory: { city: "Paris", code: "ORY" },
  orly: { city: "Paris", code: "ORY" },
};

function getIsoDateWithOffset(daysOffset = 0) {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateAsIso(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getIsoDateFromRelativeOffset(baseDate, daysOffset = 0) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + daysOffset);
  return formatDateAsIso(date);
}

function parseIsoDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setHours(0, 0, 0, 0);
  return date;
}

const WEEKDAY_TO_INDEX = {
  sunday: 0,
  duminica: 0,
  monday: 1,
  luni: 1,
  tuesday: 2,
  marti: 2,
  wednesday: 3,
  miercuri: 3,
  thursday: 4,
  joi: 4,
  friday: 5,
  vineri: 5,
  saturday: 6,
  sambata: 6,
};

function resolveWeekdayDate(weekdayIndex, modifier = "this", baseDate = new Date()) {
  const date = new Date(baseDate);
  date.setHours(0, 0, 0, 0);

  let offset = (weekdayIndex - date.getDay() + 7) % 7;
  if (modifier === "next") {
    offset = offset === 0 ? 7 : offset + 7;
  }

  date.setDate(date.getDate() + offset);
  return formatDateAsIso(date);
}

function parseRelativeDateReference(value, baseDate = new Date()) {
  if (!value || typeof value !== "string") return null;

  const cleaned = stripDiacritics(value).trim().toLowerCase();
  if (!cleaned) return null;

  const relativeOffsets = {
    today: 0,
    azi: 0,
    tomorrow: 1,
    maine: 1,
    poimaine: 2,
    "day after tomorrow": 2,
  };

  if (cleaned in relativeOffsets) {
    return getIsoDateFromRelativeOffset(baseDate, relativeOffsets[cleaned]);
  }

  const weekdayPatterns = [
    { regex: /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, modifier: "next", group: 1 },
    { regex: /\b(this|coming)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, modifier: "this", group: 2 },
    { regex: /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/, modifier: "this", group: 1 },
    { regex: /\b(duminica|luni|marti|miercuri|joi|vineri|sambata)\s+(viitoare|urmatoare)\b/, modifier: "next", group: 1 },
    { regex: /\b(duminica|luni|marti|miercuri|joi|vineri|sambata)\b/, modifier: "this", group: 1 },
  ];

  for (const pattern of weekdayPatterns) {
    const match = cleaned.match(pattern.regex);
    if (!match) continue;

    const weekday = match[pattern.group];
    const weekdayIndex = WEEKDAY_TO_INDEX[weekday];
    if (weekdayIndex == null) continue;

    return resolveWeekdayDate(weekdayIndex, pattern.modifier, baseDate);
  }

  return null;
}

function parseRelativeDateRange(value, baseDate = new Date()) {
  if (!value || typeof value !== "string") return null;

  const cleaned = stripDiacritics(value).trim().toLowerCase();
  if (!cleaned) return null;

  const rangePatterns = [
    /^\s*(.+?)\s+(?:to|until|through|till|and)\s+(.+?)\s*$/,
    /^\s*(.+?)\s+pana(?:\s+la)?\s+(.+?)\s*$/,
    /^\s*(.+?)\s+si\s+(.+?)\s*$/,
    /^\s*([a-z].*?)\s*[-–]\s*([a-z].*?)\s*$/,
  ];

  for (const pattern of rangePatterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;

    const departureDate = parseRelativeDateReference(match[1], baseDate);
    if (!departureDate) continue;

    const departureBaseDate = parseIsoDate(departureDate);
    if (!departureBaseDate) continue;

    const returnDate = parseRelativeDateReference(match[2], departureBaseDate);
    if (!returnDate) continue;

    return { departureDate, returnDate };
  }

  return null;
}

function buildExtractionPrompt(userMessage, context, missingFields) {
  const today = getIsoDateWithOffset(0);
  const tomorrow = getIsoDateWithOffset(1);

  return `
You are an information extraction system for flight booking.

Extract flight search parameters and output ONLY valid JSON.
No markdown, no explanations, no extra text.

IMPORTANT:
You are in a conversation.
You MUST use previous extracted data together with the new message.
Today's date is ${today}.

CRITICAL:
- Output MUST be a valid JSON object
- Do NOT include any text before or after JSON
- Do NOT include trailing commas
- Do NOT include comments
- The response must be directly parsable with JSON.parse()

You MUST return ALL fields from the schema, even if null.
Do not omit any field.

Known extracted data:
${JSON.stringify(context)}

Missing fields that still need to be filled:
${JSON.stringify(missingFields)}

Merging rules:
- Merge previous data with new data
- Do not delete existing values unless user changes them
- If user gives partial info (e.g. only a city), infer the correct field based on context

Extraction rules:
- If a value is missing, use null (except adults and passengers).
- adults: number of adult passengers. If not specified, default to 1.
- children: number of child passengers (under 18). If not specified, default to 0.
- passengers: total passengers = adults + children. Always keep in sync.
- "2 adults" / "2 adulți" -> adults = 2
- "1 child" / "1 copil" / "un copil" -> children = 1
- "2 children" / "2 copii" -> children = 2
- "family of 4" -> adults = 2, children = 2
- "me and my partner" / "2 people" / "2 persoane" -> adults = 2
- If the user names a specific airport, also fill the matching airport code.
- If the user only says a city with multiple airports, keep airportCode = null so the app can ask a follow-up.
- Dates must be ISO format YYYY-MM-DD.
- Convert exact relative dates like "today", "tomorrow", "maine", "poimaine", "next Friday" into actual ISO dates.
- If the user gives a broad time window like "next week", "next month", "this weekend", or "summer", do NOT invent a specific day. Keep departureDate/returnDate as null so the app can ask for an exact date.
- Never return literal strings like "tomorrow" inside departureDate/returnDate.
- Example: "today" -> "${today}", "tomorrow" / "maine" -> "${tomorrow}"
- tripType must be "one_way" or "round_trip".
- cabinClass must be one of: "economy","premium_economy","business","first", or null.
- If the user does NOT explicitly mention a cabin class, set cabinClass to null. Do NOT default to any class.
- Only set cabinClass when the user says words like "economy", "business class", "first class", "premium economy", "clasa business", "clasa intai", "clasa economica", etc.
- baggage: cabinBags and checkedBags are integers.

Vibe/climate keywords:
- "sunny", "warm", "hot", "beach", "coastal" -> vibe = "sunny"
- "snowy", "cold", "mountains", "winter", "alpine" -> vibe = "snowy"
- "temperate", "mild" -> vibe = "temperate"
- "cultural", "interesting", "art", "museums", "history", "historic" -> vibe = "cultural"
- "romantic", "couples", "intimate", "charm", "love" -> vibe = "romantic"
- "vibrant", "lively", "nightlife", "energy", "party" -> vibe = "vibrant"
- "artistic", "creative", "bohemian", "trendy", "hip" -> vibe = "artistic"
- "laid-back", "relaxed", "chill", "easy-going", "peaceful" -> vibe = "laid-back"
- "luxury", "upscale", "premium", "exclusive", "fancy" -> vibe = "luxury"
- "modern", "contemporary", "sleek", "cutting-edge", "tech" -> vibe = "modern"
- Extract vibe ONLY if explicitly mentioned; otherwise null
- "dus-intors" / "round trip" / "return flight" -> tripType = "round_trip"
- "doar dus" / "one way" -> tripType = "one_way"
- Output must be a single raw JSON object only.
- Do not wrap the JSON in markdown.
- Do not include explanations or comments.

Baggage interpretation:
- "bagaj de cala" / "checked bag" -> checkedBags
- "bagaj de mana" / "cabin bag" -> cabinBags

Stops / connections:
- "direct" / "fara escala" / "direct flight" -> maxStops = 0
- "1 escala" / "1 stop" / "one stop" -> maxStops = 1
- "2 escale" / "2 stops" -> maxStops = 2
- "max 1 escala" / "maximum 1 stop" -> maxStops = 1
- if user says "no preference", set maxStops = null

Accessibility keywords:
- "wheelchair" / "accessible" / "accessibility" -> needsAccessibleSeating = true
- "disabled" / "disability" -> needsAccessibleSeating = true
- If user mentions mobility needs or wheelchair -> needsAccessibleSeating = true
- Otherwise, needsAccessibleSeating = false (never null)

- currency: "EUR" by default.
JSON schema:
{
  "originCity": string|null,
  "originAirportCode": string|null,
  "destinationCity": string|null,
  "destinationAirportCode": string|null,
  "departureDate": string|null,
  "returnDate": string|null,
  "tripType": "one_way"|"round_trip"|null,
  "maxPrice": number|null,
  "currency": "EUR"|string|null,
  "cabinClass": "economy"|"premium_economy"|"business"|"first"|null,
  "cabinBags": number|null,
  "checkedBags": number|null,
  "adults": number,
  "children": number,
  "passengers": number,
  "maxStops": number|null,
  "needsAccessibleSeating": boolean|null,
  "vibe": "sunny"|"snowy"|"temperate"|"cultural"|"romantic"|"vibrant"|"artistic"|"laid-back"|"luxury"|"modern"|null
}

Accessibility keywords:
- "wheelchair" / "accessible" / "accessibility" -> needsAccessibleSeating = true
- "disabled" / "disability" -> needsAccessibleSeating = true
- If user mentions mobility needs or wheelchair -> needsAccessibleSeating = true
- Otherwise, needsAccessibleSeating = false (never null)

User message: """${userMessage}"""
`;
}

function buildFollowupPrompt(userMessage, context, missingFields) {
  const today = getIsoDateWithOffset(0);
  const tomorrow = getIsoDateWithOffset(1);

  return `
You are filling missing flight search fields in an ongoing conversation.

Known extracted data:
${JSON.stringify(context)}

Fields we are explicitly asking now:
${JSON.stringify(missingFields)}

New user reply:
"""${userMessage}"""

Today's date is ${today}.

CRITICAL:
- Output MUST be a valid JSON object
- Do NOT include any text before or after JSON
- Do NOT include trailing commas
- Do NOT include comments
- The response must be directly parsable with JSON.parse()
- Return ALL fields from the schema
- Keep already known fields unchanged unless the user explicitly changes them
- Prioritize filling the explicitly asked fields
- Also extract any other schema fields if user provides them in this same reply
- If the reply does not provide a field, keep it null
- Any date must be ISO format YYYY-MM-DD
- Convert relative dates to actual ISO dates
- Convert exact relative dates like "today", "tomorrow", "maine", "poimaine", "next Friday" into actual ISO dates
- If the reply gives a broad time window like "next week", "next month", or "this weekend", do NOT invent a specific day. Keep departureDate/returnDate as null so the app can ask for an exact date.
- Never return the literal word "tomorrow"

City ordering rules:
- If asking for ["originCity","destinationCity"] and user provides 2+ cities:
  - FIRST city mentioned = originCity
  - SECOND city mentioned = destinationCity
  - Example: "Bucharest, Rome" -> originCity = "Bucuresti", destinationCity = "Roma"
- If asking only for ["originCity"] or ["destinationCity"], map the reply to that field

Examples:
- asked ["originCity"], reply "Bucharest" -> originCity = "Bucuresti"
- asked ["originAirportCode"], reply "Otopeni" -> originCity = "Bucuresti", originAirportCode = "OTP"
- asked ["destinationAirportCode"], reply "Aurel Vlaicu" -> destinationCity = "Bucuresti", destinationAirportCode = "BBU"
- asked ["originCity","destinationCity"], reply "Bucharest, Rome" -> originCity = "Bucuresti", destinationCity = "Roma"
- asked ["departureDate"], reply "maine" -> departureDate = "${tomorrow}"
- asked ["departureDate"], reply "next week" -> departureDate = null
- asked ["originCity","destinationCity"], reply "Bucharest, Rome, tomorrow, in 3 days" -> fill all 4 fields

JSON schema:
{
  "originCity": string|null,
  "originAirportCode": string|null,
  "destinationCity": string|null,
  "destinationAirportCode": string|null,
  "departureDate": string|null,
  "returnDate": string|null,
  "tripType": "one_way"|"round_trip"|null,
  "maxPrice": number|null,
  "currency": "EUR"|string|null,
  "cabinClass": "economy"|"premium_economy"|"business"|"first"|null,
  "cabinBags": number|null,
  "checkedBags": number|null,
  "adults": number,
  "children": number,
  "passengers": number,
  "maxStops": number|null,
  "needsAccessibleSeating": boolean|null,
  "vibe": "sunny"|"snowy"|"temperate"|"cultural"|"romantic"|"vibrant"|"artistic"|"laid-back"|"luxury"|"modern"|null
}

For accessibility:
- If user mentions wheelchair, accessible, or disability -> needsAccessibleSeating = true
- Otherwise needsAccessibleSeating = false (never null)

For vibe:
- "sunny", "warm", "hot", "beach", "coastal" -> vibe = "sunny"
- "snowy", "cold", "mountains", "winter", "alpine" -> vibe = "snowy"
- "temperate", "mild" -> vibe = "temperate"
- "cultural", "interesting", "art", "museums", "history", "historic" -> vibe = "cultural"
- "romantic", "couples", "intimate", "charm", "love" -> vibe = "romantic"
- "vibrant", "lively", "nightlife", "energy", "party" -> vibe = "vibrant"
- "artistic", "creative", "bohemian", "trendy", "hip" -> vibe = "artistic"
- "laid-back", "relaxed", "chill", "easy-going", "peaceful" -> vibe = "laid-back"
- "luxury", "upscale", "premium", "exclusive", "fancy" -> vibe = "luxury"
- "modern", "contemporary", "sleek", "cutting-edge", "tech" -> vibe = "modern"
- Extract vibe ONLY if explicitly mentioned; otherwise keep existing vibe or null
`;
}

function stripDiacritics(value) {
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

const CITY_CLIMATE = {
  "Roma": ["sunny", "cultural", "historic"],
  "Barcelona": ["sunny", "vibrant", "cultural"],
  "Lisabona": ["sunny", "coastal", "laid-back"],
  "Madrid": ["sunny", "vibrant", "cultural"],
  "Atena": ["sunny", "cultural", "historic"],
  "Istanbul": ["warm", "cultural", "historic"],
  "Dubai": ["sunny", "luxury", "modern"],
  "Paris": ["temperate", "romantic", "cultural"],
  "Amsterdam": ["temperate", "artistic", "laid-back"],
  "Berlin": ["temperate", "artistic", "lively"],
  "Londra": ["temperate", "vibrant", "historic"],
  "Dublin": ["temperate", "lively", "cultural"],
  "Zurich": ["snowy", "luxury", "alpine"],
  "Viena": ["temperate", "romantic", "cultural"],
  "Praga": ["temperate", "historic", "romantic"],
  "Milano": ["temperate", "luxury", "cultural"],
  "Bruxelles": ["temperate", "cultural", "historic"],
  "Copenhaga": ["temperate", "modern", "laid-back"],
};

const CITY_ALIASES = {
  bucharest: "Bucuresti",
  bucuresti: "Bucuresti",
  bucharesti: "Bucuresti",
  timisoara: "Timisoara",
  cluj: "Cluj",
  iasi: "Iasi",
  sibiu: "Sibiu",
  london: "Londra",
  londra: "Londra",
  paris: "Paris",
  rome: "Roma",
  roma: "Roma",
  barcelona: "Barcelona",
  madrid: "Madrid",
  amsterdam: "Amsterdam",
  berlin: "Berlin",
  istanbul: "Istanbul",
  vienna: "Viena",
  viena: "Viena",
  milan: "Milano",
  milano: "Milano",
  lisbon: "Lisabona",
  lisabona: "Lisabona",
  prague: "Praga",
  praga: "Praga",
  athens: "Atena",
  atena: "Atena",
  copenhagen: "Copenhaga",
  copenhaga: "Copenhaga",
  brussels: "Bruxelles",
  bruxelles: "Bruxelles",
  dublin: "Dublin",
  zurich: "Zurich",
  dubai: "Dubai",
};

function getAirportOptionsForCity(city) {
  return CITY_AIRPORT_OPTIONS[city] || [];
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

function formatAirportOption(option) {
  const code = String(option?.code || "").trim().toUpperCase();
  const label = String(option?.label || code).replace(/\s+/g, " ").trim();
  if (!code) return label;
  return label && label !== code ? `${label} (${code})` : code;
}

function extractAirportCodeFromText(value) {
  const rawValue = String(value || "").trim();
  if (!rawValue) return null;

  const bracketedMatch = rawValue.match(/\(([A-Za-z]{3})\)/);
  if (bracketedMatch) {
    return bracketedMatch[1].toUpperCase();
  }

  const bareCodeMatch = rawValue.match(/^[A-Za-z]{3}$/);
  return bareCodeMatch ? bareCodeMatch[0].toUpperCase() : null;
}

async function resolveAirportClarificationState(searchState) {
  const optionsByField = {};
  const dynamicMissing = [];
  const targets = [
    { field: "originAirportCode", city: searchState?.originCity, side: "origin" },
    { field: "destinationAirportCode", city: searchState?.destinationCity, side: "destination" },
  ];

  for (const target of targets) {
    if (!target.city || searchState?.[target.field]) continue;

    let options = [];
    try {
      options = await resolveESkyAirportOptions(target.city, target.side);
    } catch (error) {
      console.log(`[CHAT] Live airport options lookup failed for ${target.city} (${target.side}): ${error.message}`);
    }

    if (options.length === 0) {
      options = getAirportOptionsForCity(target.city);
    }

    options = dedupeAirportOptions(options);
    if (options.length > 0) {
      optionsByField[target.field] = options;
    }

    if (options.length > 1) {
      dynamicMissing.push(target.field);
    }
  }

  return { optionsByField, dynamicMissing };
}

function applySingleAirportDefaults(searchState, airportOptionsByField) {
  const next = { ...searchState };

  if (!next.originAirportCode && (airportOptionsByField.originAirportCode || []).length === 1) {
    next.originAirportCode = airportOptionsByField.originAirportCode[0].code;
  }

  if (!next.destinationAirportCode && (airportOptionsByField.destinationAirportCode || []).length === 1) {
    next.destinationAirportCode = airportOptionsByField.destinationAirportCode[0].code;
  }

  return next;
}

function resolveAirportAlias(value) {
  if (!value || typeof value !== "string") return null;

  const cleaned = stripDiacritics(value).trim().toLowerCase();
  if (!cleaned) return null;

  if (AIRPORT_ALIASES[cleaned]) {
    return AIRPORT_ALIASES[cleaned];
  }

  for (const [alias, airport] of Object.entries(AIRPORT_ALIASES)) {
    if (cleaned.includes(alias)) {
      return airport;
    }
  }

  return null;
}

function applyAirportAlias(rawValue, cityField, codeField, target) {
  const match = resolveAirportAlias(rawValue);
  if (!match) return;

  target[cityField] = match.city;
  target[codeField] = match.code;
}

function normalizeCityName(city) {
  if (!city || typeof city !== "string") return city ?? null;

  const cleaned = stripDiacritics(city).trim().toLowerCase();
  if (!cleaned) return null;

  return CITY_ALIASES[cleaned] || city.trim().replace(/\s+/g, " ");
}

function normalizeRelativeDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return dateStr ?? null;

  const parsed = parseRelativeDateReference(dateStr);
  if (parsed) {
    return parsed;
  }

  return dateStr.trim();
}

function hasSpecificDateClue(message) {
  const text = stripDiacritics(String(message || "")).toLowerCase();
  if (!text.trim()) return false;

  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) return true;
  if (/\b(today|tomorrow|azi|maine|poimaine|day after tomorrow)\b/.test(text)) return true;
  if (/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|luni|marti|miercuri|joi|vineri|sambata|duminica)\b/.test(text)) return true;
  if (/\b(in\s+)?\d+\s+(day|days|week|weeks|month|months|zi|zile|saptamana|saptamani|luna|luni)\b/.test(text)) return true;
  if (/\b\d{1,2}[\/.-]\d{1,2}(?:[\/.-]\d{2,4})?\b/.test(text)) return true;
  if (/\b\d{1,2}\b.{0,12}\b(january|february|march|april|may|june|july|august|september|october|november|december|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)\b/.test(text)) return true;
  if (/\b(january|february|march|april|may|june|july|august|september|october|november|december|ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie)\b.{0,12}\b\d{1,2}\b/.test(text)) return true;

  return false;
}

function hasAmbiguousDateWindow(message) {
  const text = stripDiacritics(String(message || "")).toLowerCase();
  if (!text.trim()) return false;

  return /\b(next week|this week|week after next|next month|this month|next weekend|this weekend|weekend|next year|this year|summer|winter|spring|autumn|fall|later this month|sometime next week|sometime next month)\b/.test(text);
}

function clearAmbiguousDateGuesses(extracted, userMessage) {
  if (!extracted || typeof extracted !== "object") return extracted;
  if (!extracted.departureDate && !extracted.returnDate) return extracted;
  if (hasSpecificDateClue(userMessage)) return extracted;

  return {
    ...extracted,
    departureDate: null,
    returnDate: null,
  };
}


function mergeExtracted(prev, current){
  return{
    ...prev,
    ...Object.fromEntries(Object.entries(current).filter(([_, v]) => v != null))
  };
}

function normalizeYear(dateStr) {
  // acceptă doar YYYY-MM-DD sau null
  if (!dateStr || typeof dateStr !== "string") return dateStr;

  // dacă nu e format ISO, nu atingem
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return dateStr;

  const year = parseInt(m[1], 10);
  const month = m[2];
  const day = m[3];

  const currentYear = new Date().getFullYear();

  // dacă anul e “în trecut” față de anul curent, îl aducem la anul curent
  // (pentru cereri gen "10 aprilie" fără an)
  if (year < currentYear) {
    return `${currentYear}-${month}-${day}`;
  }

  return dateStr;
}

const REQUIRED_FIELD_PRIORITY = [
  "originCity",
  "destinationCity",
  "departureDate",
  "returnDate",
  "originAirportCode",
  "destinationAirportCode",
];

function checkIfMissingFields(extracted)
{
  const missing = [];

  if(!extracted.originCity)
    missing.push("originCity");
  if(!extracted.destinationCity)
    missing.push("destinationCity");
  if(!extracted.departureDate)
    missing.push("departureDate");

  if(extracted.tripType == "round_trip" && !extracted.returnDate)
    missing.push("returnDate");

  const originAirportOptions = getAirportOptionsForCity(extracted.originCity);
  if (originAirportOptions.length > 1 && !extracted.originAirportCode) {
    missing.push("originAirportCode");
  }

  const destinationAirportOptions = getAirportOptionsForCity(extracted.destinationCity);
  if (destinationAirportOptions.length > 1 && !extracted.destinationAirportCode) {
    missing.push("destinationAirportCode");
  }

  return missing;
}

function selectClarificationBatch(missing, batchSize = 1) {
  const sorted = REQUIRED_FIELD_PRIORITY.filter((field) => missing.includes(field));
  return sorted.slice(0, batchSize);
}

function getCitiesMatchingVibe(vibe) {
  if (!vibe) return null;
  const normalized = String(vibe).toLowerCase().trim();
  const matching = Object.entries(CITY_CLIMATE)
    .filter(([, vibes]) => {
      const vibeArray = Array.isArray(vibes) ? vibes : [vibes];
      return vibeArray.some((v) => normalized.includes(v) || v.includes(normalized));
    })
    .map(([city]) => city);
  return matching.length > 0 ? matching.slice(0, 3) : null;
}

function generateClarificationsInput(missing, context, airportOptionsByField = {}){
  const questions = [];
  let suggestions = [];

  if(missing.includes("originCity")) {
    const dest = context?.destinationCity;
    if (dest) {
      questions.push(`Great choice! Where will you be flying from to ${dest}? (e.g., Bucharest, Cluj, Iasi)`);
    } else {
      questions.push("Where will you be flying from? (e.g., Bucharest, Cluj, Iasi)");
    }
  }

  if(missing.includes("destinationCity")) {
    const vibe = context?.vibe;
    if (vibe) {
      const suggestions = getCitiesMatchingVibe(vibe);
      if (suggestions && suggestions.length > 0) {
        questions.push(`I understand you want a ${vibe} destination. How about: ${suggestions.join(", ")} or somewhere else?`);
      } else {
        questions.push("Where would you like to fly to? (e.g., Amsterdam, Rome, Paris)");
      }
    } else {
      questions.push("Where would you like to fly to? (e.g., Amsterdam, Rome, Paris)");
    }
  }

  if (missing.includes("originAirportCode")) {
    const options = dedupeAirportOptions(
      airportOptionsByField.originAirportCode?.length
        ? airportOptionsByField.originAirportCode
        : getAirportOptionsForCity(context?.originCity)
    );
    if (options.length > 1) {
      const optionLabels = options.map(formatAirportOption);
      questions.push(
        `For ${context.originCity}, which airport should I use: ${options
          .map(formatAirportOption)
          .join(" or ")}?`
      );
      suggestions = optionLabels.slice(0, 8);
    }
  }

  if (missing.includes("destinationAirportCode")) {
    const options = dedupeAirportOptions(
      airportOptionsByField.destinationAirportCode?.length
        ? airportOptionsByField.destinationAirportCode
        : getAirportOptionsForCity(context?.destinationCity)
    );
    if (options.length > 1) {
      const optionLabels = options.map(formatAirportOption);
      questions.push(
        `For ${context.destinationCity}, which airport should I use: ${options
          .map(formatAirportOption)
          .join(" or ")}?`
      );
      suggestions = optionLabels.slice(0, 8);
    }
  }

  if(missing.includes("departureDate")) {
    const isRoundTrip = context?.tripType === "round_trip";
    if (isRoundTrip) {
      questions.push("What are your departure and return dates? (e.g., May 5 to May 12)");
    } else {
      questions.push("What date are you planning to depart? (e.g., tomorrow, May 5, next Friday)");
    }
  }

  if(missing.includes("returnDate"))
    questions.push("And when would you like to return? (e.g., in 3 days, May 8, May 12)");

  return { questions, suggestions };
}

function normalizeExtracted(extracted) {
  if (!extracted || typeof extracted !== "object") return extracted;

  const normalized = {
    ...extracted,
    originCity: normalizeCityName(extracted.originCity),
    destinationCity: normalizeCityName(extracted.destinationCity),
    originAirportCode: extracted.originAirportCode
      ? String(extracted.originAirportCode).trim().toUpperCase()
      : null,
    destinationAirportCode: extracted.destinationAirportCode
      ? String(extracted.destinationAirportCode).trim().toUpperCase()
      : null,
    departureDate: normalizeYear(normalizeRelativeDate(extracted.departureDate)),
    returnDate: normalizeYear(normalizeRelativeDate(extracted.returnDate)),
    currency: extracted.currency ? String(extracted.currency).trim().toUpperCase() : "EUR"
  };

  applyAirportAlias(extracted.originCity, "originCity", "originAirportCode", normalized);
  applyAirportAlias(extracted.destinationCity, "destinationCity", "destinationAirportCode", normalized);
  applyAirportAlias(extracted.originAirportCode, "originCity", "originAirportCode", normalized);
  applyAirportAlias(extracted.destinationAirportCode, "destinationCity", "destinationAirportCode", normalized);

  return normalized;
}

function getMentionedCities(message) {
  const text = stripDiacritics(String(message || "")).toLowerCase();
  if (!text) return [];

  const aliases = Object.keys(CITY_ALIASES).sort((a, b) => b.length - a.length);
  const found = [];

  for (const alias of aliases) {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`, "i");
    if (!regex.test(text)) continue;

    const city = CITY_ALIASES[alias];
    if (city && !found.includes(city)) {
      found.push(city);
    }
  }

  return found;
}

function sanitizeFollowupExtraction(current, activeFields) {
  if (!current || !Array.isArray(activeFields) || activeFields.length !== 1) {
    return current;
  }

  const active = activeFields[0];
  const next = { ...current };

  const allowedByActive = {
    originCity: ["originCity", "originAirportCode"],
    destinationCity: ["destinationCity", "destinationAirportCode"],
    originAirportCode: ["originCity", "originAirportCode"],
    destinationAirportCode: ["destinationCity", "destinationAirportCode"],
    departureDate: ["departureDate", "returnDate"],
    returnDate: ["departureDate", "returnDate"],
  };

  const controlledFields = [
    "originCity",
    "destinationCity",
    "departureDate",
    "returnDate",
    "originAirportCode",
    "destinationAirportCode",
  ];

  const allowed = new Set(allowedByActive[active] || [active]);

  for (const field of controlledFields) {
    if (!allowed.has(field)) {
      next[field] = null;
    }
  }

  return next;
}

function applyExplicitAirportReply(extracted, activeFields, userMessage, context) {
  if (!extracted || !Array.isArray(activeFields) || activeFields.length !== 1) {
    return extracted;
  }

  const active = activeFields[0];
  if (active !== "originAirportCode" && active !== "destinationAirportCode") {
    return extracted;
  }

  const code = extractAirportCodeFromText(userMessage);
  if (!code) {
    return extracted;
  }

  const next = { ...extracted, [active]: code };
  if (active === "originAirportCode" && context?.originCity) {
    next.originCity = context.originCity;
  }
  if (active === "destinationAirportCode" && context?.destinationCity) {
    next.destinationCity = context.destinationCity;
  }

  return next;
}

function applyExplicitDateReply(extracted, activeFields, userMessage) {
  if (!extracted || !Array.isArray(activeFields) || activeFields.length === 0) {
    return extracted;
  }

  const dateFields = activeFields.filter((field) => field === "departureDate" || field === "returnDate");
  if (dateFields.length === 0) {
    return extracted;
  }

  const parsedRange = parseRelativeDateRange(userMessage);
  if (parsedRange) {
    return {
      ...extracted,
      departureDate: parsedRange.departureDate,
      returnDate: parsedRange.returnDate,
    };
  }

  const parsedDate = parseRelativeDateReference(userMessage);
  if (!parsedDate) {
    return extracted;
  }

  const next = { ...extracted };

  if (dateFields.length === 1) {
    next[dateFields[0]] = parsedDate;
    return next;
  }

  if (!next.departureDate) {
    next.departureDate = parsedDate;
  } else if (!next.returnDate) {
    next.returnDate = parsedDate;
  }

  return next;
}

function normalizeCabinClass(value) {
  if (!value) return null;
  const cleaned = stripDiacritics(String(value)).trim().toLowerCase();
  if (!cleaned) return null;
  if (cleaned === "economy" || cleaned.includes("econom")) return "economy";
  if (cleaned === "premium_economy" || cleaned.includes("premium")) return "premium_economy";
  if (cleaned === "business" || cleaned.includes("business")) return "business";
  if (cleaned === "first" || cleaned.includes("first")) return "first";
  return null;
}

function normalizeProfileDefaults(rawProfile) {
  if (!rawProfile || typeof rawProfile !== "object") return null;

  const profile = {
    cabinClass: normalizeCabinClass(rawProfile.cabinClass),
    needsAccessibleSeating:
      typeof rawProfile.needsAccessibleSeating === "boolean"
        ? rawProfile.needsAccessibleSeating
        : null,
  };

  if (!profile.cabinClass && profile.needsAccessibleSeating == null) {
    return null;
  }

  return profile;
}

function applyProfileDefaults(target, profileDefaults) {
  if (!profileDefaults) return target;

  const next = { ...target };
  if (!next.cabinClass && profileDefaults.cabinClass) {
    next.cabinClass = profileDefaults.cabinClass;
  }
  if (next.needsAccessibleSeating == null && profileDefaults.needsAccessibleSeating != null) {
    next.needsAccessibleSeating = profileDefaults.needsAccessibleSeating;
  }
  return next;
}

function tryParseJson(rawText) {
  if (!rawText || typeof rawText !== "string") return null;

  let cleaned = rawText.trim();

  cleaned = cleaned.replace(/```json/g, "").replace(/```/g, "").trim();

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.slice(firstBrace, lastBrace + 1);
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

function parseConfirmationIntent(message) {
  const text = stripDiacritics(String(message || "")).toLowerCase().trim();
  if (!text) return null;

  const positive = [
    "da",
    "yes",
    "ok",
    "okay",
    "merge",
    "foloseste",
    "use",
    "continue",
    "continua",
    "accept",
    "accepta",
  ];
  const negative = [
    "nu",
    "no",
    "change",
    "schimba",
    "modifica",
    "alta",
    "alt",
    "refuz",
    "cancel",
  ];

  if (positive.some((token) => text.includes(token))) return true;
  if (negative.some((token) => text.includes(token))) return false;
  return null;
}

function toSearchSummary(search) {
  return {
    originAirportCode: search?.originAirportCode || null,
    destinationAirportCode: search?.destinationAirportCode || null,
    departureDate: search?.departureDate || null,
    returnDate: search?.returnDate || null,
    passengers: search?.passengers || 1,
    cabinClass: search?.cabinClass || "economy",
    tripType: search?.tripType || "one_way",
  };
}

function buildNormalizationPayload(requestedSearch, normalizedSearch, normalizationDiffs, extras = {}) {
  const requested = toSearchSummary(requestedSearch || {});
  const normalized = toSearchSummary(normalizedSearch || requestedSearch || {});
  const diffs = Array.isArray(normalizationDiffs) ? normalizationDiffs : [];

  return {
    policy: "strict_disclosure",
    requiresUserConfirmation: Boolean(extras.requiresUserConfirmation),
    userConfirmed: Boolean(extras.userConfirmed),
    requested,
    normalized,
    diffs,
    datePolicy: {
      requestedDepartureDate: requested.departureDate,
      requestedReturnDate: requested.returnDate,
      supplierDepartureDate: normalized.departureDate,
      supplierReturnDate: normalized.returnDate,
      supplierAdjustedDates: diffs.some((diff) => diff.field === "departureDate" || diff.field === "returnDate"),
    },
    summary: diffs.length
      ? `Supplier adjusted ${diffs.map((diff) => diff.field).join(", ")}. Review requested vs supplier values before booking.`
      : "Supplier returned the same parameters as requested.",
  };
}

function buildNormalizationQuestions(payload) {
  const requested = toSearchSummary(payload?.requestedSearch || {});
  const normalized = toSearchSummary(payload?.normalizedSearch || {});
  const changedFields = (payload?.normalizationDiffs || []).map((diff) => diff.field).join(", ");

  return [
    `eSky adjusted your search (${changedFields || "some fields"}) to find available offers.`,
    `Requested: ${requested.originAirportCode} -> ${requested.destinationAirportCode}, ${requested.departureDate} -> ${requested.returnDate}, ${requested.passengers} passenger(s).`,
    `eSky used: ${normalized.originAirportCode} -> ${normalized.destinationAirportCode}, ${normalized.departureDate} -> ${normalized.returnDate}, ${normalized.passengers} passenger(s).`,
    "Do you want to continue with eSky-adjusted offers?",
  ];
}

app.get("/payments/config", (_req, res) => {
  return res.json({
    providerConfig: buildPaymentProviderConfig(),
  });
});

app.post("/payments/session", async (req, res) => {
  const requestId = createRequestId();
  const result = await createPaymentSession(req.body);

  if (!result.ok) {
    return res.status(result.status || 400).json({
      requestId,
      error: result.error,
      details: result.details || [],
    });
  }

  return res.json({
    requestId,
    paymentSession: result.paymentSession,
    providerConfig: result.providerConfig,
  });
});

app.post("/payments/confirm", async (req, res) => {
  const requestId = createRequestId();
  const result = await confirmPaymentSession(req.body);

  if (!result.ok) {
    return res.status(result.status || 400).json({
      requestId,
      error: result.error,
      details: result.details || [],
    });
  }

  return res.json({
    requestId,
    paymentSession: result.paymentSession,
    booking: result.booking,
    paymentEvent: result.paymentEvent,
    providerConfig: result.providerConfig,
  });
});

app.post("/payments/webhook", (req, res) => {
  const requestId = createRequestId();
  const result = handlePaymentWebhook({
    body: req.body,
    signature: req.headers["stripe-signature"] || null,
  });

  return res.json({
    requestId,
    ...result,
  });
});

app.post("/chat", async (req, res) => {
  const requestId = createRequestId();
  const sessionId = normalizeSessionId(req.body?.sessionId) || createChatSessionId();
  let { sessionState, pendingFields, pendingNormalization } = getChatSession(sessionId);
  const userMessage = req.body?.message;
  const profileDefaults = normalizeProfileDefaults(req.body?.profile);
  const startedAt = Date.now();

  logChatEvent(requestId, "request_received", {
    hasMessage: Boolean(userMessage && typeof userMessage === "string"),
    hasProfileDefaults: Boolean(profileDefaults),
    sessionId,
  });

  if (!userMessage || typeof userMessage !== "string") {
    logChatEvent(requestId, "request_invalid", { reason: "missing_message" });
    return res.status(400).json({ error: "Missing 'message' string in body.", requestId, sessionId });
  }

  try {
    if (pendingNormalization) {
      const intent = parseConfirmationIntent(userMessage);
      if (intent === true) {
        const accepted = pendingNormalization;
        pendingNormalization = null;
        sessionState = {};
        pendingFields = [];
        clearChatSession(sessionId);

        const normalization = buildNormalizationPayload(
          accepted.requestedSearch,
          accepted.normalizedSearch,
          accepted.normalizationDiffs,
          { requiresUserConfirmation: true, userConfirmed: true }
        );

        return res.json({
          requestId,
          sessionId,
          extracted: accepted.normalizedSearch,
          mode: "real_only",
          offers: accepted.offers,
          warning: "Results are based on eSky-adjusted availability.",
          normalization,
          comparison: buildOfferComparison(accepted.offers),
        });
      }

      if (intent === false) {
        pendingNormalization = null;
        saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });
        return res.json({
          requestId,
          sessionId,
          mode: "clarification",
          questions: [
            "Understood. Please provide updated dates/airports and I will search again.",
          ],
          suggestions: [
            "Use original dates with another destination airport",
            "Try nearby dates",
          ],
          extracted: sessionState,
        });
      }

      saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });
      return res.json({
        requestId,
        sessionId,
        mode: "clarification",
        questions: buildNormalizationQuestions(pendingNormalization),
        suggestions: [
          "Yes, continue with adjusted offers",
          "No, I want to change search",
        ],
        extracted: sessionState,
      });
    }

    console.log("Session state before request:", sessionState);
    const isFollowup = pendingFields.length > 0;

 

  console.log("Pending fields before request:", pendingFields);
  console.log("IS FOLLOWUP:", isFollowup);

  if (profileDefaults) {
    sessionState = applyProfileDefaults(sessionState, profileDefaults);
  }

  const missingBeforeExtraction = checkIfMissingFields(sessionState);

  const prompt = isFollowup
    ? buildFollowupPrompt(userMessage, sessionState, pendingFields)
    : buildExtractionPrompt(userMessage, sessionState, missingBeforeExtraction);

    console.log("\nPrompt sent to LLM:\n", prompt);

    const ollamaResp = await axios.post(OLLAMA_URL, {
      model: MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.2,
        num_ctx: 2048
      }
    });

   const raw =
  ollamaResp.data && ollamaResp.data.response
    ? ollamaResp.data.response.trim()
    : "";

    console.log("\nRaw LLM response:\n", raw);
    let extracted = tryParseJson(raw);
    console.log("Parsed extracted:", extracted);

if (!extracted) {
  logChatEvent(requestId, "llm_invalid_json", {
    elapsedMs: Date.now() - startedAt,
  });
  return res.status(422).json({
    error: "Model did not return valid JSON",
    raw,
    requestId,
    sessionId,
  });
}

extracted = normalizeExtracted(extracted);
extracted = clearAmbiguousDateGuesses(extracted, userMessage);
extracted = applyExplicitDateReply(
  extracted,
  isFollowup ? pendingFields : missingBeforeExtraction,
  userMessage
);
extracted = applyExplicitAirportReply(extracted, pendingFields, userMessage, sessionState);
extracted = sanitizeFollowupExtraction(extracted, pendingFields);
console.log("Normalized extracted:",extracted);

if (isFollowup && pendingFields.length === 1 && (pendingFields[0] === "originCity" || pendingFields[0] === "destinationCity")) {
  const mentionedCities = getMentionedCities(userMessage);
  if (mentionedCities.length > 1) {
    const cityRole = pendingFields[0] === "originCity" ? "departure" : "destination";
    saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });
    return res.json({
      requestId,
      sessionId,
      mode: "clarification",
      questions: [
        `Please provide only one ${cityRole} city so I can continue. You mentioned multiple: ${mentionedCities.join(", ")}.`,
      ],
      suggestions: mentionedCities,
      extracted: sessionState,
    });
  }
}

sessionState = mergeExtracted(sessionState, extracted);
sessionState = normalizeExtracted(sessionState);
sessionState = applyProfileDefaults(sessionState, profileDefaults);

console.log("Session state after merge:", sessionState);
let missing = checkIfMissingFields(sessionState);
let airportOptionsByField = {};

const hasCoreMissing = missing.some((field) =>
  ["originCity", "destinationCity", "departureDate", "returnDate"].includes(field)
);

if (!hasCoreMissing) {
  const airportResolution = await resolveAirportClarificationState(sessionState);
  airportOptionsByField = airportResolution.optionsByField;
  sessionState = applySingleAirportDefaults(sessionState, airportOptionsByField);
  missing = checkIfMissingFields(sessionState);

  for (const field of airportResolution.dynamicMissing) {
    if (!sessionState[field] && !missing.includes(field)) {
      missing.push(field);
    }
  }
}

console.log("Missing fields:",missing);

if (missing.length > 0) {
  const askNow = selectClarificationBatch(missing, 1);
  const { questions, suggestions } = generateClarificationsInput(askNow, sessionState, airportOptionsByField);
  pendingFields = askNow;
  saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });
  console.log("Mode: clarification");
  console.log("Questions:", questions);
  console.log("Pending fields:", pendingFields);
  console.log("Still missing after this batch:", missing.filter((field) => !askNow.includes(field)));

  return res.json({
    requestId,
    sessionId,
    mode: "clarification",
    questions,
    suggestions,
    pendingFields: askNow,
    extracted: sessionState
  });
}
console.log("Going to search with:",sessionState);

let liveOffers = [];
let scraperMeta = null;
let volaMeta = null;
const liveWarnings = [];

if (sessionState.originCity && sessionState.destinationCity && sessionState.departureDate) {
  console.log("\n[INTEGRATION] Attempting live supplier searches...");
  const [eSkyResult, volaResult] = await Promise.allSettled([
    searchESky(sessionState),
    searchVola(sessionState),
  ]);

  let eSkyOffers = [];
  let volaOffers = [];

  if (eSkyResult.status === "fulfilled") {
    scraperMeta = eSkyResult.value;
    eSkyOffers = attachOfferMetadata(
      scraperMeta?.offers || [],
      "eSky",
      scraperMeta?.finalUrl || buildEskyResultsUrl(scraperMeta?.normalizedSearch || sessionState)
    );

    if (eSkyOffers.length > 0) {
      console.log(`[INTEGRATION] ✅ Got ${eSkyOffers.length} live offers from eSky`);
    }
  } else {
    console.error("[INTEGRATION] ❌ eSky scraper error:", eSkyResult.reason?.message || eSkyResult.reason);
    liveWarnings.push("eSky live results are temporarily unavailable.");
  }

  if (volaResult.status === "fulfilled") {
    volaMeta = volaResult.value;
    volaOffers = attachOfferMetadata(
      volaMeta?.offers || [],
      "Vola",
      volaMeta?.finalUrl || buildVolaResultsUrl(volaMeta?.normalizedSearch || sessionState)
    );

    if (volaOffers.length > 0) {
      console.log(`[INTEGRATION] ✅ Got ${volaOffers.length} live offers from Vola`);
    }
  } else {
    console.error("[INTEGRATION] ❌ Vola scraper error:", volaResult.reason?.message || volaResult.reason);
    liveWarnings.push("Vola live results are temporarily unavailable.");
  }

  liveOffers = sortOffersByPrice(dedupeOffers([...eSkyOffers, ...volaOffers]));
}

if (liveOffers.length > 0 && (scraperMeta?.normalizationDiffs || []).length > 0) {
  pendingNormalization = {
    requestedSearch: { ...sessionState },
    normalizedSearch: { ...(scraperMeta.normalizedSearch || sessionState) },
    normalizationDiffs: scraperMeta.normalizationDiffs,
    offers: liveOffers,
  };
  saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });

  const questions = buildNormalizationQuestions(pendingNormalization);
  const normalization = buildNormalizationPayload(
    pendingNormalization.requestedSearch,
    pendingNormalization.normalizedSearch,
    pendingNormalization.normalizationDiffs,
    { requiresUserConfirmation: true, userConfirmed: false }
  );
  console.log("[INTEGRATION] Awaiting user confirmation for normalized supplier search");
  return res.json({
    requestId,
    sessionId,
    mode: "clarification",
    questions,
    suggestions: [
      "Yes, continue with adjusted offers",
      "No, I want to change search",
    ],
    extracted: sessionState,
    normalization,
  });
}

const liveSearchAttempted = Boolean(
  sessionState.originCity && sessionState.destinationCity && sessionState.departureDate
);

if (liveSearchAttempted && liveOffers.length === 0 && liveWarnings.length === 0) {
  clearChatSession(sessionId);
  console.log("[INTEGRATION] No live flights found, returning no_results");
  return res.json({
    requestId,
    sessionId,
    extracted: sessionState,
    mode: "no_results",
    offers: [],
    warning: null,
    noResultsSearch: {
      originCity: sessionState.originCity || null,
      destinationCity: sessionState.destinationCity || null,
      departureDate: sessionState.departureDate || null,
      returnDate: sessionState.returnDate || null,
    },
  });
}

const sampleResult = searchFlights(sessionState);
console.log("[INTEGRATION] Sample:", sampleResult.offers.length, "offers");

const sampleOffers = attachOfferMetadata(sampleResult.offers || [], "Demo", null);
const integrationWarnings = [...liveWarnings];

if (!liveOffers.length) {
  integrationWarnings.push(
    liveWarnings.length > 0
      ? "Showing backup sample offers while live suppliers recover."
      : "Live suppliers did not return matching offers right now. Showing backup sample suggestions."
  );
}

if (!liveOffers.length && sampleResult.mode === "suggestions") {
  integrationWarnings.push("Exact backup matches were not available. Showing broader sample route suggestions.");
}

const searchResult = {
  mode: liveOffers.length > 0 ? "real_only" : sampleResult.mode,
  offers: liveOffers.length > 0
    ? interleaveOffersBySupplier(liveOffers, 8)
    : sortOffersByPrice(sampleOffers).slice(0, 8)
};
console.log("[INTEGRATION] Total:", searchResult.offers.length, "offers");

const response = {
  requestId,
  sessionId,
  extracted: sessionState,
  mode: searchResult.mode,
  offers: searchResult.offers,
  warning: integrationWarnings.length > 0 ? integrationWarnings.join(" ") : null,
  normalization: buildNormalizationPayload(
    sessionState,
    scraperMeta?.normalizedSearch || sessionState,
    scraperMeta?.normalizationDiffs || [],
    {
      requiresUserConfirmation: false,
      userConfirmed: (scraperMeta?.normalizationDiffs || []).length === 0,
    }
  ),
  comparison: buildOfferComparison(searchResult.offers),
};
logChatEvent(requestId, "response_ready", {
  mode: response.mode,
  offersCount: response.offers?.length || 0,
  elapsedMs: Date.now() - startedAt,
});

clearChatSession(sessionId);

console.log("Session state reset\n");
console.log("Pending fields reset\n");

return res.json(response);
    
  } catch (err) {
    console.error(err?.response?.data || err);
    saveChatSession(sessionId, { sessionState, pendingFields, pendingNormalization });
    logChatEvent(requestId, "request_failed", {
      elapsedMs: Date.now() - startedAt,
      message: err?.message || "unknown_error",
    });
    return res.status(500).json({ error: "Server/LLM error", requestId, sessionId });
  }
});

async function buildReadinessResponse() {
  const readiness = await getDemoReadiness({ model: MODEL, ollamaUrl: OLLAMA_URL });

  return {
    ok: readiness.ok,
    demoReady: readiness.ok,
    model: MODEL,
    uptimeSeconds: Math.round(process.uptime()),
    scraper: readiness.scraper,
    ollama: readiness.ollama,
    payments: readiness.payments,
    fallbackOffers: readiness.fallbackOffers,
    warnings: readiness.warnings,
  };
}

app.get("/health", async (_req, res) => {
  const payload = await buildReadinessResponse();
  res.status(payload.ok ? 200 : 503).json(payload);
});

app.get("/demo/readiness", async (_req, res) => {
  const payload = await buildReadinessResponse();
  res.status(payload.ok ? 200 : 503).json(payload);
});

const server = http.createServer(app);

server.listen(3000, () => {
  console.log("API running on http://localhost:3000");
});

module.exports = server;