/**
 * HOSTEL 360 - PriorityEngine.gs
 * Deterministic institutional priority tier assignment without academic merit.
 * Strictly adheres to university hostel priority hierarchy (Groups 1 to 6).
 */

var PriorityEngine = (function () {

  var PRIORITY_GROUPS = {
    GROUP_1: {
      code: 'GROUP_1',
      rank: 1,
      name: 'Specially-abled / PwD Students',
      description: 'Differently-abled students with valid verified PwD certification.'
    },
    GROUP_2: {
      code: 'GROUP_2',
      rank: 2,
      name: 'Outside Delhi (OD) - Outstation Residence',
      description: 'Students admitted under Outside Delhi category with permanent residence outside Delhi/NCR.'
    },
    GROUP_3: {
      code: 'GROUP_3',
      rank: 3,
      name: 'Delhi Category - Outstation Residence',
      description: 'Students admitted under Delhi category whose permanent residence is outside Delhi/NCR.'
    },
    GROUP_4: {
      code: 'GROUP_4',
      rank: 4,
      name: 'Delhi Category - Parents Posted Outside NCR',
      description: 'Delhi category students whose parents/guardians are posted/working outside Delhi/NCR.'
    },
    GROUP_5: {
      code: 'GROUP_5',
      rank: 5,
      name: 'Delhi/OD - NCR Residents',
      description: 'Delhi and Outside Delhi category students residing within Delhi-NCR boundaries.'
    },
    GROUP_6: {
      code: 'GROUP_6',
      rank: 6,
      name: 'Remaining Applicable Students',
      description: 'All other eligible students ordered by distance from Dwarka campus.'
    }
  };

  /**
   * Evaluates priority group for a student based on institutional rules
   *
   * @param {Object} student - Student record
   * @param {string} [academicYear] - Academic year context
   * @returns {Object} { code, rank, name, description }
   */
  function determinePriorityGroup(student, academicYear) {
    var rules = getPriorityRules(academicYear);
    var ruleMap = {};
    for (var r = 0; r < rules.length; r++) {
      ruleMap[String(rules[r].PriorityGroup).toUpperCase()] = rules[r];
    }

    var defaultGroup = PRIORITY_GROUPS.GROUP_6;
    var baseCode = 'GROUP_6';

    if (student) {
      var isPwD = student.IsPwD === true || student.IsPwD === 'true' || student.IsPwD === 'YES' || String(student.Category).toUpperCase() === 'PWD';
      var regionType = String(student.RegionType || student.AdmissionCategory || '').toUpperCase();
      var isNCRResident = student.IsDelhiNCRResident === true || student.IsDelhiNCRResident === 'true' || student.IsDelhiNCRResident === 'YES';
      var isParentOutsideNCR = student.IsParentPostedOutsideNCR === true || student.IsParentPostedOutsideNCR === 'true' || student.IsParentPostedOutsideNCR === 'YES';
      var isOD = regionType.indexOf('OUTSIDE') !== -1 || regionType === 'OD' || regionType === 'ALL_INDIA';

      if (isPwD) {
        baseCode = 'GROUP_1';
      } else if (isOD && !isNCRResident) {
        baseCode = 'GROUP_2';
      } else if (!isOD && !isNCRResident) {
        baseCode = 'GROUP_3';
      } else if (!isOD && isParentOutsideNCR) {
        baseCode = 'GROUP_4';
      } else if (isNCRResident) {
        baseCode = 'GROUP_5';
      } else {
        baseCode = 'GROUP_6';
      }
    }

    var dynamicRule = ruleMap[baseCode];
    if (dynamicRule) {
      return {
        code: baseCode,
        rank: parseInt(dynamicRule.OrderRank, 10) || (PRIORITY_GROUPS[baseCode] ? PRIORITY_GROUPS[baseCode].rank : 99),
        name: dynamicRule.GroupName || (PRIORITY_GROUPS[baseCode] ? PRIORITY_GROUPS[baseCode].name : baseCode),
        description: dynamicRule.Description || (PRIORITY_GROUPS[baseCode] ? PRIORITY_GROUPS[baseCode].description : '')
      };
    }

    return PRIORITY_GROUPS[baseCode] || defaultGroup;
  }

  /**
   * Retrieves priority group rules from PriorityRules sheet
   */
  function getPriorityRules(academicYear) {
    var rules = SheetRepository.findRecords(SheetRepository.SHEETS.PRIORITY_RULES, function (r) {
      var isAct = r.Status === 'ACTIVE' || r.Status === 'true' || r.Status === true;
      if (!academicYear) return isAct;
      return isAct && String(r.AcademicYear) === String(academicYear);
    });

    if (rules.length === 0) {
      return Object.keys(PRIORITY_GROUPS).map(function (k) {
        return {
          RuleID: 'PR_' + PRIORITY_GROUPS[k].rank,
          AcademicYear: academicYear || '2026-27',
          PriorityGroup: PRIORITY_GROUPS[k].code,
          GroupName: PRIORITY_GROUPS[k].name,
          Description: PRIORITY_GROUPS[k].description,
          OrderRank: PRIORITY_GROUPS[k].rank,
          Status: 'ACTIVE'
        };
      });
    }

    return rules.sort(function (a, b) { return (parseInt(a.OrderRank, 10) || 0) - (parseInt(b.OrderRank, 10) || 0); });
  }

  /**
   * Adds a new priority hierarchy tier
   */
  function addPriorityRule(priorityGroup, groupName, description, orderRank, wardenEmail, wardenUserId) {
    if (!priorityGroup || !groupName) {
      throw new Error('Priority Group Code and Group Name are required.');
    }
    var cleanCode = String(priorityGroup).trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var rank = parseInt(orderRank, 10) || 99;

    var ruleId = 'PR_' + cleanCode;
    var nowIso = new Date().toISOString();
    var record = {
      RuleID: ruleId,
      AcademicYear: activeYear.AcademicYear,
      PriorityGroup: cleanCode,
      GroupName: String(groupName).trim(),
      Description: description || '',
      OrderRank: rank,
      Status: 'ACTIVE',
      UpdatedAt: nowIso
    };

    var existing = SheetRepository.findRecords(SheetRepository.SHEETS.PRIORITY_RULES, function (r) {
      return (String(r.RuleID) === ruleId || String(r.PriorityGroup).toUpperCase() === cleanCode) &&
        String(r.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    if (existing) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', existing.RuleID, record);
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.PRIORITY_RULES, record);
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'PRIORITY_RULE_ADDED',
      'PriorityRule',
      ruleId,
      null,
      record,
      'Added Priority Tier: ' + cleanCode + ' (Rank ' + rank + ')',
      'SUCCESS'
    );

    return record;
  }

  /**
   * Updates an existing priority rule
   */
  function updatePriorityRule(ruleId, priorityGroup, groupName, description, orderRank, status, wardenEmail, wardenUserId) {
    if (!ruleId) throw new Error('Rule ID is required.');
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId);
    if (!existing) throw new Error('Priority rule not found: ' + ruleId);

    var nowIso = new Date().toISOString();
    var updated = {
      PriorityGroup: priorityGroup ? String(priorityGroup).toUpperCase() : existing.PriorityGroup,
      GroupName: groupName ? String(groupName).trim() : existing.GroupName,
      Description: description !== undefined ? description : existing.Description,
      OrderRank: orderRank !== undefined ? parseInt(orderRank, 10) : existing.OrderRank,
      Status: status || existing.Status || 'ACTIVE',
      UpdatedAt: nowIso
    };

    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId, updated);

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'PRIORITY_RULE_UPDATED',
      'PriorityRule',
      ruleId,
      existing,
      updated,
      'Updated Priority Rule ' + ruleId,
      'SUCCESS'
    );

    return updated;
  }

  /**
   * Deletes a priority hierarchy tier
   */
  function deletePriorityRule(ruleId, wardenEmail, wardenUserId) {
    if (!ruleId) throw new Error('Rule ID is required.');
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId);
    if (!existing) throw new Error('Priority rule not found: ' + ruleId);

    SheetRepository.deleteRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId);

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'PRIORITY_RULE_DELETED',
      'PriorityRule',
      ruleId,
      existing,
      null,
      'Deleted Priority Tier ' + existing.PriorityGroup,
      'SUCCESS'
    );

    return { ruleId: ruleId, priorityGroup: existing.PriorityGroup, deleted: true };
  }

  /**
   * Batch updates / reorders priority rules
   */
  function savePriorityRules(rulesArray, wardenEmail, wardenUserId) {
    if (!Array.isArray(rulesArray) || rulesArray.length === 0) {
      throw new Error('Array of priority rules is required.');
    }

    var activeYear = PolicyEngine.getActiveAcademicYear();
    var nowIso = new Date().toISOString();

    for (var i = 0; i < rulesArray.length; i++) {
      var item = rulesArray[i];
      var pGroup = String(item.PriorityGroup || '').toUpperCase();
      var ruleId = item.RuleID || ('PR_' + pGroup);
      var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId);

      var recordData = {
        RuleID: ruleId,
        AcademicYear: activeYear.AcademicYear,
        PriorityGroup: pGroup,
        GroupName: String(item.GroupName || pGroup).trim(),
        Description: item.Description || '',
        OrderRank: parseInt(item.OrderRank, 10) || (i + 1),
        Status: item.Status || 'ACTIVE',
        UpdatedAt: nowIso
      };

      if (existing) {
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.PRIORITY_RULES, 'RuleID', ruleId, recordData);
      } else {
        SheetRepository.insertRecord(SheetRepository.SHEETS.PRIORITY_RULES, recordData);
      }
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'PRIORITY_RULES_REORDERED',
      'PriorityRule',
      activeYear.AcademicYear,
      null,
      rulesArray,
      'Warden saved priority hierarchy reordering',
      'SUCCESS'
    );

    return true;
  }

  return {
    PRIORITY_GROUPS: PRIORITY_GROUPS,
    determinePriorityGroup: determinePriorityGroup,
    getPriorityRules: getPriorityRules,
    addPriorityRule: addPriorityRule,
    updatePriorityRule: updatePriorityRule,
    deletePriorityRule: deletePriorityRule,
    savePriorityRules: savePriorityRules
  };
})();
