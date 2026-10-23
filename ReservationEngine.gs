/**
 * HOSTEL 360 - ReservationEngine.gs
 * Configurable institutional reservation quota management and explicit seat release workflows.
 * Unused reserved seats remain vacant unless explicitly released by the Warden.
 */

var ReservationEngine = (function () {

  /**
   * Retrieves active reservation rules from ReservationRules sheet
   */
  function getReservationRules(academicYear) {
    var rules = SheetRepository.findRecords(SheetRepository.SHEETS.RESERVATION_RULES, function (r) {
      var isAct = r.Status === 'ACTIVE' || r.Status === 'true' || r.Status === true;
      if (!academicYear) return isAct;
      return isAct && String(r.AcademicYear) === String(academicYear);
    });

    if (rules.length === 0) {
      // Default institutional reservation rules
      return [
        { RuleID: 'RR_GEN', AcademicYear: academicYear || '2026-27', Category: 'GENERAL', Percentage: 40.5, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_OBC', AcademicYear: academicYear || '2026-27', Category: 'OBC', Percentage: 27.0, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_SC', AcademicYear: academicYear || '2026-27', Category: 'SC', Percentage: 15.0, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_EWS', AcademicYear: academicYear || '2026-27', Category: 'EWS', Percentage: 10.0, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_ST', AcademicYear: academicYear || '2026-27', Category: 'ST', Percentage: 7.5, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_PWD', AcademicYear: academicYear || '2026-27', Category: 'PWD', Percentage: 5.0, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' },
        { RuleID: 'RR_FOREIGN', AcademicYear: academicYear || '2026-27', Category: 'FOREIGN', Percentage: 5.0, SeatCount: 0, UsedSeats: 0, RemainingSeats: 0, Status: 'ACTIVE' }
      ];
    }

    return rules;
  }

  /**
   * Calculates quota seat breakdown for a given total capacity
   */
  function calculateSeatQuotas(totalAvailableRooms, academicYear) {
    var rules = getReservationRules(academicYear);
    var quotaMap = {};
    var allocatedQuotaTotal = 0;

    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      var cat = String(r.Category).toUpperCase();
      var pct = parseFloat(r.Percentage) || 0;
      var seatCount = Math.round((pct / 100) * totalAvailableRooms);

      quotaMap[cat] = {
        ruleId: r.RuleID,
        category: cat,
        percentage: pct,
        seatCount: seatCount,
        allocatedSeats: 0,
        remainingSeats: seatCount
      };

      if (cat !== 'GENERAL') {
        allocatedQuotaTotal += seatCount;
      }
    }

    // Adjust GENERAL quota to ensure total matches exactly
    if (quotaMap['GENERAL']) {
      var genSeats = Math.max(0, totalAvailableRooms - allocatedQuotaTotal);
      quotaMap['GENERAL'].seatCount = genSeats;
      quotaMap['GENERAL'].remainingSeats = genSeats;
    }

    return quotaMap;
  }

  /**
   * Warden explicitly releases unused reserved seats into the general pool
   *
   * @param {string} category - Category to release from (e.g. SC, ST, OBC)
   * @param {number} seatsToRelease - Number of seats to release
   * @param {string} reason - Justification for release
   * @param {string} wardenEmail
   * @param {string} wardenUserId
   */
  function releaseReservedSeats(category, seatsToRelease, reason, wardenEmail, wardenUserId) {
    if (!category || !seatsToRelease || seatsToRelease <= 0) {
      throw new Error('Category and a positive number of seats to release are required.');
    }
    if (!reason || String(reason).trim().length < 5) {
      throw new Error('A detailed reason must be provided for releasing reserved seats.');
    }

    var cleanCat = String(category).toUpperCase();
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var rule = SheetRepository.findRecords(SheetRepository.SHEETS.RESERVATION_RULES, function (r) {
      return String(r.Category).toUpperCase() === cleanCat && String(r.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    if (!rule) {
      throw new Error('Reservation rule for category ' + cleanCat + ' not found in active academic year.');
    }

    var currentRemaining = parseInt(rule.RemainingSeats, 10) || 0;
    if (seatsToRelease > currentRemaining) {
      throw new Error('Cannot release ' + seatsToRelease + ' seats. Only ' + currentRemaining + ' remaining vacant seats in ' + cleanCat + ' quota.');
    }

    var newRemaining = currentRemaining - seatsToRelease;
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', rule.RuleID, {
      RemainingSeats: newRemaining
    });

    // Update General quota by adding the released seats
    var genRule = SheetRepository.findRecords(SheetRepository.SHEETS.RESERVATION_RULES, function (r) {
      return String(r.Category).toUpperCase() === 'GENERAL' && String(r.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    if (genRule) {
      var genRemaining = (parseInt(genRule.RemainingSeats, 10) || 0) + seatsToRelease;
      var genCount = (parseInt(genRule.SeatCount, 10) || 0) + seatsToRelease;
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', genRule.RuleID, {
        SeatCount: genCount,
        RemainingSeats: genRemaining
      });
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'RESERVED_SEATS_RELEASED',
      'ReservationRule',
      rule.RuleID,
      { category: cleanCat, remainingBefore: currentRemaining },
      { seatsReleased: seatsToRelease, remainingAfter: newRemaining },
      reason,
      'SUCCESS'
    );

    return {
      category: cleanCat,
      seatsReleased: seatsToRelease,
      remainingReservedSeats: newRemaining,
      reason: reason
    };
  }

  /**
   * Adds a new reservation category rule
   */
  function addReservationCategory(category, percentage, wardenEmail, wardenUserId) {
    if (!category || String(category).trim().length === 0) {
      throw new Error('Category name is required.');
    }
    var cleanCat = String(category).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var pct = Math.max(0, parseFloat(percentage) || 0);

    var ruleId = 'RR_' + cleanCat;
    var existing = SheetRepository.findRecords(SheetRepository.SHEETS.RESERVATION_RULES, function (r) {
      return (String(r.RuleID) === ruleId || String(r.Category).toUpperCase() === cleanCat) &&
        String(r.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    var nowIso = new Date().toISOString();
    var record = {
      RuleID: ruleId,
      AcademicYear: activeYear.AcademicYear,
      Category: cleanCat,
      Percentage: pct,
      SeatCount: 0,
      UsedSeats: 0,
      RemainingSeats: 0,
      Status: 'ACTIVE',
      UpdatedAt: nowIso
    };

    if (existing) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', existing.RuleID, record);
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.RESERVATION_RULES, record);
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'RESERVATION_RULE_ADDED',
      'ReservationRule',
      ruleId,
      null,
      record,
      'Added reservation quota category: ' + cleanCat + ' (' + pct + '%)',
      'SUCCESS'
    );

    return record;
  }

  /**
   * Updates an existing reservation category rule
   */
  function updateReservationCategory(ruleId, category, percentage, status, wardenEmail, wardenUserId) {
    if (!ruleId) throw new Error('Rule ID is required.');
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId);
    if (!existing) throw new Error('Reservation rule not found: ' + ruleId);

    var nowIso = new Date().toISOString();
    var updated = {
      Category: category ? String(category).toUpperCase() : existing.Category,
      Percentage: percentage !== undefined ? Math.max(0, parseFloat(percentage) || 0) : existing.Percentage,
      Status: status || existing.Status || 'ACTIVE',
      UpdatedAt: nowIso
    };

    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId, updated);

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'RESERVATION_RULE_UPDATED',
      'ReservationRule',
      ruleId,
      existing,
      updated,
      'Updated reservation category ' + ruleId,
      'SUCCESS'
    );

    return updated;
  }

  /**
   * Deletes a reservation category rule
   */
  function deleteReservationCategory(ruleId, wardenEmail, wardenUserId) {
    if (!ruleId) throw new Error('Rule ID is required.');
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId);
    if (!existing) throw new Error('Reservation rule not found: ' + ruleId);

    if (String(existing.Category).toUpperCase() === 'GENERAL') {
      throw new Error('The GENERAL quota category cannot be deleted.');
    }

    SheetRepository.deleteRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId);

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'RESERVATION_RULE_DELETED',
      'ReservationRule',
      ruleId,
      existing,
      null,
      'Deleted reservation category ' + existing.Category,
      'SUCCESS'
    );

    return { ruleId: ruleId, category: existing.Category, deleted: true };
  }

  /**
   * Updates reservation percentages across all rules
   */
  function updateReservationRules(rulesArray, wardenEmail, wardenUserId) {
    if (!Array.isArray(rulesArray) || rulesArray.length === 0) {
      throw new Error('Array of reservation rules is required.');
    }

    var activeYear = PolicyEngine.getActiveAcademicYear();
    var nowIso = new Date().toISOString();

    for (var i = 0; i < rulesArray.length; i++) {
      var item = rulesArray[i];
      var cat = String(item.Category || '').toUpperCase();
      var ruleId = item.RuleID || ('RR_' + cat);
      var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId);

      var recordData = {
        RuleID: ruleId,
        AcademicYear: activeYear.AcademicYear,
        Category: cat,
        Percentage: Math.max(0, parseFloat(item.Percentage) || 0),
        SeatCount: parseInt(item.SeatCount, 10) || 0,
        UsedSeats: parseInt(item.UsedSeats, 10) || 0,
        RemainingSeats: parseInt(item.RemainingSeats, 10) || 0,
        Status: item.Status || 'ACTIVE',
        UpdatedAt: nowIso
      };

      if (existing) {
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.RESERVATION_RULES, 'RuleID', ruleId, recordData);
      } else {
        SheetRepository.insertRecord(SheetRepository.SHEETS.RESERVATION_RULES, recordData);
      }
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'RESERVATION_RULES_UPDATED',
      'ReservationRule',
      activeYear.AcademicYear,
      null,
      rulesArray,
      'Warden saved updated reservation percentages',
      'SUCCESS'
    );

    return true;
  }

  return {
    getReservationRules: getReservationRules,
    calculateSeatQuotas: calculateSeatQuotas,
    releaseReservedSeats: releaseReservedSeats,
    updateReservationRules: updateReservationRules,
    addReservationCategory: addReservationCategory,
    updateReservationCategory: updateReservationCategory,
    deleteReservationCategory: deleteReservationCategory
  };
})();
