const fs = require("fs");
const path = require("path");

const OUTPUT_PATH = path.join(__dirname, "..", "data", "offers_sample.json");
const YEAR = 2026;
const TOTAL_OFFERS = 1200;

const airports = {
  Bucuresti: "OTP",
  Timisoara: "TSR",
  Cluj: "CLJ",
  Iasi: "IAS",
  Sibiu: "SBZ",
  Londra: "LHR",
  Paris: "CDG",
  Roma: "FCO",
  Barcelona: "BCN",
  Madrid: "MAD",
  Amsterdam: "AMS",
  Berlin: "BER",
  Istanbul: "IST",
  Viena: "VIE",
  Milano: "MXP",
  Lisabona: "LIS",
  Praga: "PRG",
  Atena: "ATH",
  Copenhaga: "CPH",
  Bruxelles: "BRU",
  Dublin: "DUB",
  Zurich: "ZRH",
  Dubai: "DXB",
};

const routes = [
  ["Bucuresti", "Londra"],
  ["Bucuresti", "Paris"],
  ["Bucuresti", "Roma"],
  ["Bucuresti", "Barcelona"],
  ["Bucuresti", "Madrid"],
  ["Bucuresti", "Amsterdam"],
  ["Bucuresti", "Berlin"],
  ["Bucuresti", "Istanbul"],
  ["Bucuresti", "Lisabona"],
  ["Bucuresti", "Praga"],
  ["Bucuresti", "Atena"],
  ["Bucuresti", "Copenhaga"],
  ["Bucuresti", "Bruxelles"],
  ["Bucuresti", "Dublin"],
  ["Bucuresti", "Zurich"],
  ["Bucuresti", "Dubai"],
  ["Timisoara", "Londra"],
  ["Timisoara", "Paris"],
  ["Timisoara", "Roma"],
  ["Timisoara", "Barcelona"],
  ["Timisoara", "Istanbul"],
  ["Timisoara", "Amsterdam"],
  ["Timisoara", "Berlin"],
  ["Timisoara", "Viena"],
  ["Timisoara", "Madrid"],
  ["Timisoara", "Praga"],
  ["Cluj", "Londra"],
  ["Cluj", "Paris"],
  ["Cluj", "Madrid"],
  ["Cluj", "Amsterdam"],
  ["Cluj", "Berlin"],
  ["Cluj", "Roma"],
  ["Cluj", "Barcelona"],
  ["Cluj", "Viena"],
  ["Cluj", "Istanbul"],
  ["Cluj", "Praga"],
  ["Cluj", "Atena"],
  ["Cluj", "Dubai"],
  ["Iasi", "Londra"],
  ["Iasi", "Roma"],
  ["Iasi", "Paris"],
  ["Iasi", "Amsterdam"],
  ["Iasi", "Barcelona"],
  ["Iasi", "Viena"],
  ["Sibiu", "Viena"],
  ["Sibiu", "Milano"],
  ["Sibiu", "Berlin"],
  ["Sibiu", "Paris"],
  ["Sibiu", "Amsterdam"],
  ["Sibiu", "Roma"],
];

const airlinesByRoute = {
  default: ["Ryanair", "WizzAir", "Lufthansa", "KLM", "Air France", "Turkish Airlines"],
  Londra: ["British Airways", "WizzAir", "Ryanair", "Lufthansa", "KLM"],
  Paris: ["Air France", "Lufthansa", "WizzAir", "KLM"],
  Roma: ["ITA Airways", "Ryanair", "WizzAir", "Lufthansa"],
  Barcelona: ["Vueling", "WizzAir", "Ryanair", "Lufthansa"],
  Madrid: ["Iberia", "Lufthansa", "Ryanair", "WizzAir"],
  Amsterdam: ["KLM", "Lufthansa", "Air France"],
  Berlin: ["Lufthansa", "Ryanair", "WizzAir"],
  Istanbul: ["Turkish Airlines", "Pegasus", "Lufthansa"],
  Viena: ["Austrian Airlines", "Ryanair", "Lufthansa"],
  Milano: ["Ryanair", "WizzAir", "ITA Airways"],
  Lisabona: ["TAP Air Portugal", "Ryanair", "WizzAir", "Lufthansa"],
  Praga: ["Czech Airlines", "Lufthansa", "Ryanair", "WizzAir"],
  Atena: ["Aegean Airlines", "Ryanair", "WizzAir", "Lufthansa"],
  Copenhaga: ["SAS", "KLM", "Lufthansa", "WizzAir"],
  Bruxelles: ["Brussels Airlines", "Ryanair", "Lufthansa", "KLM"],
  Dublin: ["Aer Lingus", "Ryanair", "Lufthansa"],
  Zurich: ["SWISS", "Lufthansa", "KLM"],
  Dubai: ["Emirates", "Flydubai", "Turkish Airlines", "Lufthansa"],
};

