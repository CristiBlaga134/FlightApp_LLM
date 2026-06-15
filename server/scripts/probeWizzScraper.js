const { searchWizzAir, closeBrowser } = require("../services/wizzAirScraper");

(async () => {
  try {
    const results = await searchWizzAir({
      originCity: "Cluj",
      destinationCity: "Berlin",
      departureDate: "2026-04-13",
      originAirportCode: null,
      destinationAirportCode: null,
    });
    console.log("RESULT_COUNT", results ? results.length : 0);
    console.log(JSON.stringify(results ? results.slice(0, 2) : null, null, 2));
  } catch (error) {
    console.error("PROBE_ERROR", error);
    process.exitCode = 1;
  } finally {
    await closeBrowser();
  }
})();
