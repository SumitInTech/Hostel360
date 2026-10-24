/**
 * HOSTEL 360 - PolicyEngine.gs
 * Institutional policies, application window deadline enforcement, and academic years.
 */

var PolicyEngine = (function () {

  /**
   * Retrieves the currently active Academic Year
   */
  function getActiveAcademicYear() {
    var years = SheetRepository.findRecords(SheetRepository.SHEETS.ACADEMIC_YEARS, function (y) {
      return y.IsActive === true || y.IsActive === 'TRUE' || y.IsActive === 'true' || y.IsActive === 1;
    });
    if (years.length > 0) {
      return years[0];
    }
    // Fallback if no active year flagged
    var allYears = SheetRepository.getAllRecords(SheetRepository.SHEETS.ACADEMIC_YEARS);
    if (allYears.length > 0) {
      return allYears[allYears.length - 1];
    }
    return {
      YearID: 'AY_DEFAULT',
      AcademicYear: '2026-27',
      ApplicationStartDate: '2026-08-01',
      ApplicationDeadline: '2026-09-30',
      IsActive: true,
      Status: 'ACTIVE'
    };
  }

  /**
   * Validates if the application window is currently open
   */
  function isApplicationWindowOpen() {
    var activeYear = getActiveAcademicYear();
    if (!activeYear) return { isOpen: false, reason: 'No active academic year configured.' };

    var now = new Date().getTime();
    var startDate = activeYear.ApplicationStartDate ? new Date(activeYear.ApplicationStartDate).getTime() : null;
    var deadlineDate = activeYear.ApplicationDeadline ? new Date(activeYear.ApplicationDeadline).getTime() : null;

    // Extend deadline to end of day (23:59:59)
    if (deadlineDate) {
      var d = new Date(activeYear.ApplicationDeadline);
      d.setHours(23, 59, 59, 999);
      deadlineDate = d.getTime();
    }

    if (startDate && now < startDate) {
      return {
        isOpen: false,
        reason: 'Application portal opens on ' + activeYear.ApplicationStartDate
      };
    }

    if (deadlineDate && now > deadlineDate) {
      return {
        isOpen: false,
        reason: 'Application deadline passed on ' + activeYear.ApplicationDeadline
      };
    }

    return {
      isOpen: true,
      academicYear: activeYear.AcademicYear,
      deadline: activeYear.ApplicationDeadline
    };
  }

  /**
   * Retrieves a policy value by key with fallback
   */
  function getPolicyValue(key, defaultValue) {
    var policy = SheetRepository.findRecordByKey(SheetRepository.SHEETS.POLICIES, 'PolicyKey', key);
    if (policy && policy.PolicyValue !== undefined && policy.PolicyValue !== '') {
      return policy.PolicyValue;
    }
    return defaultValue;
  }

  /**
   * Updates or inserts a policy configuration
   */
  function setPolicyValue(key, value, description, userEmail) {
    var activeYear = getActiveAcademicYear();
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.POLICIES, 'PolicyKey', key);
    var nowIso = new Date().toISOString();

    if (existing) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.POLICIES, 'PolicyKey', key, {
        PolicyValue: value,
        Description: description || existing.Description,
        UpdatedAt: nowIso,
        UpdatedBy: userEmail || 'Warden'
      });
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.POLICIES, {
        PolicyID: 'POL_' + Utilities.getUuid().substring(0, 8).toUpperCase(),
        AcademicYear: activeYear ? activeYear.AcademicYear : '2026-27',
        PolicyKey: key,
        PolicyValue: value,
        Description: description || '',
        UpdatedAt: nowIso,
        UpdatedBy: userEmail || 'Warden'
      });
    }

    AuditService.logAction(
      userEmail,
      userEmail,
      'WARDEN',
      'POLICY_UPDATED',
      'Policy',
      key,
      existing ? existing.PolicyValue : null,
      value,
      'Updated policy: ' + key,
      'SUCCESS'
    );

    return true;
  }

  /**
   * Official Hostel Admission Brochure Document Specifications & Category Mapping
   */
  var DOCUMENT_DEFINITIONS = {
    ADMISSION_FEE_RECEIPT: {
      key: 'ADMISSION_FEE_RECEIPT',
      label: 'ADMISSION FEE RECEIPT',
      category: 'ALL',
      description: 'Proof of university admission / academic fee receipt for current academic year.'
    },
    MEDICAL_FITNESS: {
      key: 'MEDICAL_FITNESS',
      label: 'MEDICAL FITNESS',
      category: 'ALL',
      description: 'Medical fitness certificate issued and signed by a Registered Medical Practitioner (MBBS).'
    },
    PERMANENT_ADDRESS_PROOF: {
      key: 'PERMANENT_ADDRESS_PROOF',
      label: 'PERMANENT ADDRESS PROOF',
      category: 'ALL',
      description: 'Proof of permanent residence outside Delhi-NCR (Domicile / Electricity Bill / Aadhaar / Passport).'
    },
    PARENT_UNDERTAKING: {
      key: 'PARENT_UNDERTAKING',
      label: 'PARENT UNDERTAKING',
      category: 'ALL',
      description: 'Signed undertaking from parent/guardian agreeing to hostel rules & anti-ragging policies.'
    },
    STUDENT_UNDERTAKING: {
      key: 'STUDENT_UNDERTAKING',
      label: 'STUDENT UNDERTAKING',
      category: 'ALL',
      description: 'Signed anti-ragging & hostel discipline code of conduct undertaking by the student.'
    },
    SC_CERTIFICATE: {
      key: 'SC_CERTIFICATE',
      label: 'SC CASTE CERTIFICATE',
      category: 'SC',
      description: 'Official Scheduled Caste certificate issued by competent authority (SDM / Tehsildar).'
    },
    ST_CERTIFICATE: {
      key: 'ST_CERTIFICATE',
      label: 'ST TRIBE CERTIFICATE',
      category: 'ST',
      description: 'Official Scheduled Tribe certificate issued by competent authority (SDM / Tehsildar).'
    },
    OBC_NCL_CERTIFICATE: {
      key: 'OBC_NCL_CERTIFICATE',
      label: 'OBC NCL CERTIFICATE',
      category: 'OBC',
      description: 'OBC Non-Creamy Layer certificate issued for the current financial year.'
    },
    EWS_CERTIFICATE: {
      key: 'EWS_CERTIFICATE',
      label: 'EWS INCOME & ASSET CERTIFICATE',
      category: 'EWS',
      description: 'Economically Weaker Section (EWS) certificate issued by authorized revenue officer.'
    },
    PWD_CERTIFICATE: {
      key: 'PWD_CERTIFICATE',
      label: 'PWD CERTIFICATE',
      category: 'PWD',
      description: 'Medical certificate of permanent disability (min. 40%) issued by a Government Medical Board.'
    },
    PASSPORT_AND_VISA: {
      key: 'PASSPORT_AND_VISA',
      label: 'PASSPORT & VISA',
      category: 'FOREIGN',
      description: 'Valid international passport, valid Indian student visa and FRRO registration certificate.'
    },
    PARENT_POSTING_CERTIFICATE: {
      key: 'PARENT_POSTING_CERTIFICATE',
      label: 'PARENT POSTING OUTSIDE NCR',
      category: 'GROUP_4',
      description: 'Official posting/transfer letter certifying parent is posted outside Delhi-NCR (Priority Group 4).'
    }
  };

  /**
   * Retrieves specific list of required documents for a student strictly as per Hostel Brochure
   * based on category, disability status, nationality, and parent posting.
   */
  function getRequiredDocumentsForStudent(student) {
    var docs = [
      'ADMISSION_FEE_RECEIPT',
      'MEDICAL_FITNESS',
      'PERMANENT_ADDRESS_PROOF',
      'PARENT_UNDERTAKING',
      'STUDENT_UNDERTAKING'
    ];
    if (!student) return docs;

    var cat = String(student.Category || '').toUpperCase().trim();
    var isPwd = student.IsPwD === true || student.IsPwD === 'true' || student.IsPwD === 'YES' || cat === 'PWD';
    var isForeign = cat === 'FOREIGN' || (student.Nationality && String(student.Nationality).toUpperCase().trim() !== 'INDIAN');
    var isParentOutside = student.IsParentPostedOutsideNCR === true || student.IsParentPostedOutsideNCR === 'true' || student.IsParentPostedOutsideNCR === 'YES';

    if (isPwd && docs.indexOf('PWD_CERTIFICATE') === -1) {
      docs.push('PWD_CERTIFICATE');
    }
    if (cat === 'SC' && docs.indexOf('SC_CERTIFICATE') === -1) {
      docs.push('SC_CERTIFICATE');
    }
    if (cat === 'ST' && docs.indexOf('ST_CERTIFICATE') === -1) {
      docs.push('ST_CERTIFICATE');
    }
    if (cat === 'OBC' && docs.indexOf('OBC_NCL_CERTIFICATE') === -1) {
      docs.push('OBC_NCL_CERTIFICATE');
    }
    if (cat === 'EWS' && docs.indexOf('EWS_CERTIFICATE') === -1) {
      docs.push('EWS_CERTIFICATE');
    }
    if (isForeign && docs.indexOf('PASSPORT_AND_VISA') === -1) {
      docs.push('PASSPORT_AND_VISA');
    }
    if (isParentOutside && docs.indexOf('PARENT_POSTING_CERTIFICATE') === -1) {
      docs.push('PARENT_POSTING_CERTIFICATE');
    }

    return docs;
  }

  /**
   * Gets list of universal baseline mandatory document types
   */
  function getMandatoryDocuments() {
    return [
      'ADMISSION_FEE_RECEIPT',
      'MEDICAL_FITNESS',
      'PERMANENT_ADDRESS_PROOF',
      'PARENT_UNDERTAKING',
      'STUDENT_UNDERTAKING'
    ];
  }

  /**
   * Gets definitions dictionary
   */
  function getDocumentDefinitions() {
    return DOCUMENT_DEFINITIONS;
  }

  /**
   * Gets fee payment and reporting deadline in days from allotment publication
   */
  function getFeePaymentDeadlineDays() {
    var raw = getPolicyValue('FEE_PAYMENT_DEADLINE_DAYS', 3);
    return parseInt(raw, 10) || 3;
  }

  /**
   * Gets foreign student quota percentage
   */
  function getForeignStudentQuotaPct() {
    var raw = getPolicyValue('FOREIGN_STUDENT_QUOTA_PCT', 5);
    return parseFloat(raw) || 5;
  }

  return {
    getActiveAcademicYear: getActiveAcademicYear,
    isApplicationWindowOpen: isApplicationWindowOpen,
    getPolicyValue: getPolicyValue,
    setPolicyValue: setPolicyValue,
    getMandatoryDocuments: getMandatoryDocuments,
    getRequiredDocumentsForStudent: getRequiredDocumentsForStudent,
    getDocumentDefinitions: getDocumentDefinitions,
    getForeignStudentQuotaPct: getForeignStudentQuotaPct,
    getFeePaymentDeadlineDays: getFeePaymentDeadlineDays
  };
})();
