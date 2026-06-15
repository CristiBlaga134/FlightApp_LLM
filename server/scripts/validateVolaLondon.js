const { searchVola } = require("../services/volaScraper");

(async () => {
  const result = await searchVola({
    originCity: "Bucuresti",
    originAirportCode: null,
    destinationCity: "Londra",
    destinationAirportCode: "LHR",
    departureDate: "2026-05-13",
    returnDate: null,
    tripType: "one_way",
    cabinClass: "economy",
    cabinBags: 0,
    checkedBags: 0,
    passengers: 1,
  });

  console.log(JSON.stringify({
    offersCount: result?.offers?.length || 0,
    firstThree: (result?.offers || []).slice(0, 3),
    finalUrl: result?.finalUrl || null,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
