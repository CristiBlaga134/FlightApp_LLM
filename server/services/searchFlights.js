const fs = require("fs");
const path = require("path");

const offersPath = path.join(__dirname, "..", "data", "offers_sample.json");

function loadOffers() {
  const raw = fs.readFileSync(offersPath, "utf-8");
  return JSON.parse(raw);
}

const CITY_ALIASES = {
  bucharest: "bucuresti",
  bucuresti: "bucuresti",
  london: "londra",
  londra: "londra",
  rome: "roma",
  roma: "roma",
  vienna: "viena",
  viena: "viena",
  milan: "milano",
  milano: "milano",
  lisbon: "lisabona",
  lisabona: "lisabona",
  prague: "praga",
  praga: "praga",
  athens: "atena",
  atena: "atena",
  copenhagen: "copenhaga",
  copenhaga: "copenhaga",
  brussels: "bruxelles",
  bruxelles: "bruxelles",
};

function normalizeText(value) {
  if (!value) return "";

  const normalized = String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  return CITY_ALIASES[normalized] || normalized;
}

function sameCity(a, b) {
  return normalizeText(a) === normalizeText(b);
}

function dateDiffInDays(dateA, dateB) {
  const a = new Date(dateA);
  const b = new Date(dateB);

  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.abs(Math.round((a - b) / msPerDay));
}

function matchesDateStrict(offerDate, queryDate) {
  if (!queryDate) return true;
  return offerDate === queryDate;
}

function matchesDateRelaxed(offerDate, queryDate, maxDaysDiff = 3) {
  if (!queryDate) return true;
  if (!offerDate) return false;

  return dateDiffInDays(offerDate, queryDate) <= maxDaysDiff;
}

function matchesTripType(offer, query) {
  if (!query.tripType) return true;
  return offer.tripType === query.tripType;
}

function matchesCabinClass(offer, query) {
  if (!query.cabinClass) return true;
  return offer.cabinClass === query.cabinClass;
}

function matchesPrice(offer, query) {
  if (query.maxPrice == null) return true;
  return offer.price <= query.maxPrice;
}

function matchesStops(offer, query) {
  if (query.maxStops == null) return true;
  if (offer.stops == null) return true;
  return offer.stops <= query.maxStops;
}

function matchesBaggage(offer, query) {
  if (query.cabinBags != null && offer.cabinBags < query.cabinBags) return false;
  if (query.checkedBags != null && offer.checkedBags < query.checkedBags) return false;
  return true;
}

function matchesPassengers(_offer, _query) {
  // momentan ofertele sunt considerate disponibile
  return true;
}

function matchesAccessibility(offer, query) {
  if (!query.needsAccessibleSeating) return true;
  return offer.hasAccessibleSeating === true;
}

function hasAvailableSeats(offer, query) {
  if (!query.passengers) return true;
  return offer.availableSeats >= query.passengers;
}

function matchesOrigin(offer, query) {
  if (query.originAirportCode) {
    return normalizeText(offer.originAirportCode) === normalizeText(query.originAirportCode);
  }
  if (query.originCity) {
    return sameCity(offer.originCity, query.originCity);
  }
  return true;
}

function matchesDestination(offer, query) {
  if (query.destinationAirportCode) {
    return normalizeText(offer.destinationAirportCode) === normalizeText(query.destinationAirportCode);
  }
  if (query.destinationCity) {
    return sameCity(offer.destinationCity, query.destinationCity);
  }
  return true;
}

function matchesReturnDateStrict(offer, query) {
  if (query.tripType === "round_trip" && query.returnDate) {
    return offer.returnDate === query.returnDate;
  }
  return true;
}

function matchesReturnDateRelaxed(offer, query, maxDaysDiff = 3) {
  if (query.tripType === "round_trip" && query.returnDate) {
    if (!offer.returnDate) return false;
    return dateDiffInDays(offer.returnDate, query.returnDate) <= maxDaysDiff;
  }
  return true;
}

function scoreOffer(offer, query) {
  let score = 0;

  if (query.maxPrice != null) {
    score += Math.max(0, 300 - offer.price);
  } else {
    score += Math.max(0, 300 - offer.price);
  }

  score += Math.max(0, 500 - offer.durationMinutes) * 0.2;
  score += Math.max(0, 3 - offer.stops) * 25;

  if (query.cabinClass && offer.cabinClass === query.cabinClass) score += 30;
  if (query.tripType && offer.tripType === query.tripType) score += 30;
  if (query.checkedBags != null && offer.checkedBags >= query.checkedBags) score += 15;
  if (query.cabinBags != null && offer.cabinBags >= query.cabinBags) score += 10;

  return score;
}

function searchFlights(query) {
  const offers = loadOffers();

  // 1. strict
  const strictMatches = offers.filter((offer) => {
    return (
      matchesOrigin(offer, query) &&
      matchesDestination(offer, query) &&
      matchesDateStrict(offer.departureDate, query.departureDate) &&
      matchesReturnDateStrict(offer, query) &&  
      matchesTripType(offer, query) &&
      matchesCabinClass(offer, query) &&
      matchesPrice(offer, query) &&
      matchesStops(offer, query) &&
      matchesBaggage(offer, query) &&
      matchesPassengers(offer, query) &&
      hasAvailableSeats(offer, query) &&
      matchesAccessibility(offer, query)
    );
  });

  if (strictMatches.length > 0) {
    const ranked = strictMatches
      .map((offer) => ({
        ...offer,
        score: scoreOffer(offer, query),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      mode: "strict",
      offers: ranked,
    };
  }

  // 2. relaxed preferences, but keep the requested route and exact dates.
  const relaxedMatches = offers.filter((offer) => {
    return (
      matchesOrigin(offer, query) &&
      matchesDestination(offer, query) &&
      matchesDateStrict(offer.departureDate, query.departureDate) &&
      matchesReturnDateStrict(offer, query) &&
      matchesTripType(offer, query) &&
      matchesPassengers(offer, query) &&
      hasAvailableSeats(offer, query) &&
      matchesAccessibility(offer, query)
    );
  });

  if (relaxedMatches.length > 0) {
    const ranked = relaxedMatches
      .map((offer) => ({
        ...offer,
        score: scoreOffer(offer, query),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);

    return {
      mode: "relaxed",
      offers: ranked,
    };
  }

  // 3. suggestions
  const suggestionMatches = offers.filter((offer) => {
    return (
      matchesOrigin(offer, query) &&
      matchesDestination(offer, query) &&
      hasAvailableSeats(offer, query) &&
      matchesAccessibility(offer, query)
    );
  });

  const ranked = suggestionMatches
    .map((offer) => ({
      ...offer,
      score: scoreOffer(offer, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    mode: "suggestions",
    offers: ranked,
  };
}

function getSampleOffersInventory() {
  const offers = loadOffers();
  const sampleRoutes = [...new Set(
    offers
      .slice(0, 6)
      .map((offer) => `${offer.originCity} -> ${offer.destinationCity}`)
  )];

  return {
    totalOffers: offers.length,
    sampleRoutes,
  };
}

module.exports = { searchFlights, getSampleOffersInventory };