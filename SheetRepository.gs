/**
 * HOSTEL 360 - SheetRepository.gs
 * High-Performance relational repository layer for all 17 Google Sheets.
 * Includes Request-Scoped In-Memory Caching to minimize Google Sheets API roundtrips,
 * sanitizes phone numbers / formula triggers, and normalizes date/null types for safe serialization.
 */

var SheetRepository = (function () {

  var SHEETS = {
    USERS: 'Users',
    STUDENTS: 'Students',
    APPLICATIONS: 'Applications',
    DOCUMENTS: 'Documents',
    HOSTELS: 'Hostels',
    ROOMS: 'Rooms',
    BEDS: 'Beds',
    POLICIES: 'Policies',
    RESERVATION_RULES: 'ReservationRules',
    PRIORITY_RULES: 'PriorityRules',
    PREFERENCES: 'Preferences',
    ALLOCATIONS: 'Allocations',
    WAITLIST: 'Waitlist',
    PAYMENTS: 'Payments',
    AUDIT_LOG: 'AuditLog',
    NOTIFICATIONS: 'Notifications',
    ACADEMIC_YEARS: 'AcademicYears'
  };

  // Request-Scoped Memory Caches for ultra-fast execution within the same execution context
  var _cachedSpreadsheet = null;
  var _cachedSheets = {};
  var _cachedHeaderMaps = {};
  var _requestRecordsCache = {};

  /**
   * Get the active spreadsheet instance (cached for request duration)
   */
  function getSpreadsheet() {
    if (_cachedSpreadsheet) return _cachedSpreadsheet;

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      var propId = PropertiesService.getScriptProperties().getProperty('HOSTEL360_SPREADSHEET_ID');
      if (propId) {
        ss = SpreadsheetApp.openById(propId);
      }
    }
    if (!ss) {
      throw new Error('Spreadsheet not found. Please run setupHostel360() or bind script to a Google Spreadsheet.');
    }
    _cachedSpreadsheet = ss;
    return _cachedSpreadsheet;
  }

  /**
   * Get a sheet by name (cached for request duration)
   */
  function getSheet(sheetName) {
    if (_cachedSheets[sheetName]) return _cachedSheets[sheetName];

    var ss = getSpreadsheet();
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      throw new Error('Sheet "' + sheetName + '" does not exist. Please run setupHostel360().');
    }
    _cachedSheets[sheetName] = sheet;
    return sheet;
  }

  /**
   * Reads header row and returns a map of headerName -> columnIndex (0-indexed)
   */
  function getHeaderMap(sheet) {
    var sheetName = sheet.getName();
    if (_cachedHeaderMaps[sheetName]) return _cachedHeaderMaps[sheetName];

    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) return {};
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var map = {};
    for (var i = 0; i < headers.length; i++) {
      var header = String(headers[i]).trim();
      if (header) {
        map[header] = i;
      }
    }
    _cachedHeaderMaps[sheetName] = map;
    return map;
  }

  /**
   * Prepares a value safely for writing to a Google Sheet cell.
   * If a string starts with '+', '=', '-', '@', Google Sheets parses it as a formula.
   * Prefixing with a single apostrophe (') forces plain text storage, preventing #ERROR! formula parse issues.
   */
  function sanitizeCellValueForWrite(val) {
    if (val === undefined || val === null) return '';
    if (typeof val === 'string') {
      var trimmed = val.trim();
      if (trimmed.length > 0) {
        var firstChar = trimmed.charAt(0);
        if (firstChar === '+' || firstChar === '=' || firstChar === '@') {
          return "'" + trimmed;
        }
      }
      return val;
    }
    return val;
  }

  /**
   * Helper to normalize cell values for safe JSON serialization
   */
  function normalizeCellValue(val) {
    if (val === null || val === undefined) return '';
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (typeof val === 'string') {
      // Clean up any formula parse error strings
      if (val.indexOf('#ERROR!') !== -1 || val.indexOf('#REF!') !== -1 || val.indexOf('#NAME?') !== -1) {
        return '';
      }
      // If cell begins with a leading apostrophe added for escaping, strip it
      if (val.charAt(0) === "'" && val.length > 1) {
        return val.substring(1);
      }
    }
    return val;
  }

  /**
   * Fetches all records from a sheet as an array of objects.
   * Uses Request-Scoped Memory Cache to eliminate redundant network roundtrips.
   */
  function getAllRecords(sheetName) {
    if (_requestRecordsCache[sheetName]) {
      return _requestRecordsCache[sheetName];
    }

    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) {
      _requestRecordsCache[sheetName] = [];
      return [];
    }

    var data = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var records = [];

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      // Skip empty rows
      var hasData = row.some(function (cell) { return cell !== '' && cell !== null && cell !== undefined; });
      if (!hasData) continue;

      var obj = { _rowNumber: r + 1 };
      for (var c = 0; c < headers.length; c++) {
        var header = headers[c];
        if (header) {
          obj[header] = normalizeCellValue(row[c]);
        }
      }
      records.push(obj);
    }

    _requestRecordsCache[sheetName] = records;
    return records;
  }

  /**
   * Invalidate record cache for a modified sheet
   */
  function invalidateCache(sheetName) {
    if (sheetName) {
      delete _requestRecordsCache[sheetName];
    } else {
      _requestRecordsCache = {};
    }
  }

  /**
   * Find records matching a filter function
   */
  function findRecords(sheetName, filterFn) {
    var records = getAllRecords(sheetName);
    if (typeof filterFn !== 'function') return records;
    return records.filter(filterFn);
  }

  /**
   * Find a single record matching a key-value pair
   */
  function findRecordByKey(sheetName, key, value) {
    var records = getAllRecords(sheetName);
    for (var i = 0; i < records.length; i++) {
      if (String(records[i][key]) === String(value)) {
        return records[i];
      }
    }
    return null;
  }

  function ensureColumn(sheet, headerMap, fieldName) {
    if (headerMap.hasOwnProperty(fieldName)) return headerMap[fieldName];
    var lastCol = sheet.getLastColumn();
    var newCol = lastCol + 1;
    sheet.getRange(1, newCol).setValue(fieldName);
    sheet.getRange(1, newCol).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
    sheet.getRange(1, newCol, Math.max(10, sheet.getMaxRows()), 1).setNumberFormat('@');
    headerMap[fieldName] = lastCol; // 0-indexed
    var sheetName = sheet.getName();
    _cachedHeaderMaps[sheetName] = headerMap;
    return headerMap[fieldName];
  }

  /**
   * Insert a new record into a sheet
   */
  function insertRecord(sheetName, recordData) {
    var sheet = getSheet(sheetName);
    var headerMap = getHeaderMap(sheet);

    for (var key in recordData) {
      if (recordData.hasOwnProperty(key) && !headerMap.hasOwnProperty(key)) {
        ensureColumn(sheet, headerMap, key);
      }
    }

    var headerKeys = Object.keys(headerMap);
    var rowArray = new Array(headerKeys.length);
    for (var k in headerMap) {
      if (headerMap.hasOwnProperty(k)) {
        var colIdx = headerMap[k];
        var val = recordData[k];
        rowArray[colIdx] = sanitizeCellValueForWrite(val);
      }
    }

    sheet.appendRow(rowArray);
    invalidateCache(sheetName);
    return recordData;
  }

  /**
   * Batch insert records
   */
  function batchInsertRecords(sheetName, recordsArray) {
    if (!recordsArray || recordsArray.length === 0) return [];
    var sheet = getSheet(sheetName);
    var headerMap = getHeaderMap(sheet);

    recordsArray.forEach(function (rec) {
      for (var key in rec) {
        if (rec.hasOwnProperty(key) && !headerMap.hasOwnProperty(key)) {
          ensureColumn(sheet, headerMap, key);
        }
      }
    });

    var headerKeys = Object.keys(headerMap);
    var numCols = headerKeys.length;

    var rows = recordsArray.map(function (record) {
      var row = new Array(numCols);
      for (var key in headerMap) {
        if (headerMap.hasOwnProperty(key)) {
          var colIdx = headerMap[key];
          var val = record[key];
          row[colIdx] = sanitizeCellValueForWrite(val);
        }
      }
      return row;
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, numCols).setValues(rows);
    invalidateCache(sheetName);
    return recordsArray;
  }

  /**
   * Update a record matching a key-value pair
   */
  function updateRecordByKey(sheetName, keyName, keyValue, updatedFields) {
    var sheet = getSheet(sheetName);
    var records = getAllRecords(sheetName);
    var targetRecord = null;

    for (var i = 0; i < records.length; i++) {
      if (String(records[i][keyName]) === String(keyValue)) {
        targetRecord = records[i];
        break;
      }
    }

    if (!targetRecord) {
      return false;
    }

    var rowNumber = targetRecord._rowNumber;
    var headerMap = getHeaderMap(sheet);

    for (var field in updatedFields) {
      if (updatedFields.hasOwnProperty(field)) {
        if (!headerMap.hasOwnProperty(field)) {
          ensureColumn(sheet, headerMap, field);
        }
        var colIndex = headerMap[field] + 1; // 1-indexed for Sheet Range
        var newVal = updatedFields[field];
        sheet.getRange(rowNumber, colIndex).setValue(sanitizeCellValueForWrite(newVal));
      }
    }

    invalidateCache(sheetName);
    return true;
  }

  /**
   * Delete a record by key
   */
  function deleteRecordByKey(sheetName, keyName, keyValue) {
    var sheet = getSheet(sheetName);
    var records = getAllRecords(sheetName);

    for (var i = 0; i < records.length; i++) {
      if (String(records[i][keyName]) === String(keyValue)) {
        sheet.deleteRow(records[i]._rowNumber);
        invalidateCache(sheetName);
        return true;
      }
    }
    return false;
  }

  /**
   * High-performance in-memory bulk update for multiple records in a sheet.
   * Reads the entire sheet matrix once, applies all updates in memory, and writes back with one setValues() call.
   *
   * @param {string} sheetName
   * @param {string} keyName - Column header name used as lookup key (e.g. 'AllocationID', 'RoomID')
   * @param {Object} updatesMap - Map of { [keyValue]: { field1: val1, field2: val2, ... } }
   * @returns {number} Count of records updated
   */
  function bulkUpdateRecords(sheetName, keyName, updatesMap) {
    if (!updatesMap || Object.keys(updatesMap).length === 0) return 0;
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return 0;

    var headerMap = getHeaderMap(sheet);
    // Ensure all updated fields exist in header
    for (var k in updatesMap) {
      if (updatesMap.hasOwnProperty(k)) {
        var fields = updatesMap[k];
        for (var f in fields) {
          if (fields.hasOwnProperty(f) && !headerMap.hasOwnProperty(f)) {
            ensureColumn(sheet, headerMap, f);
          }
        }
      }
    }

    lastCol = sheet.getLastColumn();
    var range = sheet.getRange(1, 1, lastRow, lastCol);
    var data = range.getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });
    var keyColIdx = headers.indexOf(keyName);
    if (keyColIdx === -1) return 0;

    var updatedCount = 0;
    for (var r = 1; r < data.length; r++) {
      var rowKey = String(data[r][keyColIdx]);
      if (updatesMap.hasOwnProperty(rowKey)) {
        var patch = updatesMap[rowKey];
        for (var patchField in patch) {
          if (patch.hasOwnProperty(patchField)) {
            var colIdx = headers.indexOf(patchField);
            if (colIdx !== -1) {
              data[r][colIdx] = sanitizeCellValueForWrite(patch[patchField]);
            }
          }
        }
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      range.setValues(data);
      invalidateCache(sheetName);
    }
    return updatedCount;
  }

  /**
   * High-performance deletion of multiple records matching a predicate in a single write operation.
   *
   * @param {string} sheetName
   * @param {Function} predicateFn - Function(record) returning true for records that should be DELETED
   * @returns {number} Count of records deleted
   */
  function deleteRecordsWhere(sheetName, predicateFn) {
    if (typeof predicateFn !== 'function') return 0;
    var sheet = getSheet(sheetName);
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) return 0;

    var range = sheet.getRange(1, 1, lastRow, lastCol);
    var data = range.getValues();
    var headers = data[0].map(function (h) { return String(h).trim(); });

    var keptRows = [data[0]];
    var deletedCount = 0;

    for (var r = 1; r < data.length; r++) {
      var row = data[r];
      var obj = {};
      for (var c = 0; c < headers.length; c++) {
        if (headers[c]) {
          obj[headers[c]] = normalizeCellValue(row[c]);
        }
      }

      if (predicateFn(obj)) {
        deletedCount++;
      } else {
        keptRows.push(row);
      }
    }

    if (deletedCount > 0) {
      sheet.clearContents();
      sheet.getRange(1, 1, keptRows.length, lastCol).setValues(keptRows);
      sheet.getRange(1, 1, Math.max(10, sheet.getMaxRows()), lastCol).setNumberFormat('@');
      sheet.getRange(1, 1, 1, lastCol).setFontWeight('bold').setBackground('#1e3a8a').setFontColor('#ffffff');
      sheet.setFrozenRows(1);
      invalidateCache(sheetName);
    }
    return deletedCount;
  }

  /**
   * Counts records in a sheet matching an optional filter
   */
  function countRecords(sheetName, filterFn) {
    return findRecords(sheetName, filterFn).length;
  }

  return {
    SHEETS: SHEETS,
    getSpreadsheet: getSpreadsheet,
    getSheet: getSheet,
    getHeaderMap: getHeaderMap,
    getAllRecords: getAllRecords,
    findRecords: findRecords,
    findRecordByKey: findRecordByKey,
    insertRecord: insertRecord,
    batchInsertRecords: batchInsertRecords,
    updateRecordByKey: updateRecordByKey,
    bulkUpdateRecords: bulkUpdateRecords,
    deleteRecordByKey: deleteRecordByKey,
    deleteRecordsWhere: deleteRecordsWhere,
    countRecords: countRecords,
    sanitizeCellValueForWrite: sanitizeCellValueForWrite,
    invalidateCache: invalidateCache
  };
})();

