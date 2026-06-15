const { searchESky, closeBrowser } = require("../services/eSkyScraper");

(async () => {
  try {
    const result = await searchESky({
      originCity: "Bucuresti",
      originAirportCode: "OTP",
      destinationCity: "Roma",
      destinationAirportCode: "FCO",
      departureDate: "2026-04-14",
      returnDate: "2026-04-21",
      tripType: "round_trip",
      cabinClass: "economy",
      passengers: 1,
    });
    const offers = Array.isArray(result) ? result : (result?.offers || []);
    console.log("RESULT_COUNT", offers.length);
    if (result && !Array.isArray(result)) {
      console.log("NORMALIZATION_DIFFS", JSON.stringify(result.normalizationDiffs || [], null, 2));
      console.log("NORMALIZED_SEARCH", JSON.stringify(result.normalizedSearch || null, null, 2));
    }
    console.log(JSON.stringify(offers.slice(0, 2), null, 2));
  } catch (error) {
    console.error("PROBE_ERROR", error);
    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
})();
