const PAYMENT_SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_PAYMENT_SESSIONS = 200;
const MERCHANT_DISPLAY_NAME = process.env.PAYMENT_MERCHANT_DISPLAY_NAME || "Skylin";
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || null;
const STRIPE_API_VERSION = process.env.STRIPE_API_VERSION || "2025-02-24.acacia";
const ACTIVE_PROVIDER_NAME = STRIPE_SECRET_KEY ? "stripe" : "mock";

let stripe = null;
if (STRIPE_SECRET_KEY) {
  const Stripe = require("stripe");
  stripe = new Stripe(STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
  console.log("[Payment] Stripe test mode active");
} else {
  console.log("[Payment] Mock provider active (no STRIPE_SECRET_KEY)");
}

const paymentSessions = new Map();

const TEST_CARDS = [
  {
    label: "Success",
    number: "4242 4242 4242 4242",
    note: "Authorizes and confirms immediately",
    expectedEvent: "payment_intent.succeeded",
  },
  {
    label: "Processing",
    number: "4000 0000 0000 3220",
    note: "Payment clears, supplier confirmation pending",
    expectedEvent: "payment_intent.processing",
  },
  {
    label: "Declined",
    number: "4000 0000 0000 0002",
    note: "Simulates a bank decline",
    expectedEvent: "payment_intent.payment_failed",
  },
  {
    label: "Funds",
    number: "4000 0000 0000 9995",
    note: "Simulates insufficient funds",
    expectedEvent: "payment_intent.payment_failed",
  },
];

const COUNTRY_CODE_MAP = {
  "romania": "RO", "germany": "DE", "france": "FR",
  "united kingdom": "GB", "uk": "GB", "italy": "IT",
  "spain": "ES", "netherlands": "NL", "austria": "AT",
  "belgium": "BE", "poland": "PL", "hungary": "HU",
  "usa": "US", "united states": "US", "bulgaria": "BG",
  "greece": "GR", "portugal": "PT", "czech republic": "CZ",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeCardDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeMockExpiryYear(value) {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length === 2) return Number(`20${digits}`);
  return Number(digits.slice(0, 4));
}

function passesLuhnCheck(value) {
  const digits = normalizeCardDigits(value);
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

function isExpiredCard(expiryMonth, expiryYear, now = new Date()) {
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  return expiryYear < currentYear || (expiryYear === currentYear && expiryMonth < currentMonth);
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function detectCardBrand(cardNumber) {
  if (/^4/.test(cardNumber)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(cardNumber)) return "mastercard";
  if (/^3[47]/.test(cardNumber)) return "amex";
  return "card";
}

function toCountryCode(value) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 2) return trimmed.toUpperCase();
  return COUNTRY_CODE_MAP[trimmed.toLowerCase()] || undefined;
}

function buildMockBookingReference() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let ref = "FA";
  for (let i = 0; i < 6; i += 1) ref += alphabet[Math.floor(Math.random() * alphabet.length)];
  return ref;
}

function prunePaymentSessions(now = Date.now()) {
  for (const [id, session] of paymentSessions.entries()) {
    if (now - (session.updatedAtMs || 0) > PAYMENT_SESSION_TTL_MS) paymentSessions.delete(id);
  }
  if (paymentSessions.size <= MAX_PAYMENT_SESSIONS) return;
  const overflow = paymentSessions.size - MAX_PAYMENT_SESSIONS;
  [...paymentSessions.entries()]
    .sort((a, b) => (a[1].updatedAtMs || 0) - (b[1].updatedAtMs || 0))
    .slice(0, overflow)
    .forEach(([id]) => paymentSessions.delete(id));
}

function normalizeOfferSnapshot(offer) {
  const price = Number(offer?.price);
  return {
    id: String(offer?.id || "").trim(),
    supplier: String(offer?.supplier || "Supplier").trim(),
    airline: offer?.airline ? String(offer.airline).trim() : null,
    originCity: String(offer?.originCity || "").trim(),
    destinationCity: String(offer?.destinationCity || "").trim(),
    departureDate: String(offer?.departureDate || "").trim(),
    returnDate: offer?.returnDate ? String(offer.returnDate).trim() : null,
    tripType: offer?.tripType === "round_trip" ? "round_trip" : "one_way",
    price,
    currency: String(offer?.currency || "EUR").trim().toUpperCase(),
  };
}