const routeBaseData = {
  "Bucuresti-Londra": { basePrice: 160, baseDuration: 210 },
  "Bucuresti-Paris": { basePrice: 140, baseDuration: 180 },
  "Bucuresti-Roma": { basePrice: 120, baseDuration: 140 },
  "Bucuresti-Barcelona": { basePrice: 180, baseDuration: 210 },
  "Bucuresti-Madrid": { basePrice: 190, baseDuration: 230 },
  "Bucuresti-Amsterdam": { basePrice: 170, baseDuration: 180 },
  "Bucuresti-Berlin": { basePrice: 130, baseDuration: 130 },
  "Bucuresti-Istanbul": { basePrice: 110, baseDuration: 95 },
  "Bucuresti-Lisabona": { basePrice: 210, baseDuration: 255 },
  "Bucuresti-Praga": { basePrice: 125, baseDuration: 105 },
  "Bucuresti-Atena": { basePrice: 115, baseDuration: 100 },
  "Bucuresti-Copenhaga": { basePrice: 185, baseDuration: 160 },
  "Bucuresti-Bruxelles": { basePrice: 155, baseDuration: 165 },
  "Bucuresti-Dublin": { basePrice: 200, baseDuration: 235 },
  "Bucuresti-Zurich": { basePrice: 170, baseDuration: 155 },
  "Bucuresti-Dubai": { basePrice: 320, baseDuration: 300 },

  "Timisoara-Londra": { basePrice: 170, baseDuration: 190 },
  "Timisoara-Paris": { basePrice: 150, baseDuration: 170 },
  "Timisoara-Roma": { basePrice: 130, baseDuration: 120 },
  "Timisoara-Barcelona": { basePrice: 185, baseDuration: 220 },
  "Timisoara-Istanbul": { basePrice: 120, baseDuration: 100 },
  "Timisoara-Amsterdam": { basePrice: 180, baseDuration: 175 },
  "Timisoara-Berlin": { basePrice: 135, baseDuration: 110 },
  "Timisoara-Viena": { basePrice: 105, baseDuration: 80 },
  "Timisoara-Madrid": { basePrice: 190, baseDuration: 220 },
  "Timisoara-Praga": { basePrice: 120, baseDuration: 90 },

  "Cluj-Londra": { basePrice: 165, baseDuration: 185 },
  "Cluj-Paris": { basePrice: 150, baseDuration: 175 },
  "Cluj-Madrid": { basePrice: 195, baseDuration: 240 },
  "Cluj-Amsterdam": { basePrice: 175, baseDuration: 190 },
  "Cluj-Berlin": { basePrice: 135, baseDuration: 125 },
  "Cluj-Roma": { basePrice: 130, baseDuration: 115 },
  "Cluj-Barcelona": { basePrice: 180, baseDuration: 210 },
  "Cluj-Viena": { basePrice: 110, baseDuration: 85 },
  "Cluj-Istanbul": { basePrice: 125, baseDuration: 95 },
  "Cluj-Praga": { basePrice: 120, baseDuration: 100 },
  "Cluj-Atena": { basePrice: 135, baseDuration: 120 },
  "Cluj-Dubai": { basePrice: 330, baseDuration: 310 },

  "Iasi-Londra": { basePrice: 175, baseDuration: 210 },
  "Iasi-Roma": { basePrice: 135, baseDuration: 130 },
  "Iasi-Paris": { basePrice: 155, baseDuration: 185 },
  "Iasi-Amsterdam": { basePrice: 185, baseDuration: 195 },
  "Iasi-Barcelona": { basePrice: 195, baseDuration: 230 },
  "Iasi-Viena": { basePrice: 110, baseDuration: 90 },

  "Sibiu-Viena": { basePrice: 95, baseDuration: 85 },
  "Sibiu-Milano": { basePrice: 110, baseDuration: 110 },
  "Sibiu-Berlin": { basePrice: 120, baseDuration: 95 },
  "Sibiu-Paris": { basePrice: 150, baseDuration: 170 },
  "Sibiu-Amsterdam": { basePrice: 175, baseDuration: 185 },
  "Sibiu-Roma": { basePrice: 125, baseDuration: 110 },
};

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick(arr) {
  return arr[randInt(0, arr.length - 1)];
}

function maybe(probability) {
  return Math.random() < probability;
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function randomDateIn2026() {
  const month = randInt(1, 12);
  const maxDay =
    month === 2 ? 28 : [4, 6, 9, 11].includes(month) ? 30 : 31;
  const day = randInt(1, maxDay);
  return `${YEAR}-${pad(month)}-${pad(day)}`;
}

function addDays(dateStr, daysToAdd) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + daysToAdd);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function randomDepartureTime() {
  const hour = randInt(5, 21);
  const minute = pick([0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55]);
  return `${pad(hour)}:${pad(minute)}`;
}

function combineDateTime(dateStr, timeStr) {
  return `${dateStr}T${timeStr}`;
}

