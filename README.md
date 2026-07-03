# Skylin - LLM-Powered Flight Search App

Skylin is a mobile flight search application that replaces the traditional search form with a **conversational assistant powered by a locally-running LLM**. Users describe what they want in natural language - Romanian or English - and the app extracts structured search parameters, scrapes live offers from real providers, and completes a full booking flow with payment.

> *"Vreau un zbor dus-întors București–Viena, plecare joi, max 200 euro"* → structured search → live offers → checkout.

## Architecture

```
┌──────────────┐   REST HTTP    ┌──────────────────┐ ──► Ollama · Qwen 2.5 7B (local NLP)
│ Mobile Client │ ─────────────► │ Backend Node.js  │ ──► eSky.ro scraper (Playwright)
│ React Native  │                │ Express 5        │ ──► Vola.ro scraper (Puppeteer)
└──────┬───────┘                └──────────────────┘ ──► Local JSON fallback
       │
       └── Firebase SDK (direct) ──► Firebase Auth + Cloud Firestore
```

- **Mobile client** - React Native 0.81 + Expo SDK 54, TypeScript, Expo Router (file-based routing)
- **Backend** - Node.js / Express 5, orchestrates the NLP pipeline, parallel web scrapers (`Promise.allSettled`) and the payment flow
- **NLP engine** - Qwen 2.5 7B running locally through [Ollama](https://ollama.com); extracts 16 flight parameters from free-form messages, with progressive clarification and per-session memory (30 min TTL)
- **Live offers** - real-time scraping of eSky.ro (Playwright) and Vola.ro (Puppeteer), with deduplication, price sorting, supplier interleaving and a local JSON fallback
- **Auth & persistence** - Firebase Authentication + Cloud Firestore, accessed directly from the client (never through the backend)
- **Payments** - Stripe Test Mode integration (real PaymentIntents) with a mock provider fallback, Luhn validation and card brand detection

## Repository Structure

```
├── mobile/            # React Native (Expo) client
│   ├── app/           # Screens (Expo Router): chat, explore, profile, login, checkout
│   └── src/           # API layer, contexts, theme
├── server/            # Node.js backend
│   ├── server.js      # Express app: NLP pipeline, sessions, offer aggregation
│   ├── services/      # eSkyScraper, volaScraper, paymentProvider, searchFlights
│   ├── scripts/       # Scraper validation / demo scripts
│   └── data/          # Sample offers for offline fallback
└── server.js          # Root launcher (require('./server/server'))
```

## Prerequisites

- **Node.js** 18+
- **[Ollama](https://ollama.com)** with the model pulled: `ollama pull qwen2.5:7b` (needs ~8 GB RAM)
- **A Chromium-based browser** installed (Brave, Chrome or Edge) - the eSky scraper drives the system browser
- **Expo Go** on a phone, or an Android/iOS emulator
- A **Firebase project** (Authentication with email/password + Cloud Firestore)

## Getting Started

### 1. Backend

```bash
cd server
npm install
npm run dev        # or: npm start
```

The server listens on **http://localhost:3000**. Ollama must be running (`http://localhost:11434`).

Optional environment variables (via `.env` in `server/`):

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Enables Stripe Test Mode (real PaymentIntents). Without it, the mock provider is used |
| `STRIPE_WEBHOOK_SECRET` | Enables webhook signature verification |
| `PAYMENT_MERCHANT_DISPLAY_NAME` | Merchant name shown at checkout (default: `Skylin`) |
| `ESKY_BROWSER_PATH` / `VOLA_BROWSER_PATH` | Override the auto-detected browser executable |

### 2. Mobile client

```bash
cd mobile
npm install
cp .env.example .env    # fill in your Firebase config
npx expo start
```

The client auto-discovers the backend from the Expo host (`mobile/src/api/baseUrl.ts`) - phone and computer must be on the same network.

## API Endpoints

| Endpoint | Method | Role |
|---|---|---|
| `/chat` | POST | Full pipeline: NLP extraction → clarification → scraping → offers |
| `/health` | GET | Runtime status: model, scrapers, uptime |
| `/payments/session` | POST | Creates a payment session for a selected offer |
| `/payments/confirm` | POST | Validates the card and confirms the payment |
| `/payments/webhook` | POST | Stripe-compatible webhook endpoint |

## Test Cards

Standard Stripe test numbers, resolved to app scenarios:

| Card | Scenario |
|---|---|
| `4242 4242 4242 4242` | Payment succeeded |
| `4000 0000 0000 3220` | Processing |
| `4000 0000 0000 0002` | Declined |
| `4000 0000 0000 9995` | Insufficient funds |
| `4000 0000 0000 0069` | Expired card |

## Key Features

- **Natural language search** (RO/EN) with bilingual relative-date resolution (*"mâine"*, *"next Friday"*)
- **Progressive clarification** - one question per turn, session context preserved
- **Airport disambiguation** - *"București"* asks OTP vs BBU; *"Otopeni"* resolves directly to OTP
- **Transparent normalization** - if a provider adjusts the search (airport/date), the user confirms before seeing results
- **`no_results` handling** - distinguishes "provider has no flights" from "scraper failed" (which falls back to local offers)
- **Profile-driven personalization** - cabin class and accessibility preferences injected into every search