function buildRouteLabel(offer) {
  return `${offer.originCity || "Origin"} -> ${offer.destinationCity || "Destination"}`;
}

function mapSessionStatusToIntentStatus(status) {
  if (status === "failed" || status === "requires_payment_method") return "requires_payment_method";
  if (status === "processing") return "processing";
  return "succeeded";
}

function buildPaymentIntent(record) {
  return {
    id: record.paymentIntentId,
    object: "payment_intent",
    providerReference: record.providerReference || null,
    status: mapSessionStatusToIntentStatus(record.status),
    clientSecret: null,
    nextAction: record.nextAction || null,
    captureMethod: "automatic",
    confirmationMethod: "manual",
    paymentMethodTypes: ["card"],
    metadata: {
      paymentSessionId: record.id,
      supplier: record.offer.supplier,
      route: buildRouteLabel(record.offer),
      bookingReference: record.bookingReference || null,
    },
  };
}

function buildPaymentSessionPayload(record) {
  return {
    id: record.id,
    provider: record.provider,
    providerMode: "test",
    status: record.status,
    amount: record.amount,
    currency: record.currency,
    customerEmail: record.customerEmail || null,
    merchantDisplayName: MERCHANT_DISPLAY_NAME,
    supportedPaymentMethods: ["card"],
    paymentIntent: buildPaymentIntent(record),
    offer: { ...record.offer },
    lastErrorCode: record.lastErrorCode || null,
    lastErrorMessage: record.lastErrorMessage || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function buildBookingPayload(record, traveler, paymentMethod, billingAddress, estimatedConfirmationAt) {
  return {
    paymentId: createId("pay"),
    paymentSessionId: record.id,
    paymentIntentId: record.paymentIntentId,
    bookingReference: record.bookingReference || buildMockBookingReference(),
    status: record.status === "processing" ? "processing" : "succeeded",
    supplier: record.offer.supplier,
    airline: record.offer.airline,
    amount: record.amount,
    currency: record.currency,
    paymentProvider: record.provider,
    traveler: {
      firstName: String(traveler.firstName || "").trim(),
      lastName: String(traveler.lastName || "").trim(),
      email: String(traveler.email || "").trim(),
    },
    paymentMethod: {
      brand: detectCardBrand(normalizeCardDigits(paymentMethod.cardNumber)),
      last4: normalizeCardDigits(paymentMethod.cardNumber).slice(-4),
      cardholderName: String(paymentMethod.cardholderName || "").trim(),
    },
    billingAddress: {
      country: String(billingAddress.country || "").trim(),
      city: String(billingAddress.city || "").trim(),
      line1: String(billingAddress.line1 || "").trim(),
      postalCode: String(billingAddress.postalCode || "").trim(),
    },
    offer: { ...record.offer },
    createdAt: new Date().toISOString(),
    estimatedConfirmationAt,
  };
}

function buildPaymentEvent(record, eventType, booking) {
  return {
    id: createId("evt"),
    type: eventType,
    provider: record.provider,
    livemode: false,
    createdAt: new Date().toISOString(),
    data: {
      object: {
        id: record.paymentIntentId,
        object: "payment_intent",
        amount: record.amount,
        currency: record.currency.toLowerCase(),
        status: mapSessionStatusToIntentStatus(record.status),
        client_secret: null,
        metadata: {
          paymentSessionId: record.id,
          bookingReference: booking?.bookingReference || null,
          supplier: record.offer.supplier,
          route: buildRouteLabel(record.offer),
        },
      },
    },
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateCreateSessionRequest(body) {
  const offer = body?.offer && typeof body.offer === "object" ? normalizeOfferSnapshot(body.offer) : null;
  const customerEmail = String(body?.customerEmail || "").trim() || null;
  const customerName = String(body?.customerName || "").trim() || null;
  const errors = [];
  if (!offer) {
    errors.push("Missing offer payload.");
  } else {
    if (!offer.originCity || !offer.destinationCity || !offer.departureDate) errors.push("Offer route information is incomplete.");
    if (!Number.isFinite(offer.price) || offer.price <= 0) errors.push("Offer price must be a positive number.");
  }
  if (customerEmail && !isValidEmail(customerEmail)) errors.push("Customer email is invalid.");
  return { offer, customerEmail, customerName, errors };
}

function validateConfirmationRequest(body) {
  const paymentSessionId = String(body?.paymentSessionId || "").trim();
  const traveler = body?.traveler && typeof body.traveler === "object" ? body.traveler : null;
  const paymentMethod = body?.paymentMethod && typeof body.paymentMethod === "object" ? body.paymentMethod : null;
  const billingAddress = body?.billingAddress && typeof body.billingAddress === "object" ? body.billingAddress : null;
  const errors = [];
  if (!paymentSessionId) errors.push("Payment session id is required.");
  if (!traveler) {
    errors.push("Missing traveler details.");
  } else {
    if (!String(traveler.firstName || "").trim()) errors.push("Traveler first name is required.");
    if (!String(traveler.lastName || "").trim()) errors.push("Traveler last name is required.");
    if (!isValidEmail(traveler.email)) errors.push("Traveler email is invalid.");
  }
  if (!paymentMethod) {
    errors.push("Missing payment method.");
  } else {
    const cardNumber = normalizeCardDigits(paymentMethod.cardNumber);
    const expiryMonth = Number(String(paymentMethod.expiryMonth || "").replace(/\D/g, ""));
    const expiryYear = normalizeMockExpiryYear(paymentMethod.expiryYear);
    const cvc = String(paymentMethod.cvc || "").replace(/\D/g, "");
    if (cardNumber.length < 13 || cardNumber.length > 19) {
      errors.push("Card number must contain between 13 and 19 digits.");
    } else if (!passesLuhnCheck(cardNumber)) {
      errors.push("Card number checksum is invalid.");
    }
    if (!String(paymentMethod.cardholderName || "").trim()) errors.push("Cardholder name is required.");
    if (!Number.isInteger(expiryMonth) || expiryMonth < 1 || expiryMonth > 12) {
      errors.push("Expiry month is invalid.");
    } else if (!Number.isInteger(expiryYear)) {
      errors.push("Expiry year is invalid.");
    } else if (isExpiredCard(expiryMonth, expiryYear)) {
      errors.push("Card expiry date is in the past.");
    }
    if (cvc.length < 3 || cvc.length > 4) errors.push("CVC must contain 3 or 4 digits.");
  }
  if (!billingAddress) {
    errors.push("Missing billing address.");
  } else {
    if (!String(billingAddress.country || "").trim()) errors.push("Billing country is required.");
    if (!String(billingAddress.city || "").trim()) errors.push("Billing city is required.");
    if (!String(billingAddress.line1 || "").trim()) errors.push("Billing street address is required.");
    if (!String(billingAddress.postalCode || "").trim()) errors.push("Billing postal code is required.");
  }
  return { paymentSessionId, traveler, paymentMethod, billingAddress, errors };
}

// ── Mock path ─────────────────────────────────────────────────────────────────

function resolveMockPaymentOutcome(cardNumber) {
  switch (cardNumber) {
    case "4000000000000002":
      return { sessionStatus: "failed", eventType: "payment_intent.payment_failed", failureCode: "card_declined", failureMessage: "The bank declined the card during authorization." };
    case "4000000000009995":
      return { sessionStatus: "failed", eventType: "payment_intent.payment_failed", failureCode: "insufficient_funds", failureMessage: "The issuing bank reported insufficient funds." };
    case "4000000000000069":
      return { sessionStatus: "failed", eventType: "payment_intent.payment_failed", failureCode: "expired_card", failureMessage: "The card could not be charged because it is expired." };
    case "4000000000003220":
      return { sessionStatus: "processing", eventType: "payment_intent.processing", failureCode: null, failureMessage: null };
    default:
      return { sessionStatus: "succeeded", eventType: "payment_intent.succeeded", failureCode: null, failureMessage: null };
  }
}

// ── Stripe path ───────────────────────────────────────────────────────────────

async function createStripePaymentIntent(offer, customerEmail) {
  const amountInCents = Math.round(offer.price * 100);
  return stripe.paymentIntents.create({
    amount: amountInCents,
    currency: offer.currency.toLowerCase(),
    payment_method_types: ["card"],
    receipt_email: customerEmail || undefined,
    description: `${offer.originCity} → ${offer.destinationCity} · ${offer.departureDate}`,
    metadata: {
      supplier: offer.supplier,
      origin: offer.originCity,
      destination: offer.destinationCity,
      departure_date: offer.departureDate,
      return_date: offer.returnDate || "",
      trip_type: offer.tripType,
    },
  });
}

// Stripe SDK blocks raw card numbers without a special account setting.
// We confirm every PaymentIntent with pm_card_visa (always succeeds in Stripe,
// so the PI appears in Dashboard). The actual test scenario (decline, insufficient
// funds, processing) is resolved from the card number at the application layer.
async function confirmStripePaymentIntent(stripePaymentIntentId) {
  return stripe.paymentIntents.confirm(stripePaymentIntentId, {
    payment_method: "pm_card_visa",
  });
}

function mapStripeIntentToOutcome(intent) {
  if (intent.status === "succeeded") {
    return { sessionStatus: "succeeded", eventType: "payment_intent.succeeded", failureCode: null, failureMessage: null };
  }
  if (intent.status === "processing") {
    return { sessionStatus: "processing", eventType: "payment_intent.processing", failureCode: null, failureMessage: null };
  }
  return { sessionStatus: "failed", eventType: "payment_intent.payment_failed", failureCode: "requires_action", failureMessage: "Payment requires additional authentication (3D Secure). Use a simpler test card." };
}

function mapStripeErrorToOutcome(err) {
  const code = err.code || "card_declined";
  const messages = {
    card_declined: "The bank declined the card during authorization.",
    insufficient_funds: "The issuing bank reported insufficient funds.",
    expired_card: "The card could not be charged because it is expired.",
    incorrect_cvc: "The CVC code is incorrect.",
    incorrect_number: "The card number is incorrect.",
  };
  return {
    sessionStatus: "failed",
    eventType: "payment_intent.payment_failed",
    failureCode: code,
    failureMessage: messages[code] || err.message || "Card authorization failed.",
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

function buildPaymentProviderConfig() {
  return {
    activeProvider: ACTIVE_PROVIDER_NAME,
    integrationShape: "stripe-compatible",
    merchantDisplayName: MERCHANT_DISPLAY_NAME,
    supportedAdapters: [ACTIVE_PROVIDER_NAME],
    routes: {
      createSession: "/payments/session",
      confirm: "/payments/confirm",
      webhook: "/payments/webhook",
    },
    supportsPaymentSheet: false,
    publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || null,
    stripePlaceholders: {
      publishableKeyConfigured: Boolean(process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY),
      secretKeyConfigured: Boolean(STRIPE_SECRET_KEY),
      webhookSecretConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
    },
    testCards: TEST_CARDS,
  };
}

async function createPaymentSession(body) {
  const { offer, customerEmail, customerName, errors } = validateCreateSessionRequest(body);
  if (errors.length > 0) {
    return { ok: false, status: 400, error: "Invalid payment session request.", details: errors };
  }

  prunePaymentSessions();

  const createdAt = new Date().toISOString();
  let stripePaymentIntentId = null;
  let paymentIntentId = createId("pi");

  if (stripe) {
    try {
      const intent = await createStripePaymentIntent(offer, customerEmail);
      stripePaymentIntentId = intent.id;
      paymentIntentId = intent.id;
      console.log(`[Stripe] PaymentIntent created: ${intent.id}`);
    } catch (err) {
      console.error("[Stripe] Failed to create PaymentIntent:", err.message);
      return { ok: false, status: 502, error: "Could not reach Stripe API.", details: [err.message] };
    }
  }

  const session = {
    id: createId("ps"),
    provider: ACTIVE_PROVIDER_NAME,
    status: "requires_payment_method",
    amount: offer.price,
    currency: offer.currency,
    customerEmail,
    customerName,
    offer,
    paymentIntentId,
    stripePaymentIntentId,
    providerReference: null,
    nextAction: null,
    bookingReference: null,
    booking: null,
    lastEvent: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt,
    updatedAt: createdAt,
    updatedAtMs: Date.now(),
  };

  paymentSessions.set(session.id, session);

  return {
    ok: true,
    paymentSession: buildPaymentSessionPayload(session),
    providerConfig: buildPaymentProviderConfig(),
  };
}

async function confirmPaymentSession(body) {
  const { paymentSessionId, traveler, paymentMethod, billingAddress, errors } = validateConfirmationRequest(body);
  if (errors.length > 0) {
    return { ok: false, status: 400, error: "Invalid payment confirmation request.", details: errors };
  }

  prunePaymentSessions();
  const session = paymentSessions.get(paymentSessionId);
  if (!session) {
    return { ok: false, status: 404, error: "Payment session not found or expired.", details: ["Create a new payment session before confirming payment."] };
  }

  if (session.status === "processing" || session.status === "succeeded") {
    return {
      ok: true,
      paymentSession: buildPaymentSessionPayload(session),
      booking: session.booking,
      paymentEvent: session.lastEvent,
      providerConfig: buildPaymentProviderConfig(),
    };
  }

  let outcome;

  if (stripe && session.stripePaymentIntentId) {
    try {
      const intent = await confirmStripePaymentIntent(session.stripePaymentIntentId);
      console.log(`[Stripe] PaymentIntent ${intent.id} → ${intent.status} (app outcome from card number)`);
    } catch (err) {
      console.error("[Stripe] Confirmation error:", err.message);
    }
    // App-layer outcome from card number (decline, processing, funds etc.)
    outcome = resolveMockPaymentOutcome(normalizeCardDigits(paymentMethod.cardNumber));
  } else {
    await wait(900);
    outcome = resolveMockPaymentOutcome(normalizeCardDigits(paymentMethod.cardNumber));
  }

  const estimatedConfirmationAt = outcome.sessionStatus === "processing"
    ? new Date(Date.now() + 5 * 60 * 1000).toISOString()
    : null;

  session.status = outcome.sessionStatus;
  session.lastErrorCode = outcome.failureCode;
  session.lastErrorMessage = outcome.failureMessage;
  session.updatedAt = new Date().toISOString();
  session.updatedAtMs = Date.now();

  if (outcome.sessionStatus !== "failed") {
    session.bookingReference = session.bookingReference || buildMockBookingReference();
    session.booking = buildBookingPayload(session, traveler, paymentMethod, billingAddress, estimatedConfirmationAt);
  } else {
    session.booking = null;
  }

  session.lastEvent = buildPaymentEvent(session, outcome.eventType, session.booking);
  paymentSessions.set(session.id, session);

  return {
    ok: true,
    paymentSession: buildPaymentSessionPayload(session),
    booking: session.booking,
    paymentEvent: session.lastEvent,
    providerConfig: buildPaymentProviderConfig(),
  };
}

function handlePaymentWebhook(payload) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (stripe && webhookSecret && payload?.rawBody && payload?.signature) {
    try {
      const event = stripe.webhooks.constructEvent(payload.rawBody, payload.signature, webhookSecret);
      console.log(`[Stripe] Webhook verified: ${event.type}`);
      return { received: true, provider: "stripe", livemode: false, verifiedEventType: event.type };
    } catch (err) {
      console.error("[Stripe] Webhook signature verification failed:", err.message);
      return { received: false, provider: "stripe", error: "Webhook signature invalid." };
    }
  }
  return {
    received: true,
    provider: ACTIVE_PROVIDER_NAME,
    livemode: false,
    stripeSignaturePresent: Boolean(payload?.signature),
    acknowledgedEventType: payload?.body?.type || null,
    note: "Webhook endpoint active. Configure STRIPE_WEBHOOK_SECRET to enable signature verification.",
  };
}

module.exports = {
  buildPaymentProviderConfig,
  createPaymentSession,
  confirmPaymentSession,
  handlePaymentWebhook,
};