function addMinutesToDateTime(dateStr, timeStr, minutesToAdd) {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  dt.setMinutes(dt.getMinutes() + minutesToAdd);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}

function routeKey(origin, destination) {
  return `${origin}-${destination}`;
}

function chooseTripType() {
  return maybe(0.7) ? "round_trip" : "one_way";
}

function chooseCabinClass() {
  const roll = Math.random();
  if (roll < 0.72) return "economy";
  if (roll < 0.88) return "premium_economy";
  if (roll < 0.98) return "business";
  return "first";
}

function chooseStops() {
  const roll = Math.random();
  if (roll < 0.58) return 0;
  if (roll < 0.9) return 1;
  return 2;
}

function choosePassengers() {
  const roll = Math.random();
  if (roll < 0.72) return 1;
  if (roll < 0.93) return 2;
  return randInt(3, 4);
}

function baggageForClass(cabinClass, airline) {
  if (cabinClass === "first") {
    return { cabinBags: 2, checkedBags: 2 };
  }
  if (cabinClass === "business") {
    return { cabinBags: 2, checkedBags: 2 };
  }
  if (cabinClass === "premium_economy") {
    return { cabinBags: 1, checkedBags: 1 };
  }

  // economy
  const lowCost = ["Ryanair", "WizzAir", "Pegasus", "Vueling"].includes(airline);
  return {
    cabinBags: 1,
    checkedBags: lowCost ? pick([0, 1]) : pick([1, 1, 1, 0]),
  };
}

function computeDuration(baseDuration, stops) {
  return baseDuration + stops * randInt(60, 120) + randInt(-15, 20);
}

function computePrice(basePrice, cabinClass, stops, checkedBags, airline, tripType) {
  let price = basePrice;

  if (tripType === "round_trip") {
    price += randInt(50, 130);
  }

  if (stops === 0) price += randInt(20, 60);
  if (stops === 1) price += randInt(0, 25);
  if (stops === 2) price -= randInt(0, 15);

  if (checkedBags >= 1) {
    price += checkedBags * randInt(20, 45);
  }

  if (cabinClass === "premium_economy") price += randInt(50, 110);
  if (cabinClass === "business") price += randInt(180, 350);
  if (cabinClass === "first") price += randInt(400, 700);

  if (["British Airways", "KLM", "Air France", "Lufthansa", "Turkish Airlines", "Austrian Airlines", "Iberia", "SWISS", "SAS", "Brussels Airlines", "Aegean Airlines", "Emirates", "TAP Air Portugal"].includes(airline)) {
    price += randInt(10, 45);
  }

  price += randInt(-20, 25);

  return Math.max(55, price);
}

function generateOffer(index) {
  const [originCity, destinationCity] = pick(routes);
  const key = routeKey(originCity, destinationCity);
  const routeData = routeBaseData[key] || { basePrice: 150, baseDuration: 180 };
  const tripType = chooseTripType();
  const cabinClass = chooseCabinClass();
  const stops = chooseStops();
  const passengers = choosePassengers();

  const airlines = airlinesByRoute[destinationCity] || airlinesByRoute.default;
  const airline = pick(airlines);

  const { cabinBags, checkedBags } = baggageForClass(cabinClass, airline);

  const departureDate = randomDateIn2026();
  let returnDate = null;

  if (tripType === "round_trip") {
    returnDate = addDays(departureDate, randInt(2, 14));
  }

  const durationMinutes = computeDuration(routeData.baseDuration, stops);
  const departureTime = randomDepartureTime();
  const departureTimeLocal = combineDateTime(departureDate, departureTime);
  const arrivalTimeLocal = addMinutesToDateTime(departureDate, departureTime, durationMinutes);

  const price = computePrice(
    routeData.basePrice,
    cabinClass,
    stops,
    checkedBags,
    airline,
    tripType
  );

  const maxSeats = randInt(80, 180);
  const availableSeats = randInt(Math.ceil(maxSeats * 0.3), maxSeats);
  const hasAccessibleSeating = maybe(0.65);

  return {
    id: `OFF${String(index + 1).padStart(4, "0")}`,
    originCity,
    originAirportCode: airports[originCity],
    destinationCity,
    destinationAirportCode: airports[destinationCity],
    tripType,
    departureDate,
    returnDate,
    airline,
    cabinClass,
    price,
    currency: "EUR",
    cabinBags,
    checkedBags,
    passengers,
    stops,
    durationMinutes,
    departureTimeLocal,
    arrivalTimeLocal,
    maxSeats,
    availableSeats,
    hasAccessibleSeating,
  };
}

function main() {
  const offers = [];

  for (let i = 0; i < TOTAL_OFFERS; i++) {
    offers.push(generateOffer(i));
  }

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(offers, null, 2), "utf-8");

  console.log(`Generated ${offers.length} offers at: ${OUTPUT_PATH}`);
}

main();