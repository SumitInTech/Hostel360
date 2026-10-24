/**
 * HOSTEL 360 - AnalyticsService.gs
 * Real-time factual analytics and institutional fairness & transparency metrics.
 * No predictive or speculative algorithms.
 */

var AnalyticsService = (function () {

  /**
   * Generates student-specific factual analytics and progress indicators
   */
  function getStudentAnalytics(studentId) {
    if (!studentId) return null;

    var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId);
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var application = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    var documents = DocumentService.getStudentDocuments(studentId);
    var requiredDocs = PolicyEngine.getRequiredDocumentsForStudent ? PolicyEngine.getRequiredDocumentsForStudent(student) : PolicyEngine.getMandatoryDocuments();
    var mandatoryDocs = requiredDocs;
    var payments = PaymentService.getStudentPayments(studentId);
    var allAllocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    });
    var publishedAllocation = allAllocations.filter(function (a) { return a.Status === 'PUBLISHED' || a.Status === 'LOCKED'; })[0];
    var draftAllocation = allAllocations.filter(function (a) { return a.Status === 'DRAFT' || a.Status === 'REVIEW'; })[0];

    var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return String(w.StudentID) === String(studentId) && String(w.AcademicYear) === String(activeYear.AcademicYear) && w.Status === 'ACTIVE';
    })[0];

    // Compute Document Completion based on category-specific requirements
    var docMap = {};
    var uploadedTypes = {};
    var verifiedCount = 0;
    var pendingCount = 0;
    var rejectedCount = 0;

    for (var d = 0; d < documents.length; d++) {
      var doc = documents[d];
      var dtype = String(doc.DocumentType).trim();
      uploadedTypes[dtype] = true;
      docMap[dtype] = doc;
      var st = String(doc.VerificationStatus).toUpperCase();
      if (st === 'VERIFIED') verifiedCount++;
      else if (st === 'PENDING') pendingCount++;
      else if (st === 'REJECTED') rejectedCount++;
    }

    var requiredUploadedCount = 0;
    var requiredVerifiedCount = 0;
    for (var m = 0; m < requiredDocs.length; m++) {
      var rType = requiredDocs[m];
      if (uploadedTypes[rType]) requiredUploadedCount++;
      var docItem = docMap[rType];
      if (docItem && String(docItem.VerificationStatus).toUpperCase() === 'VERIFIED') {
        requiredVerifiedCount++;
      }
    }

    var docCompletionPct = requiredDocs.length > 0 ? Math.round((requiredUploadedCount / requiredDocs.length) * 100) : 100;
    var allRequiredDocsVerified = (requiredDocs.length > 0 && requiredVerifiedCount === requiredDocs.length && rejectedCount === 0);

    // Compute Profile & Application Completion
    var appCompletionPct = 0;
    if (student) appCompletionPct += 40;
    if (application) appCompletionPct += 30;
    if (docCompletionPct === 100) appCompletionPct += 30;

    // Determine Timeline Step (1 to 8):
    // 1: Submitted (Initial application state)
    // 2: Eligibility Check (Applicant eligibility in review)
    // 3: Document Verification (Awaiting document audit by Warden)
    // 4: Allocation Processing (All documents verified! Step 3 completed with green checkmark ✓)
    // 5: Warden Review (Draft matrix under review)
    // 6: Allocation Published (Allotments finalized)
    // 7: Fee Payment (Deposit & DD transaction submission active)
    // 8: Physical Registration & Key Handover (Fee verified, offline check-in pending)
    // 9: Registration & Room Possession Complete (All 8 stages finished with green checkmarks ✓)
    var timelineStep = 1;
    if (application) {
      timelineStep = 1;
      if (application.EligibilityStatus === 'ELIGIBLE' || application.Status === 'SUBMITTED' || application.Status === 'VERIFIED') {
        timelineStep = 2;
        if (application.EligibilityStatus === 'ELIGIBLE') {
          // Documents under review by Warden
          timelineStep = 3;
          // When all category-required documents are audited and marked VERIFIED, Step 3 is completed!
          if (allRequiredDocsVerified) {
            timelineStep = 4; // Step 1, 2, 3 show green checkmarks (✓), Step 4 Allocation is active!
          }
        }
      }
      if (draftAllocation) {
        timelineStep = (draftAllocation.Status === 'REVIEW') ? 5 : 4;
      }
      if (publishedAllocation) {
        var hasVerifiedPayment = payments.some(function (p) { return p.Status === 'VERIFIED'; });
        var isRegistrationComplete = (publishedAllocation.RegistrationStatus === 'COMPLETED' || (application && application.RegistrationStatus === 'COMPLETED'));

        if (isRegistrationComplete) {
          timelineStep = 9; // All 8 stages finished!
        } else if (hasVerifiedPayment) {
          timelineStep = 8; // Fee verified -> Stage 8 active (Offline physical registration / key handover pending)
        } else {
          timelineStep = 7; // Room Published -> Stage 7 active (Fee payment required)
        }
      }
    }

    // Hostel availability in preferred hostels
    var prefAvailability = [];
    if (application) {
      var allRooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
      var allHostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
      var hostelMap = {};
      for (var h = 0; h < allHostels.length; h++) {
        hostelMap[allHostels[h].HostelID] = allHostels[h];
      }

      var checkPrefs = [application.FirstHostelPref, application.SecondHostelPref].filter(Boolean);
      for (var p = 0; p < checkPrefs.length; p++) {
        var hId = checkPrefs[p];
        var hostelObj = hostelMap[hId];
        if (hostelObj) {
          var availCount = allRooms.filter(function (r) {
            return r.HostelID === hId && String(r.OccupancyStatus).toUpperCase() === 'AVAILABLE' && (r.Status === 'ACTIVE' || r.Status === 'true' || r.Status === true);
          }).length;
          var totalCount = allRooms.filter(function (r) { return r.HostelID === hId; }).length;
          prefAvailability.push({
            hostelId: hId,
            hostelName: hostelObj.Name,
            code: hostelObj.Code,
            availableRooms: availCount,
            totalRooms: totalCount,
            preferenceOrder: p + 1
          });
        }
      }
    }

    return {
      studentId: studentId,
      academicYear: activeYear.AcademicYear,
      appCompletionPct: appCompletionPct,
      docCompletionPct: docCompletionPct,
      timelineStep: timelineStep,
      documentStats: {
        totalMandatory: requiredDocs.length,
        requiredDocs: requiredDocs,
        uploadedCount: Object.keys(uploadedTypes).length,
        verifiedCount: verifiedCount,
        requiredVerifiedCount: requiredVerifiedCount,
        allRequiredDocsVerified: allRequiredDocsVerified,
        pendingCount: pendingCount,
        rejectedCount: rejectedCount
      },
      preferenceAvailability: prefAvailability,
      hasAllocation: !!publishedAllocation,
      isWaitlisted: !!waitlist,
      paymentStatus: payments.length > 0 ? payments[payments.length - 1].Status : 'PENDING'
    };
  }

  /**
   * Generates comprehensive institutional administrative analytics for Warden
   */
  function getWardenAnalytics(academicYear) {
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;

    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var applications = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return a.AcademicYear === yearStr;
    });
    var allocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr;
    });
    var publishedAllocations = allocations.filter(function (a) { return a.Status === 'PUBLISHED'; });
    var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
    });
    var hostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var rooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
    var documents = SheetRepository.getAllRecords(SheetRepository.SHEETS.DOCUMENTS);

    var studentMap = {};
    for (var s = 0; s < students.length; s++) {
      studentMap[students[s].StudentID] = students[s];
    }

    // KPI Aggregations
    var totalStudents = students.length;
    var totalApplications = applications.length;
    var eligibleCount = applications.filter(function (a) { return a.EligibilityStatus === 'ELIGIBLE'; }).length;
    var ineligibleCount = applications.filter(function (a) { return a.EligibilityStatus === 'INELIGIBLE'; }).length;
    var pendingEligCount = applications.filter(function (a) { return !a.EligibilityStatus || a.EligibilityStatus === 'PENDING'; }).length;
    var pendingDocsCount = documents.filter(function (d) { return d.VerificationStatus === 'PENDING'; }).length;

    var totalRooms = rooms.length;
    var availableRooms = rooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'AVAILABLE'; }).length;
    var occupiedRooms = rooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'OCCUPIED'; }).length;
    var maintenanceRooms = rooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'MAINTENANCE'; }).length;
    var occupancyRate = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

    // Gender Split (Applicants)
    var genderSplit = { BOYS: 0, GIRLS: 0 };
    for (var i = 0; i < applications.length; i++) {
      var st = studentMap[applications[i].StudentID];
      if (st) {
        var g = String(st.Gender).toUpperCase();
        if (g === 'MALE') genderSplit.BOYS++;
        else if (g === 'FEMALE') genderSplit.GIRLS++;
      }
    }

    // Category Distribution
    var categoryDistribution = {};
    for (var c = 0; c < applications.length; c++) {
      var stCat = studentMap[applications[c].StudentID];
      var catName = stCat ? String(stCat.Category || 'GENERAL').toUpperCase() : 'GENERAL';
      categoryDistribution[catName] = (categoryDistribution[catName] || 0) + 1;
    }

    // Programme Distribution
    var programmeDistribution = {};
    for (var p = 0; p < applications.length; p++) {
      var stPrg = studentMap[applications[p].StudentID];
      var prgName = (stPrg && stPrg.Programme) ? stPrg.Programme : 'Other';
      programmeDistribution[prgName] = (programmeDistribution[prgName] || 0) + 1;
    }

    // Priority Group Breakdown (Allocated vs Waitlisted)
    var priorityGroupStats = {};
    for (var pg = 1; pg <= 6; pg++) {
      var groupKey = 'GROUP_' + pg;
      priorityGroupStats[groupKey] = {
        allocated: allocations.filter(function (a) { return a.PriorityGroup === groupKey; }).length,
        waitlisted: waitlist.filter(function (w) { return w.PriorityGroup === groupKey; }).length
      };
    }

    // Hostel Occupancy Breakdown
    var hostelStats = [];
    for (var h = 0; h < hostels.length; h++) {
      var hostel = hostels[h];
      var hRooms = rooms.filter(function (r) { return r.HostelID === hostel.HostelID; });
      var hTotal = hRooms.length;
      var hOccupied = hRooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'OCCUPIED'; }).length;
      var hAvailable = hRooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'AVAILABLE'; }).length;

      hostelStats.push({
        hostelId: hostel.HostelID,
        name: hostel.Name,
        code: hostel.Code,
        gender: hostel.Gender,
        totalRooms: hTotal,
        occupiedRooms: hOccupied,
        availableRooms: hAvailable,
        occupancyRate: hTotal > 0 ? Math.round((hOccupied / hTotal) * 100) : 0
      });
    }

    // Fairness & Transparency Metrics
    var manualOverridesCount = allocations.filter(function (a) { return a.IsManualOverride === true || a.IsManualOverride === 'TRUE' || a.IsManualOverride === 'true'; }).length;
    var foreignStudentsAllocated = allocations.filter(function (a) { return a.ReservationCategory === 'FOREIGN'; }).length;

    // Preference Satisfaction Rate
    var pref1Count = 0;
    var pref2Count = 0;
    var noPrefCount = 0;

    for (var al = 0; al < allocations.length; al++) {
      var allocObj = allocations[al];
      var appObj = SheetRepository.findRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', allocObj.ApplicationID);
      if (appObj) {
        if (appObj.FirstHostelPref === allocObj.HostelID) pref1Count++;
        else if (appObj.SecondHostelPref === allocObj.HostelID) pref2Count++;
        else noPrefCount++;
      }
    }

    return {
      academicYear: yearStr,
      kpis: {
        totalStudents: totalStudents,
        totalApplications: totalApplications,
        eligibleCount: eligibleCount,
        ineligibleCount: ineligibleCount,
        pendingEligCount: pendingEligCount,
        pendingDocsCount: pendingDocsCount,
        totalAllocated: allocations.length,
        publishedAllocated: publishedAllocations.length,
        waitlistCount: waitlist.length,
        totalRooms: totalRooms,
        availableRooms: availableRooms,
        occupiedRooms: occupiedRooms,
        maintenanceRooms: maintenanceRooms,
        occupancyRate: occupancyRate
      },
      genderSplit: genderSplit,
      categoryDistribution: categoryDistribution,
      programmeDistribution: programmeDistribution,
      priorityGroupStats: priorityGroupStats,
      hostelStats: hostelStats,
      fairness: {
        manualOverridesCount: manualOverridesCount,
        foreignStudentsAllocated: foreignStudentsAllocated,
        preferenceSatisfaction: {
          preference1Count: pref1Count,
          preference2Count: pref2Count,
          noPreferenceCount: noPrefCount,
          totalAllocations: allocations.length,
          pref1Percentage: allocations.length > 0 ? Math.round((pref1Count / allocations.length) * 100) : 0
        }
      }
    };
  }

  return {
    getStudentAnalytics: getStudentAnalytics,
    getWardenAnalytics: getWardenAnalytics
  };
})();
