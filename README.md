# Skylin - LLM-Powered Flight Search App

Skylin is a mobile flight search application that replaces the traditional search form with a **conversational assistant powered by a locally-running LLM**. Users describe what they want in natural language - Romanian or English - and the app extracts structured search parameters, scrapes live offers from real providers, and completes a full booking flow with payment.

> *"Vreau un zbor dus-întors București-Viena, plecare joi, max 200 euro"* -> structured search -> live offers -> checkout.

## Repository

- **URL:** https://github.com/CristiBlaga134/FlightApp_LLM
- **Visibility:** Public
- **Contents:** the complete source code of the application. Compiled and binary artifacts are **not** included - `node_modules/`, the generated native projects (`mobile/android/`, `mobile/ios/`), Expo bundles (`mobile/dist/`), logs and secret keys are excluded through [`.gitignore`](.gitignore).

## Architecture

```
┌──────────────┐   REST HTTP    ┌──────────────────┐ --> Ollama · Qwen 2.5 7B (local NLP)
│ Mobile Client │ -------------> │ Backend Node.js  │ --> eSky.ro scraper (Playwright)
│ React Native  │                │ Express 5        │ --> Vola.ro scraper (Puppeteer)
└──────┬───────┘                └──────────────────┘ --> Local JSON fallback
       │
       └── Firebase SDK (direct) --> Firebase Auth + Cloud Firestore
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

- **Node.js** 18 or newer, with npm
- **[Ollama](https://ollama.com)** installed, with the model pulled: `ollama pull qwen2.5:7b` (needs ~8 GB RAM)
- **A Chromium-based browser** installed (Brave, Chrome or Edge) - the eSky scraper drives the system browser
- **Expo Go** on a phone, or an Android/iOS emulator
- A **Firebase project** (Authentication with email/password + Cloud Firestore)

## Build / Compilation

Skylin is a JavaScript / TypeScript application, so it does **not** require a separate ahead-of-time compilation step in order to run:

- the **backend** is plain Node.js and runs directly, with no transpilation;
- the **mobile client** is written in TypeScript and is transpiled on the fly by the Expo / Metro bundler when the app is launched - no manual compile step is needed for development.

"Building" the project therefore means cloning the sources and installing the dependencies of each module:

```bash
# 1. Clone the repository
git clone https://github.com/CristiBlaga134/FlightApp_LLM.git
cd FlightApp_LLM

# 2. Install backend dependencies
cd server
npm install
cd ..

# 3. Install mobile client dependencies
cd mobile
npm install
cd ..
```

Optional:

- **Type-check / lint** the mobile client: `cd mobile && npm run lint`
- **Produce a standalone native binary** (APK / IPA) with [EAS Build](https://docs.expo.dev/build/introduction/): `cd mobile && npx eas build -p android` (requires a free Expo account; not needed to run the app in development through Expo Go).

## Installation & Launch

### 1. Start Ollama (local NLP engine)

Make sure Ollama is running and the model is available:

```bash
ollama pull qwen2.5:7b   # once
ollama serve             # exposes the API on http://localhost:11434
```

### 2. Start the backend

```bash
cd server
cp .env.example .env     # optional: add Stripe / payment settings
npm start                # or: npm run dev  (auto-reload)
```

The server listens on **http://localhost:3000**. Ollama must be reachable at `http://localhost:11434`.

Optional environment variables (via `.env` in `server/`):

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Enables Stripe Test Mode (real PaymentIntents). Without it, the mock provider is used |
| `STRIPE_WEBHOOK_SECRET` | Enables webhook signature verification |
| `PAYMENT_MERCHANT_DISPLAY_NAME` | Merchant name shown at checkout (default: `Skylin`) |
| `ESKY_BROWSER_PATH` / `VOLA_BROWSER_PATH` | Override the auto-detected browser executable |

### 3. Start the mobile client

```bash
cd mobile
cp .env.example .env      # fill in your Firebase config
npx expo start
```

Then open the project in **Expo Go** (scan the QR code) or in an Android / iOS emulator (`npm run android` / `npm run ios`).

The client auto-discovers the backend from the Expo host ([`mobile/src/api/baseUrl.ts`](mobile/src/api/baseUrl.ts)) - the phone and the computer must be on the same network.

## API Endpoints

| Endpoint | Method | Role |
|---|---|---|
| `/chat` | POST | Full pipeline: NLP extraction -> clarification -> scraping -> offers |
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
