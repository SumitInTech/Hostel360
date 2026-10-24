/**
 * HOSTEL 360 - MemoryService.gs
 * SMRITI: Advisory Institutional Memory Layer powered by Hindsight agent memory (Vectorize).
 *
 * Rules:
 * 1. Advisory only. Never influences or blocks rule-based allocation.
 * 2. Non-blocking: All operations are safely wrapped in try/catch and never throw to callers.
 * 3. Privacy-preserving: All content is scrubbed of names, emails, phone numbers, and IDs.
 * 4. No hardcoded secrets: Credentials read from Script Properties.
 */

var MemoryService = (function () {
  var DEFAULT_BASE_URL = 'https://api.hindsight.vectorize.io';

  /**
   * Scrubs sensitive personal identification data (PII) before transmission.
   * Removes emails, phone-like numbers, and long digit strings (IDs, roll numbers).
   * Preserves academic years (e.g. 2024-25) and standard ISO dates (e.g. 2024-08-15).
   *
   * @param {string} text - Raw text to scrub
   * @returns {string} Sanitized string safe for institutional memory retention
   */
  function smritiScrub_(text) {
    if (!text) return '';
    var scrubbed = String(text);

    // Redact email addresses
    scrubbed = scrubbed.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[EMAIL_REDACTED]');

    // Redact phone numbers (standard 10-digit or Indian formats)
    scrubbed = scrubbed.replace(/(?:\+91[\-\s]?)?[6-9]\d{9}\b|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b/g, '[PHONE_REDACTED]');

    // Redact long numeric identifiers (enrollment numbers, student IDs >= 6 consecutive digits)
    scrubbed = scrubbed.replace(/\b\d{6,}\b/g, '[ID_REDACTED]');

    return scrubbed;
  }

  /**
   * Retrieves current configuration from Script Properties.
   *
   * @returns {{ apiKey: string, bankId: string, baseUrl: string }}
   */
  function smritiGetConfig_() {
    var props = PropertiesService.getScriptProperties();
    return {
      apiKey: props.getProperty('HINDSIGHT_API_KEY') || '',
      bankId: props.getProperty('HINDSIGHT_BANK_ID') || '',
      baseUrl: props.getProperty('HINDSIGHT_BASE_URL') || DEFAULT_BASE_URL
    };
  }

  /**
   * One unified gateway for all outbound HTTP requests to the Hindsight REST API.
   * Features:
   * - muteHttpExceptions: true
   * - 1 retry on 5xx status codes
   * - Defensive parsing of response payload
   * - Never throws exceptions to callers
   *
   * @param {string} path - API endpoint path (may contain {bank_id} placeholder)
   * @param {Object} payload - JSON body payload
   * @returns {{ ok: boolean, data?: any, status?: number, error?: string, raw?: string }}
   */
  function smritiRequest_(path, payload) {
    try {
      var config = smritiGetConfig_();
      if (!config.apiKey || !config.bankId) {
        return {
          ok: false,
          error: 'Hindsight API key or Bank ID not configured in Script Properties.'
        };
      }

      var resolvedPath = path.replace(/\{bank_id\}/g, encodeURIComponent(config.bankId));
      var cleanBase = config.baseUrl.replace(/\/+$/, '');
      var cleanPath = resolvedPath.replace(/^\/+/, '');
      var url = cleanBase + '/' + cleanPath;

      var headers = {
        'Authorization': 'Bearer ' + config.apiKey,
        'Content-Type': 'application/json'
      };

      var options = {
        method: 'post',
        headers: headers,
        payload: JSON.stringify(payload || {}),
        muteHttpExceptions: true
      };

      var response = null;
      var statusCode = 0;
      var responseText = '';

      // Execute request with up to 1 retry on 5xx server errors
      for (var attempt = 0; attempt < 2; attempt++) {
        try {
          response = UrlFetchApp.fetch(url, options);
          statusCode = response.getResponseCode();
          responseText = response.getContentText() || '';
          if (statusCode < 500) {
            break; // 2xx, 3xx, 4xx: do not retry
          }
        } catch (netErr) {
          if (attempt === 1) {
            return {
              ok: false,
              error: 'Network error calling Hindsight: ' + netErr.message
            };
          }
        }
        Utilities.sleep(500);
      }

      // Log raw response defensively once
      Logger.log('Hindsight [' + resolvedPath + '] status ' + statusCode + ': ' + responseText.substring(0, 300));

      if (statusCode >= 200 && statusCode < 300) {
        var parsedData = null;
        try {
          parsedData = JSON.parse(responseText);
        } catch (jsonErr) {
          parsedData = responseText;
        }
        return {
          ok: true,
          status: statusCode,
          data: parsedData,
          raw: responseText
        };
      }

      return {
        ok: false,
        status: statusCode,
        error: 'Hindsight API returned HTTP ' + statusCode + ': ' + responseText,
        raw: responseText
      };
    } catch (err) {
      Logger.log('Smriti HTTP error: ' + err.message);
      return {
        ok: false,
        error: err.message || 'Unexpected error communicating with Hindsight.'
      };
    }
  }

  /**
   * Retains a single institutional memory event asynchronously into the Hindsight memory bank.
   *
   * @param {string} content - Descriptive text of the institutional decision/event
   * @param {string} [context='general'] - Operational context label
   * @param {string} [timestampIso] - ISO8601 timestamp string
   * @returns {{ ok: boolean, error?: string }}
   */
  function smritiRetain(content, context, timestampIso) {
    try {
      if (!content || !String(content).trim()) {
        return { ok: false, error: 'Cannot retain empty content.' };
      }

      var scrubbedContent = smritiScrub_(content);
      var ts = timestampIso || new Date().toISOString();
      var ctx = context || 'general';

      var body = {
        items: [
          {
            content: scrubbedContent,
            context: ctx,
            timestamp: ts
          }
        ],
        async: true
      };

      return smritiRequest_('/v1/default/banks/{bank_id}/memories', body);
    } catch (err) {
      Logger.log('smritiRetain error: ' + err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Retains an array of memory items in batches of 10 with async=true.
   *
   * @param {Array<{ content: string, context?: string, timestamp?: string }>} items
   * @returns {{ ok: boolean, count: number, error?: string }}
   */
  function smritiRetainBatch(items) {
    try {
      if (!items || !items.length) {
        return { ok: true, count: 0 };
      }

      var chunkSize = 10;
      var totalProcessed = 0;
      var anyFailure = null;

      for (var i = 0; i < items.length; i += chunkSize) {
        var chunk = items.slice(i, i + chunkSize);
        var mappedChunk = chunk.map(function (it) {
          return {
            content: smritiScrub_(it.content),
            context: it.context || 'general',
            timestamp: it.timestamp || new Date().toISOString()
          };
        });

        var body = {
          items: mappedChunk,
          async: true
        };

        var res = smritiRequest_('/v1/default/banks/{bank_id}/memories', body);
        if (res.ok) {
          totalProcessed += chunk.length;
        } else {
          anyFailure = res.error || 'Batch chunk retention failed';
          Logger.log('smritiRetainBatch chunk error at index ' + i + ': ' + anyFailure);
        }
      }

      return {
        ok: totalProcessed > 0 || !anyFailure,
        count: totalProcessed,
        error: anyFailure
      };
    } catch (err) {
      Logger.log('smritiRetainBatch error: ' + err.message);
      return { ok: false, count: 0, error: err.message };
    }
  }

  /**
   * Recalls relevant historical memories for a given search query.
   *
   * @param {string} query - Query string to search institutional memory
   * @returns {{ ok: boolean, items: Array<any>, raw?: string, error?: string }}
   */
  function smritiRecall(query) {
    try {
      if (!query || !String(query).trim()) {
        return { ok: false, items: [], error: 'Query is required for memory recall.' };
      }

      var scrubbedQuery = smritiScrub_(query);
      var body = { query: scrubbedQuery };

      var res = smritiRequest_('/v1/default/banks/{bank_id}/memories/recall', body);
      if (!res.ok) {
        return { ok: false, items: [], error: res.error, raw: res.raw };
      }

      // Defensively parse items from varying Hindsight response envelopes
      var items = [];
      var d = res.data;
      if (Array.isArray(d)) {
        items = d;
      } else if (d && typeof d === 'object') {
        if (Array.isArray(d.memories)) items = d.memories;
        else if (Array.isArray(d.items)) items = d.items;
        else if (Array.isArray(d.results)) items = d.results;
        else if (Array.isArray(d.data)) items = d.data;
        else if (d.content || d.text || d.memory) items = [d];
      }

      return {
        ok: true,
        items: items,
        raw: res.raw
      };
    } catch (err) {
      Logger.log('smritiRecall error: ' + err.message);
      return { ok: false, items: [], error: err.message };
    }
  }

  /**
   * Reflects over institutional memories to formulate a synthesis answer with context.
   *
   * @param {string} query - Analytical or advisory inquiry
   * @param {string} [context] - Contextual data (e.g. current draft allocation state)
   * @returns {{ ok: boolean, answer: string, raw?: string, error?: string }}
   */
  function smritiReflect(query, context) {
    try {
      if (!query || !String(query).trim()) {
        return { ok: false, answer: '', error: 'Query is required for memory reflection.' };
      }

      var scrubbedQuery = smritiScrub_(query);
      var scrubbedCtx = smritiScrub_(context || '');

      var body = {
        query: scrubbedQuery,
        context: scrubbedCtx
      };

      var res = smritiRequest_('/v1/default/banks/{bank_id}/reflect', body);
      if (!res.ok) {
        return { ok: false, answer: '', error: res.error, raw: res.raw };
      }

      // Defensively extract answer string
      var answer = '';
      var d = res.data;
      if (typeof d === 'string') {
        answer = d;
      } else if (d && typeof d === 'object') {
        answer = d.answer || d.response || d.reflection || d.text || d.result || d.content ||
          (d.data && (d.data.answer || d.data.response || d.data.text || d.data.content)) ||
          JSON.stringify(d);
      }

      return {
        ok: true,
        answer: String(answer || ''),
        raw: res.raw
      };
    } catch (err) {
      Logger.log('smritiReflect error: ' + err.message);
      return { ok: false, answer: '', error: err.message };
    }
  }

  /**
   * Health check diagnostic function to verify connectivity with Hindsight.
   * Runs one test retain and one test recall, logging all results.
   *
   * @returns {{ configured: boolean, retain: Object, recall: Object }}
   */
  function smritiHealthCheck() {
    Logger.log('--- Starting Smriti Hindsight Health Check ---');
    var config = smritiGetConfig_();
    var hasConfig = !!(config.apiKey && config.bankId);
    Logger.log('Configured: ' + hasConfig + ' (Bank: ' + (config.bankId ? config.bankId : 'MISSING') + ')');

    if (!hasConfig) {
      Logger.log('Health check aborted: Please set HINDSIGHT_API_KEY and HINDSIGHT_BANK_ID via smritiSetConfig().');
      return {
        configured: false,
        retain: { ok: false, error: 'Config missing' },
        recall: { ok: false, error: 'Config missing' }
      };
    }

    var retainRes = smritiRetain('Institutional system diagnostic health check event.', 'system_health');
    Logger.log('Health Check Retain: ' + JSON.stringify(retainRes));

    var recallRes = smritiRecall('diagnostic health check');
    Logger.log('Health Check Recall: ' + JSON.stringify(recallRes));

    return {
      configured: true,
      retain: retainRes,
      recall: recallRes
    };
  }

  /**
   * One-time setup utility to persist Hindsight API credentials into Script Properties.
   *
   * @param {string} apiKey - Hindsight Bearer API Key
   * @param {string} bankId - Target Hindsight Memory Bank ID
   * @param {string} [baseUrl] - Custom base URL (defaults to https://api.hindsight.vectorize.io)
   * @returns {{ ok: boolean, bankId: string, baseUrl: string }}
   */
  function smritiSetConfig(apiKey, bankId, baseUrl) {
    var props = PropertiesService.getScriptProperties();
    if (apiKey) props.setProperty('HINDSIGHT_API_KEY', String(apiKey).trim());
    if (bankId) props.setProperty('HINDSIGHT_BANK_ID', String(bankId).trim());
    var url = (baseUrl && String(baseUrl).trim()) ? String(baseUrl).trim() : DEFAULT_BASE_URL;
    props.setProperty('HINDSIGHT_BASE_URL', url);

    Logger.log('Smriti configuration saved: Bank ID = ' + bankId + ', Base URL = ' + url);
    return {
      ok: true,
      bankId: bankId,
      baseUrl: url
    };
  }

  return {
    smritiScrub_: smritiScrub_,
    smritiRequest_: smritiRequest_,
    smritiRetain: smritiRetain,
    smritiRetainBatch: smritiRetainBatch,
    smritiRecall: smritiRecall,
    smritiReflect: smritiReflect,
    smritiHealthCheck: smritiHealthCheck,
    smritiSetConfig: smritiSetConfig
  };
})();

// ============================================================
// TOP-LEVEL CONVENIENCE WRAPPERS (Callable from Apps Script Editor)
// ============================================================

function smritiSetConfig(apiKey, bankId, baseUrl) {
  return MemoryService.smritiSetConfig(apiKey, bankId, baseUrl);
}

function smritiHealthCheck() {
  return MemoryService.smritiHealthCheck();
}

function smritiRetain(content, context, timestampIso) {
  return MemoryService.smritiRetain(content, context, timestampIso);
}

function smritiRecall(query) {
  return MemoryService.smritiRecall(query);
}

function smritiReflect(query, context) {
  return MemoryService.smritiReflect(query, context);
}
