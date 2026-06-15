const { searchVola } = require("../services/volaScraper");

(async () => {
  const result = await searchVola({
    originCity: "Bucuresti",
    originAirportCode: "OTP",
    destinationCity: "Milano",
    destinationAirportCode: "MXP",
    departureDate: "2026-05-13",
    returnDate: "2026-06-12",
    tripType: "round_trip",
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
