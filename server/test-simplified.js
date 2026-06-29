const { searchESky, closeBrowser } = require('./services/eSkyScraper');

(async () => {
  try {
    console.log('=== Testing eSky: Bucuresti -> Amsterdam, first class, 1 adult + 1 child ===\n');

    const result = await searchESky({
      originCity: 'Bucuresti',
      originAirportCode: 'OTP',
      destinationCity: 'Amsterdam',
      destinationAirportCode: 'AMS',
      departureDate: '2026-07-15',
      tripType: 'one_way',
      adults: 1,
      children: 1,
      passengers: 2,
      cabinClass: 'business',
      maxPrice: 300,
    });

    console.log('\n=== Test Complete ===');
    console.log('RESULT_COUNT:', result?.offers?.length || 0);
    if (result?.offers && result.offers.length > 0) {
      console.log('\nAll offers:');
      result.offers.forEach((o, i) => {
        console.log(`  [${i+1}] ${o.price} ${o.currency} | ${o.airline || 'n/a'} | ${o.stops} stop(s) | ${o.durationMinutes}min | cabin: ${o.cabinClass}`);
      });
      console.log('\nFirst offer (full):');
      console.log(JSON.stringify(result.offers[0], null, 2));
    } else {
      console.log('No offers returned.');
    }
    if (result?.finalUrl) {
      console.log('\nFinal URL:', result.finalUrl);
    }
  } catch (e) {
    console.error('\nERROR:', e.message);
    console.error(e.stack);
  } finally {
    await closeBrowser();
  }
})();
