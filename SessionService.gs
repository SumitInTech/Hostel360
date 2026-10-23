/**
 * HOSTEL 360 - SessionService.gs
 * Resilient server-side session management using HMAC-SHA256 signed tokens
 * and Google Apps Script CacheService for high performance.
 */

var SessionService = (function () {
  var SESSION_TTL_SECONDS = 21600; // 6 hours
  var SECRET_PROP_KEY = 'HOSTEL360_AUTH_SECRET';

  /**
   * Retrieves or initializes persistent secret key for token signing
   */
  function getSigningSecret() {
    var props = PropertiesService.getScriptProperties();
    var secret = props.getProperty(SECRET_PROP_KEY);
    if (!secret) {
      secret = Utilities.getUuid() + '_' + Utilities.getUuid();
      props.setProperty(SECRET_PROP_KEY, secret);
    }
    return secret;
  }

  /**
   * Computes HMAC-SHA256 signature for a string
   */
  function signString(str) {
    var secret = getSigningSecret();
    var rawSig = Utilities.computeHmacSha256Signature(str, secret);
    var hex = '';
    for (var i = 0; i < rawSig.length; i++) {
      var byteVal = rawSig[i];
      if (byteVal < 0) byteVal += 256;
      var byteHex = byteVal.toString(16);
      if (byteHex.length === 1) byteHex = '0' + byteHex;
      hex += byteHex;
    }
    return hex;
  }

  /**
   * Creates an active session with signed token
   */
  function createSession(user) {
    if (!user || !user.UserID) {
      throw new Error('Invalid user payload for session creation.');
    }

    var now = new Date().getTime();
    var expiresAtTime = now + (SESSION_TTL_SECONDS * 1000);
    var expiresAtIso = new Date(expiresAtTime).toISOString();

    var payload = {
      userId: String(user.UserID),
      email: String(user.Email).toLowerCase(),
      role: String(user.Role).toUpperCase(),
      studentId: user.StudentID ? String(user.StudentID) : '',
      name: String(user.Name || ''),
      exp: expiresAtTime
    };

    var payloadJson = JSON.stringify(payload);
    var encodedPayload = Utilities.base64EncodeWebSafe(payloadJson);
    var signature = signString(encodedPayload);
    var token = encodedPayload + '.' + signature;

    var sessionData = {
      token: token,
      userId: payload.userId,
      email: payload.email,
      role: payload.role,
      studentId: payload.studentId,
      name: payload.name,
      expiresAt: expiresAtIso
    };

    // Cache session in ScriptCache for fast lookup
    try {
      var cache = CacheService.getScriptCache();
      cache.put('sess_' + token, JSON.stringify(sessionData), SESSION_TTL_SECONDS);
    } catch (e) {
      // Non-fatal if cache unavailable
    }

    return {
      token: token,
      user: {
        userId: sessionData.userId,
        email: sessionData.email,
        role: sessionData.role,
        studentId: sessionData.studentId,
        name: sessionData.name
      },
      expiresAt: expiresAtIso
    };
  }

  /**
   * Retrieves an active session by token with signature fallback
   */
  function getSession(token) {
    if (!token || typeof token !== 'string') return null;

    // 1. Check fast cache first
    try {
      var cache = CacheService.getScriptCache();
      var cached = cache.get('sess_' + token);
      if (cached) {
        var cachedSess = JSON.parse(cached);
        if (new Date(cachedSess.expiresAt).getTime() > new Date().getTime()) {
          return cachedSess;
        }
      }
    } catch (e) {}

    // 2. Validate HMAC-SHA256 token structure
    try {
      var dotIndex = token.lastIndexOf('.');
      if (dotIndex === -1) return null;

      var encodedPayload = token.substring(0, dotIndex);
      var providedSig = token.substring(dotIndex + 1);
      var expectedSig = signString(encodedPayload);

      if (providedSig !== expectedSig) {
        return null;
      }

      var decodedJson = Utilities.newBlob(Utilities.base64DecodeWebSafe(encodedPayload)).getDataAsString();
      var payload = JSON.parse(decodedJson);

      var now = new Date().getTime();
      if (payload.exp && payload.exp < now) {
        return null; // Expired
      }

      var sessionObj = {
        token: token,
        userId: payload.userId,
        email: payload.email,
        role: payload.role,
        studentId: payload.studentId,
        name: payload.name,
        expiresAt: new Date(payload.exp || (now + 3600000)).toISOString()
      };

      // Re-populate cache
      try {
        var c = CacheService.getScriptCache();
        c.put('sess_' + token, JSON.stringify(sessionObj), SESSION_TTL_SECONDS);
      } catch (cacheErr) {}

      return sessionObj;
    } catch (parseErr) {
      return null;
    }
  }

  /**
   * Destroys a session token
   */
  function destroySession(token) {
    if (!token) return;
    try {
      var cache = CacheService.getScriptCache();
      cache.remove('sess_' + token);
    } catch (e) {}
  }

  return {
    createSession: createSession,
    getSession: getSession,
    destroySession: destroySession
  };
})();
