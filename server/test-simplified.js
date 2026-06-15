const { searchESky, closeBrowser } = require('./services/eSkyScraper');

(async () => {
  try {
    console.log('=== Testing simplified eSky search (no passenger/class adjustment) ===\n');
    
    const result = await searchESky({
      originCity: 'Bucuresti',
      originAirportCode: 'OTP',
      destinationCity: 'Londra',
      destinationAirportCode: 'LTN',
      departureDate: '2026-04-18',
      returnDate: '2026-04-25',
      tripType: 'round_trip',
      passengers: 2,
      cabinClass: 'economy'
    });
    
    console.log('\n=== Test Complete ===');
    console.log('RESULT_COUNT:', result?.offers?.length || 0);
    if (result?.offers && result.offers.length > 0) {
      console.log('First offer:', JSON.stringify(result.offers[0], null, 2));
    }
  } catch (e) {
    console.error('\nERROR:', e.message);
    console.error(e.stack);
  } finally {
    await closeBrowser();
  }
})();
