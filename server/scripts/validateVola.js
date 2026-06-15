const { searchVola } = require("../services/volaScraper");

(async () => {
  const result = await searchVola({
    originCity: "Bucuresti",
    originAirportCode: "OTP",
    destinationCity: "Amsterdam",
    destinationAirportCode: "AMS",
    departureDate: "2026-06-10",
    returnDate: null,
    tripType: "one_way",
    cabinClass: "economy",
    cabinBags: 0,
    checkedBags: 0,
    passengers: 1,
  });

  console.log(JSON.stringify({
    offersCount: result?.offers?.length || 0,
    firstOffer: result?.offers?.[0] || null,
    finalUrl: result?.finalUrl || null,
  }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
