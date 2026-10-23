/**
 * HOSTEL 360 - DistanceService.gs
 * Distance calculation service from Dwarka Campus (Sector 16C, Dwarka, New Delhi).
 * Provides heuristic distance estimation for MVP with clear abstraction for Google Routes API integration.
 */

var DistanceService = (function () {

  // Coordinates of Dwarka Campus: Lat 28.5950, Lng 77.0199
  var DWARKA_CAMPUS_ORIGIN = {
    name: 'Dwarka Campus, Sector 16C, Dwarka, New Delhi 110078',
    lat: 28.5950,
    lng: 77.0199
  };

  // State-level synthetic baseline distances (in km) for deterministic priority calculation
  var STATE_DISTANCE_MAP = {
    'DELHI': 18,
    'HARYANA': 95,
    'UTTAR PRADESH': 280,
    'PUNJAB': 320,
    'RAJASTHAN': 340,
    'HIMACHAL PRADESH': 410,
    'UTTARAKHAND': 330,
    'JAMMU AND KASHMIR': 650,
    'LADAKH': 980,
    'BIHAR': 1050,
    'MADHYA PRADESH': 750,
    'GUJARAT': 920,
    'MAHARASHTRA': 1350,
    'WEST BENGAL': 1480,
    'ODISHA': 1580,
    'ASSAM': 1950,
    'TELANGANA': 1520,
    'ANDHRA PRADESH': 1750,
    'KARNATAKA': 2100,
    'TAMIL NADU': 2250,
    'KERALA': 2600,
    'OTHER': 800
  };

  /**
   * Calculates distance in kilometers from Dwarka Campus to a given address.
   *
   * @param {Object} addressDetails - { address, city, state, pincode, isDelhiNCR }
   * @returns {number} distance in kilometers
   */
  function calculateDistance(addressDetails) {
    if (!addressDetails) return 0;

    // Check if Google Routes API is enabled via Script Properties
    var routesApiKey = PropertiesService.getScriptProperties().getProperty('GOOGLE_ROUTES_API_KEY');
    if (routesApiKey) {
      try {
        var apiDistance = fetchGoogleRoutesDistance(addressDetails, routesApiKey);
        if (apiDistance !== null) {
          return apiDistance;
        }
      } catch (e) {
        Logger.log('Google Routes API call fallback to heuristic: ' + e.message);
      }
    }

    // Heuristic Distance Engine for MVP
    return computeHeuristicDistance(addressDetails);
  }

  /**
   * Deterministic heuristic distance computation
   */
  function computeHeuristicDistance(addr) {
    var state = String(addr.state || '').trim().toUpperCase();
    var city = String(addr.city || '').trim().toUpperCase();
    var isNCR = addr.isDelhiNCR === true || addr.isDelhiNCR === 'true' || addr.isDelhiNCR === 'YES';

    if (isNCR || state === 'DELHI' || city === 'DELHI' || city === 'NEW DELHI') {
      var pin = parseInt(String(addr.pincode).trim(), 10) || 110001;
      // Dwarka is 110078. Distance across Delhi varies from 3km to 45km
      var diff = Math.abs(pin - 110078) % 40;
      return Math.max(5, Math.min(48, 8 + diff));
    }

    if (STATE_DISTANCE_MAP[state]) {
      var base = STATE_DISTANCE_MAP[state];
      // Add deterministic city salt to prevent exact ties across different addresses in same state
      var hash = 0;
      for (var i = 0; i < city.length; i++) {
        hash = ((hash << 5) - hash) + city.charCodeAt(i);
        hash |= 0;
      }
      var variance = (Math.abs(hash) % 75) - 35;
      return Math.max(50, base + variance);
    }

    return 650; // default outstation distance
  }

  /**
   * Future Google Routes API integration stub
   * Safe server-side call using UrlFetchApp without exposing credentials.
   */
  function fetchGoogleRoutesDistance(addr, apiKey) {
    var destination = [addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(', ');
    if (!destination) return null;

    var url = 'https://routes.googleapis.com/directions/v2:computeRoutes';
    var payload = {
      origin: {
        address: DWARKA_CAMPUS_ORIGIN.name
      },
      destination: {
        address: destination
      },
      travelMode: 'DRIVE'
    };

    var options = {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() === 200) {
      var result = JSON.parse(response.getContentText());
      if (result.routes && result.routes.length > 0 && result.routes[0].distanceMeters) {
        return Math.round(result.routes[0].distanceMeters / 1000);
      }
    }
    return null;
  }

  return {
    DWARKA_CAMPUS_ORIGIN: DWARKA_CAMPUS_ORIGIN,
    calculateDistance: calculateDistance
  };
})();
