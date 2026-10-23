/**
 * HOSTEL 360 - EligibilityEngine.gs
 * Strict rule-based evaluation of student application eligibility.
 * Ensures only verified, compliant students proceed to allocation.
 */

var EligibilityEngine = (function () {

  /**
   * Evaluates an application for hostel eligibility
   *
   * @param {Object} student - Student record
   * @param {Object} application - Application record
   * @param {Array} documents - Array of document records for the student
   * @returns {Object} { isEligible: boolean, status: 'ELIGIBLE'|'INELIGIBLE', reasons: string[] }
   */
  function evaluateEligibility(student, application, documents) {
    var reasons = [];
    var isEligible = true;

    if (!student) {
      return { isEligible: false, status: 'INELIGIBLE', reasons: ['Student profile not found.'] };
    }

    if (!application) {
      return { isEligible: false, status: 'INELIGIBLE', reasons: ['Application record not found.'] };
    }

    // 1. Check Student User Status
    var userRecord = SheetRepository.findRecordByKey(SheetRepository.SHEETS.USERS, 'StudentID', student.StudentID);
    if (userRecord && String(userRecord.Status).toUpperCase() !== 'ACTIVE') {
      isEligible = false;
      reasons.push('Student user account is inactive or suspended.');
    }

    // 2. Academic Year Matching
    var activeYear = PolicyEngine.getActiveAcademicYear();
    if (activeYear && application.AcademicYear && String(application.AcademicYear) !== String(activeYear.AcademicYear)) {
      isEligible = false;
      reasons.push('Application academic year (' + application.AcademicYear + ') does not match active year (' + activeYear.AcademicYear + ').');
    }

    // 3. Gender Requirement
    var gender = String(student.Gender || '').toUpperCase();
    if (gender !== 'MALE' && gender !== 'FEMALE') {
      isEligible = false;
      reasons.push('Valid gender must be specified (MALE/FEMALE).');
    }

    // 4. Hostels Availability for Gender
    var activeHostels = SheetRepository.findRecords(SheetRepository.SHEETS.HOSTELS, function (h) {
      return (h.Status === 'ACTIVE' || h.Status === 'true' || h.Status === true) &&
        String(h.Gender).toUpperCase() === (gender === 'MALE' ? 'BOYS' : 'GIRLS');
    });

    if (activeHostels.length === 0) {
      isEligible = false;
      reasons.push('No active ' + (gender === 'MALE' ? 'Boys' : 'Girls') + ' hostels configured.');
    }

    // 5. Category-Specific Mandatory Documents Check (Brochure Compliance)
    var requiredDocs = PolicyEngine.getRequiredDocumentsForStudent ? PolicyEngine.getRequiredDocumentsForStudent(student) : PolicyEngine.getMandatoryDocuments();
    var docs = documents || DocumentService.getStudentDocuments(student.StudentID);
    var uploadedDocTypes = {};
    var verifiedDocTypes = {};
    var rejectedDocTypes = {};

    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var type = String(d.DocumentType).trim();
      uploadedDocTypes[type] = true;
      if (String(d.VerificationStatus).toUpperCase() === 'VERIFIED') {
        verifiedDocTypes[type] = true;
      }
      if (String(d.VerificationStatus).toUpperCase() === 'REJECTED') {
        rejectedDocTypes[type] = true;
      }
    }

    // Check PwD Document if claimed
    var isPwD = student.IsPwD === true || student.IsPwD === 'true' || student.IsPwD === 'YES' || String(student.Category).toUpperCase() === 'PWD';
    if (isPwD) {
      if (!uploadedDocTypes['PWD_CERTIFICATE']) {
        isEligible = false;
        reasons.push('PwD certificate is required for specially-abled quota claim.');
      } else if (rejectedDocTypes['PWD_CERTIFICATE']) {
        isEligible = false;
        reasons.push('Uploaded PwD certificate was rejected during verification.');
      }
    }

    // Check Rejected Mandatory Category Documents
    for (var m = 0; m < requiredDocs.length; m++) {
      var mType = requiredDocs[m];
      if (rejectedDocTypes[mType]) {
        isEligible = false;
        reasons.push('Required document "' + mType.replace(/_/g, ' ') + '" was rejected during warden verification.');
      }
    }

    // 6. Application Integrity
    if (!student.EnrollmentNo || !student.Programme || !student.PermanentAddress) {
      isEligible = false;
      reasons.push('Mandatory personal, academic, and permanent address details are incomplete.');
    }

    var status = isEligible ? 'ELIGIBLE' : 'INELIGIBLE';
    return {
      isEligible: isEligible,
      status: status,
      reasons: reasons
    };
  }

  /**
   * Re-evaluates all submitted applications for the current academic year and updates sheet in a single batch operation
   */
  function evaluateAllApplications() {
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var apps = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return a.AcademicYear === activeYear.AcademicYear;
    });

    var allStudents = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var studentsMap = {};
    for (var s = 0; s < allStudents.length; s++) {
      studentsMap[allStudents[s].StudentID] = allStudents[s];
    }

    var allDocs = SheetRepository.getAllRecords(SheetRepository.SHEETS.DOCUMENTS);
    var docsMap = {};
    for (var d = 0; d < allDocs.length; d++) {
      var sId = allDocs[d].StudentID;
      if (!docsMap[sId]) docsMap[sId] = [];
      docsMap[sId].push(allDocs[d]);
    }

    var results = [];
    var updatesMap = {};

    for (var i = 0; i < apps.length; i++) {
      var app = apps[i];
      var student = studentsMap[app.StudentID];
      var docs = docsMap[app.StudentID] || [];
      var evalResult = evaluateEligibility(student, app, docs);

      var remarks = evalResult.reasons.join('; ');
      updatesMap[app.ApplicationID] = {
        EligibilityStatus: evalResult.status,
        EligibilityRemarks: remarks
      };

      results.push({
        applicationId: app.ApplicationID,
        studentId: app.StudentID,
        status: evalResult.status,
        reasons: evalResult.reasons
      });
    }

    // Apply all updates in a single in-memory batch write
    SheetRepository.bulkUpdateRecords(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', updatesMap);

    return results;
  }

  return {
    evaluateEligibility: evaluateEligibility,
    evaluateAllApplications: evaluateAllApplications
  };
})();
