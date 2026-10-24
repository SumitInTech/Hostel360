/**
 * HOSTEL 360 - Smart Hostel Allocation Management System
 * Code.gs - Main Web App router, HTML template includer, and secure server-side API handlers.
 */

/**
 * Web App HTTP GET handler
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  return template.evaluate()
    .setTitle('HOSTEL 360 | Smart Hostel Allocation Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * HTML partial includer for modular templating
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Helper to wrap API responses safely
 */
function apiResponse(actionFn) {
  try {
    var result = actionFn();
    var safeData = (result !== undefined && result !== null)
      ? JSON.parse(JSON.stringify(result))
      : result;

    return {
      success: true,
      data: safeData,
      error: null
    };
  } catch (err) {
    Logger.log('API Error: ' + err.message + (err.stack ? '\n' + err.stack : ''));
    return {
      success: false,
      data: null,
      error: err.message || 'An unexpected error occurred. Please try again.'
    };
  }
}

// ============================================================
// AUTHENTICATION & SESSION APIS
// ============================================================

function apiLogin(email, password) {
  return apiResponse(function () {
    return AuthService.authenticate(email, password);
  });
}

function apiLogout(token) {
  return apiResponse(function () {
    if (token) {
      var session = SessionService.getSession(token);
      if (session) {
        AuditService.logAction(
          session.userId,
          session.email,
          session.role,
          'LOGOUT',
          'User',
          session.userId,
          null,
          null,
          'User logged out',
          'SUCCESS'
        );
      }
      SessionService.destroySession(token);
    }
    return { loggedOut: true };
  });
}

function apiVerifySession(token) {
  return apiResponse(function () {
    var session = AuthService.validateSession(token);
    if (!session) {
      throw new Error('Session is invalid or has expired.');
    }
    return session;
  });
}

function apiGetSessionUser(token) {
  return apiResponse(function () {
    var session = AuthService.requireAuth(token);
    var userRecord = SheetRepository.findRecordByKey(SheetRepository.SHEETS.USERS, 'UserID', session.userId);
    return {
      userId: session.userId,
      email: session.email,
      role: session.role,
      studentId: session.studentId,
      name: session.name || (userRecord ? userRecord.Name : '')
    };
  });
}

// ============================================================
// STUDENT PORTAL APIS
// ============================================================

function apiGetStudentDashboard(token) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'STUDENT');
    var studentId = session.studentId;

    if (!studentId) {
      throw new Error('No student record associated with this account.');
    }

    var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId);
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var windowStatus = PolicyEngine.isApplicationWindowOpen();

    var application = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    })[0] || null;

    var documents = DocumentService.getStudentDocuments(studentId);
    var payments = PaymentService.getStudentPayments(studentId);

    // Allocations: only reveal if PUBLISHED
    var allocation = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (al) {
      return String(al.StudentID) === String(studentId) && String(al.AcademicYear) === String(activeYear.AcademicYear) && al.Status === 'PUBLISHED';
    })[0] || null;

    var allocatedHostel = null;
    var allocatedRoom = null;
    if (allocation) {
      allocatedHostel = SheetRepository.findRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', allocation.HostelID);
      allocatedRoom = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', allocation.RoomID);
    }

    var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return String(w.StudentID) === String(studentId) && String(w.AcademicYear) === String(activeYear.AcademicYear) && w.Status === 'ACTIVE';
    })[0] || null;

    var allHostels = SheetRepository.findRecords(SheetRepository.SHEETS.HOSTELS, function (h) {
      return h.Status === 'ACTIVE' || h.Status === 'true' || h.Status === true;
    });

    var analytics = AnalyticsService.getStudentAnalytics(studentId);
    var requiredDocs = PolicyEngine.getRequiredDocumentsForStudent ? PolicyEngine.getRequiredDocumentsForStudent(student) : PolicyEngine.getMandatoryDocuments();
    var feeAmount = PolicyEngine.getPolicyValue('HOSTEL_FEE_AMOUNT', 35000);

    var allocData = null;
    if (allocation) {
      var deadlineDays = PolicyEngine.getFeePaymentDeadlineDays();
      var allocExpiry = allocation.ExpiryDate || (allocation.PublishedAt ? new Date(new Date(allocation.PublishedAt).getTime() + (deadlineDays * 24 * 60 * 60 * 1000)).toISOString() : null);
      var nowMs = new Date().getTime();
      var expiryMs = allocExpiry ? new Date(allocExpiry).getTime() : null;
      var isOverdue = expiryMs ? (nowMs > expiryMs) : false;
      var hoursRemaining = expiryMs ? Math.max(0, Math.round((expiryMs - nowMs) / (1000 * 60 * 60))) : 0;
      var daysRemaining = Math.ceil(hoursRemaining / 24);

      allocData = {
        allocationId: allocation.AllocationID,
        hostelName: allocatedHostel ? allocatedHostel.Name : '',
        hostelCode: allocatedHostel ? allocatedHostel.Code : '',
        roomNumber: allocatedRoom ? allocatedRoom.RoomNumber : '',
        floorNumber: allocatedRoom ? allocatedRoom.FloorNumber : '',
        allocatedDate: allocation.AllocatedDate,
        priorityGroup: allocation.PriorityGroup,
        explanation: allocation.Explanation,
        status: allocation.Status,
        registrationStatus: allocation.RegistrationStatus || (application ? application.RegistrationStatus : 'PENDING') || 'PENDING',
        expiryDate: allocExpiry,
        isOverdue: isOverdue,
        hoursRemaining: hoursRemaining,
        daysRemaining: daysRemaining
      };
    }

    return {
      student: student,
      academicYear: activeYear,
      windowStatus: windowStatus,
      application: application,
      documents: documents,
      mandatoryDocs: requiredDocs,
      requiredDocs: requiredDocs,
      payments: payments,
      feeAmount: feeAmount,
      allocation: allocData,
      waitlist: waitlist ? {
        waitlistId: waitlist.WaitlistID,
        position: waitlist.WaitlistPosition,
        priorityGroup: waitlist.PriorityGroup,
        explanation: waitlist.Explanation,
        status: waitlist.Status
      } : null,
      hostelsList: allHostels,
      analytics: analytics
    };
  });
}

function apiSubmitApplication(token, appData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'STUDENT');
    var studentId = session.studentId;

    if (!studentId) {
      throw new Error('Student identifier missing.');
    }

    // Check application deadline
    var windowStatus = PolicyEngine.isApplicationWindowOpen();
    if (!windowStatus.isOpen) {
      throw new Error('Application submission is closed: ' + windowStatus.reason);
    }

    var activeYear = PolicyEngine.getActiveAcademicYear();
    var nowIso = new Date().toISOString();

    // 1. Update Student Profile Details
    var studentUpdates = {
      EnrollmentNo: appData.enrollmentNo || '',
      Name: appData.name || session.name,
      DateOfBirth: appData.dateOfBirth || '',
      Gender: String(appData.gender || '').toUpperCase(),
      Nationality: appData.nationality || 'INDIAN',
      Programme: appData.programme || '',
      Department: appData.department || '',
      JoiningDate: appData.joiningDate || '',
      Category: String(appData.category || 'GENERAL').toUpperCase(),
      AdmissionCategory: String(appData.regionType || 'OUTSIDE_DELHI').toUpperCase(),
      RegionType: String(appData.regionType || 'OUTSIDE_DELHI').toUpperCase(),
      IsDelhiNCRResident: appData.isDelhiNCRResident === true || appData.isDelhiNCRResident === 'true',
      IsParentPostedOutsideNCR: appData.isParentPostedOutsideNCR === true || appData.isParentPostedOutsideNCR === 'true',
      IsPwD: appData.isPwD === true || appData.isPwD === 'true',
      StudentMobile: appData.studentMobile || '',
      ParentName: appData.parentName || '',
      ParentMobile: appData.parentMobile || '',
      PermanentAddress: appData.permanentAddress || '',
      PermanentCity: appData.permanentCity || '',
      PermanentState: appData.permanentState || '',
      PermanentPincode: appData.permanentPincode || '',
      LocalGuardianName: appData.localGuardianName || '',
      LocalGuardianContact: appData.localGuardianContact || '',
      EmergencyContact: appData.emergencyContact || '',
      UpdatedAt: nowIso
    };

    // Calculate Distance
    var calculatedDist = DistanceService.calculateDistance({
      address: studentUpdates.PermanentAddress,
      city: studentUpdates.PermanentCity,
      state: studentUpdates.PermanentState,
      pincode: studentUpdates.PermanentPincode,
      isDelhiNCR: studentUpdates.IsDelhiNCRResident
    });
    studentUpdates.DistanceKm = calculatedDist;

    var existingStudent = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId);
    if (existingStudent) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId, studentUpdates);
    } else {
      studentUpdates.StudentID = studentId;
      studentUpdates.UserID = session.userId;
      studentUpdates.StudentEmail = session.email;
      studentUpdates.CreatedAt = nowIso;
      SheetRepository.insertRecord(SheetRepository.SHEETS.STUDENTS, studentUpdates);
    }

    // 2. Evaluate Priority Tier
    var fullStudentRecord = Object.assign({}, existingStudent || {}, studentUpdates);
    var priorityGroup = PriorityEngine.determinePriorityGroup(fullStudentRecord);

    // 3. Save or Update Application
    var existingApp = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    var appId = existingApp ? existingApp.ApplicationID : ('APP_' + activeYear.AcademicYear.replace('-', '_') + '_' + Utilities.getUuid().substring(0, 6).toUpperCase());

    var appRecord = {
      ApplicationID: appId,
      StudentID: studentId,
      AcademicYear: activeYear.AcademicYear,
      SubmissionDate: nowIso,
      Status: 'SUBMITTED',
      EligibilityStatus: 'PENDING',
      EligibilityRemarks: '',
      PriorityGroup: priorityGroup.code,
      PriorityScore: priorityGroup.rank,
      CalculatedDistance: calculatedDist,
      FirstHostelPref: appData.firstHostelPref || '',
      SecondHostelPref: appData.secondHostelPref || '',
      NoPreference: appData.noPreference === true || appData.noPreference === 'true',
      VerifiedBy: '',
      VerifiedAt: '',
      Remarks: appData.remarks || '',
      CreatedAt: existingApp ? existingApp.CreatedAt : nowIso,
      UpdatedAt: nowIso
    };

    if (existingApp) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', appId, appRecord);
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.APPLICATIONS, appRecord);
    }

    // Evaluate initial eligibility
    var docs = DocumentService.getStudentDocuments(studentId);
    var eligResult = EligibilityEngine.evaluateEligibility(fullStudentRecord, appRecord, docs);
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', appId, {
      EligibilityStatus: eligResult.status,
      EligibilityRemarks: eligResult.reasons.join('; ')
    });

    // Send confirmation email
    NotificationService.notifyApplicationSubmitted(fullStudentRecord, appRecord);

    AuditService.logAction(
      session.userId,
      session.email,
      'STUDENT',
      'APPLICATION_SUBMISSION',
      'Application',
      appId,
      null,
      { priority: priorityGroup.code, distance: calculatedDist },
      'Hostel application submitted for ' + activeYear.AcademicYear,
      'SUCCESS'
    );

    return {
      applicationId: appId,
      academicYear: activeYear.AcademicYear,
      priorityGroup: priorityGroup.name,
      distance: calculatedDist,
      status: 'SUBMITTED',
      eligibilityStatus: eligResult.status
    };
  });
}

function apiUploadDocument(token, documentType, base64Data, fileName, mimeType) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'STUDENT');
    var studentId = session.studentId;
    var activeYear = PolicyEngine.getActiveAcademicYear();

    var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    var appId = app ? app.ApplicationID : '';
    var uploadResult = DocumentService.uploadDocument(studentId, appId, documentType, base64Data, fileName, mimeType);

    // Trigger eligibility re-evaluation
    if (app) {
      var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId);
      var docs = DocumentService.getStudentDocuments(studentId);
      var elig = EligibilityEngine.evaluateEligibility(student, app, docs);
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
        EligibilityStatus: elig.status,
        EligibilityRemarks: elig.reasons.join('; ')
      });
    }

    return uploadResult;
  });
}

function apiRecordPayment(token, paymentData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'STUDENT');
    var studentId = session.studentId;
    var activeYear = PolicyEngine.getActiveAcademicYear();

    // Enforce business rule: Payment is only accepted after room allocation is published
    var allocation = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return String(a.StudentID) === String(studentId) &&
        String(a.AcademicYear) === String(activeYear.AcademicYear) &&
        (a.Status === 'PUBLISHED' || a.Status === 'LOCKED');
    })[0];

    if (!allocation) {
      throw new Error('Hostel fee payment is only accepted after a single-occupancy room has been officially allocated to you.');
    }

    var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return String(a.StudentID) === String(studentId) && String(a.AcademicYear) === String(activeYear.AcademicYear);
    })[0];

    return PaymentService.recordPayment(
      studentId,
      app ? app.ApplicationID : allocation.ApplicationID,
      activeYear.AcademicYear,
      paymentData.amount,
      paymentData.paymentMode,
      paymentData.transactionReference,
      paymentData.paymentDate,
      paymentData.ddBankName,
      paymentData.ddBranchName,
      paymentData.ddInFavorOf
    );
  });
}

function apiSubmitPayment(token, paymentData) {
  return apiRecordPayment(token, paymentData);
}

function apiGetAllotmentLetter(token) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, ['STUDENT', 'WARDEN']);
    var studentId = session.studentId;

    if (!studentId) {
      throw new Error('Student ID not found in session.');
    }

    var activeYear = PolicyEngine.getActiveAcademicYear();
    var allocation = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return String(a.StudentID) === String(studentId) &&
        String(a.AcademicYear) === String(activeYear.AcademicYear) &&
        (a.Status === 'PUBLISHED' || a.Status === 'LOCKED');
    })[0];

    if (!allocation) {
      throw new Error('No published hostel allotment letter is available for your account.');
    }

    var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', studentId);
    var application = SheetRepository.findRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', allocation.ApplicationID);
    var hostel = SheetRepository.findRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', allocation.HostelID);
    var room = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', allocation.RoomID);
    var payments = PaymentService.getStudentPayments(studentId);
    var verifiedPayment = payments.filter(function (p) { return p.Status === 'VERIFIED'; })[0] || null;
    var feeAmount = PolicyEngine.getPolicyValue('HOSTEL_FEE_AMOUNT', 35000);

    return {
      institutionName: 'HOSTEL 360 - University Hostel Administration',
      campusName: 'Dwarka Campus, Sector 16C, New Delhi 110078',
      academicYear: activeYear.AcademicYear,
      allotmentLetterNo: 'HL-' + String(allocation.AllocationID).replace('ALC_', ''),
      dateOfIssue: allocation.PublishedAt ? allocation.PublishedAt.split('T')[0] : allocation.AllocatedDate,
      student: {
        studentId: student ? student.StudentID : studentId,
        name: student ? student.Name : session.name,
        enrollmentNo: student ? student.EnrollmentNo : 'N/A',
        programme: student ? student.Programme : 'N/A',
        department: student ? student.Department : 'N/A',
        gender: student ? student.Gender : 'N/A',
        category: student ? student.Category : 'GENERAL',
        regionType: student ? student.RegionType : 'N/A',
        mobile: student ? student.StudentMobile : 'N/A',
        permanentCity: student ? student.PermanentCity : '',
        permanentState: student ? student.PermanentState : ''
      },
      application: {
        applicationId: application ? application.ApplicationID : allocation.ApplicationID,
        submissionDate: application ? application.SubmissionDate : ''
      },
      allotment: {
        hostelName: hostel ? hostel.Name : 'Hostel',
        hostelCode: hostel ? hostel.Code : '',
        gender: hostel ? hostel.Gender : '',
        roomNumber: room ? room.RoomNumber : '',
        floorNumber: room ? room.FloorNumber : '',
        bedNumber: '1 (Single Occupancy)',
        priorityGroup: allocation.PriorityGroup,
        reservationCategory: allocation.ReservationCategory,
        status: allocation.Status,
        explanation: allocation.Explanation
      },
      fee: {
        annualFee: feeAmount,
        paymentStatus: verifiedPayment ? 'VERIFIED' : (payments.length > 0 ? payments[payments.length - 1].Status : 'PENDING'),
        verifiedReference: verifiedPayment ? verifiedPayment.TransactionReference : (payments.length > 0 ? payments[payments.length - 1].TransactionReference : 'N/A'),
        paymentDate: verifiedPayment ? verifiedPayment.PaymentDate : ''
      }
    };
  });
}

// ============================================================
// WARDEN & ADMINISTRATIVE APIS
// ============================================================

function apiGetWardenDashboard(token, academicYear) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;

    // Self-healing database check: If hostels or applications are empty, initialize & seed demo data automatically
    var existingHostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var existingApps = SheetRepository.getAllRecords(SheetRepository.SHEETS.APPLICATIONS);
    if (existingHostels.length === 0 || existingApps.length === 0) {
      SetupService.setupHostel360();
    }

    var analytics = AnalyticsService.getWardenAnalytics(yearStr);
    var applications = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return a.AcademicYear === yearStr;
    });

    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];

    var appRows = applications.map(function (app) {
      var st = stMap[app.StudentID] || {};
      var docs = DocumentService.getStudentDocuments(app.StudentID);
      return {
        applicationId: app.ApplicationID,
        studentId: app.StudentID,
        name: st.Name || 'N/A',
        enrollmentNo: st.EnrollmentNo || 'N/A',
        gender: st.Gender || 'N/A',
        category: st.Category || 'GENERAL',
        region: st.RegionType || 'N/A',
        distance: st.DistanceKm || app.CalculatedDistance || 0,
        submissionDate: app.SubmissionDate,
        status: app.Status,
        eligibilityStatus: app.EligibilityStatus || 'PENDING',
        eligibilityRemarks: app.EligibilityRemarks || '',
        priorityGroup: app.PriorityGroup || 'N/A',
        firstPref: app.FirstHostelPref || '',
        secondPref: app.SecondHostelPref || '',
        documentsCount: docs.length,
        documents: docs
      };
    });

    var allocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (al) {
      return al.AcademicYear === yearStr;
    });

    var hostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var hMap = {};
    for (var h = 0; h < hostels.length; h++) hMap[hostels[h].HostelID] = hostels[h];

    var rooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
    var rMap = {};
    for (var r = 0; r < rooms.length; r++) rMap[rooms[r].RoomID] = rooms[r];

    var allPayments = SheetRepository.getAllRecords(SheetRepository.SHEETS.PAYMENTS);
    var paymentsByStudent = {};
    for (var p = 0; p < allPayments.length; p++) {
      var pay = allPayments[p];
      if (!paymentsByStudent[pay.StudentID]) paymentsByStudent[pay.StudentID] = [];
      paymentsByStudent[pay.StudentID].push(pay);
    }

    var nowMs = new Date().getTime();
    var deadlineDays = PolicyEngine.getFeePaymentDeadlineDays();

    var allocationRows = allocations.map(function (al) {
      var st = stMap[al.StudentID] || {};
      var host = hMap[al.HostelID] || {};
      var rm = rMap[al.RoomID] || {};
      var stuPays = paymentsByStudent[al.StudentID] || [];
      var hasVerifiedPayment = stuPays.some(function (pm) { return pm.Status === 'VERIFIED'; });
      var hasSubmittedPayment = stuPays.length > 0;

      var allocExpiry = al.ExpiryDate || (al.PublishedAt ? new Date(new Date(al.PublishedAt).getTime() + (deadlineDays * 24 * 60 * 60 * 1000)).toISOString() : null);
      var isOverdue = false;
      if (al.Status === 'PUBLISHED' && !hasVerifiedPayment && al.RegistrationStatus !== 'COMPLETED') {
        if (allocExpiry && nowMs > new Date(allocExpiry).getTime()) {
          isOverdue = true;
        }
      }

      return {
        allocationId: al.AllocationID,
        applicationId: al.ApplicationID,
        studentId: al.StudentID,
        studentName: st.Name || 'N/A',
        gender: st.Gender || 'N/A',
        hostelId: al.HostelID,
        hostelName: host.Name || 'N/A',
        roomId: al.RoomID,
        roomNumber: rm.RoomNumber || 'N/A',
        floorNumber: rm.FloorNumber || 'N/A',
        allocatedDate: al.AllocatedDate,
        priorityGroup: al.PriorityGroup,
        category: al.ReservationCategory,
        explanation: al.Explanation,
        isOverride: al.IsManualOverride,
        overrideReason: al.OverrideReason,
        status: al.Status,
        registrationStatus: al.RegistrationStatus || 'PENDING',
        expiryDate: allocExpiry,
        isOverdue: isOverdue,
        hasVerifiedPayment: hasVerifiedPayment,
        hasSubmittedPayment: hasSubmittedPayment
      };
    });

    var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
    });
    waitlist.sort(function (a, b) { return (parseInt(a.WaitlistPosition, 10) || 0) - (parseInt(b.WaitlistPosition, 10) || 0); });

    var waitlistRows = waitlist.map(function (w) {
      var st = stMap[w.StudentID] || {};
      return {
        waitlistId: w.WaitlistID,
        applicationId: w.ApplicationID,
        studentId: w.StudentID,
        studentName: st.Name || 'N/A',
        gender: st.Gender || 'N/A',
        category: st.Category || 'GENERAL',
        priorityGroup: w.PriorityGroup,
        position: w.WaitlistPosition,
        distance: st.DistanceKm || 0,
        reason: w.Reason,
        explanation: w.Explanation,
        status: w.Status,
        createdAt: w.CreatedAt
      };
    });

    var reservationRules = ReservationEngine.getReservationRules(yearStr);
    var priorityRules = PriorityEngine.getPriorityRules(yearStr);
    var allYears = SheetRepository.getAllRecords(SheetRepository.SHEETS.ACADEMIC_YEARS);
    var payments = PaymentService.getAllPayments(yearStr);

    var alMap = {};
    for (var a = 0; a < allocations.length; a++) {
      var alItem = allocations[a];
      var hostItem = hMap[alItem.HostelID] || {};
      var rmItem = rMap[alItem.RoomID] || {};
      alMap[alItem.StudentID] = {
        room: rmItem.RoomNumber ? ('Room ' + rmItem.RoomNumber + ' (' + (hostItem.Code || hostItem.Name) + ')') : 'Allocated',
        status: alItem.Status
      };
    }

    var paymentRows = payments.map(function (p) {
      var st = stMap[p.StudentID] || {};
      var alInfo = alMap[p.StudentID] || null;
      return {
        PaymentID: p.PaymentID,
        StudentID: p.StudentID,
        StudentName: st.Name || 'Student',
        EnrollmentNo: st.EnrollmentNo || 'N/A',
        AllocatedRoom: alInfo ? alInfo.room : 'Allocated',
        Amount: p.Amount,
        PaymentMode: p.PaymentMode,
        TransactionReference: p.TransactionReference,
        PaymentDate: p.PaymentDate,
        Status: p.Status,
        VerifiedBy: p.VerifiedBy,
        Remarks: p.Remarks
      };
    });

    return {
      warden: {
        userId: session.userId,
        email: session.email,
        name: session.name
      },
      academicYear: activeYear,
      allAcademicYears: allYears,
      analytics: analytics,
      applications: appRows,
      allocations: allocationRows,
      waitlist: waitlistRows,
      hostels: hostels,
      rooms: rooms,
      reservationRules: reservationRules,
      priorityRules: priorityRules,
      payments: paymentRows
    };
  });
}

function apiVerifyPayment(token, paymentId, status, remarks) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PaymentService.verifyPayment(paymentId, status, remarks, session.email, session.userId);
  });
}

function apiVerifyPaymentsBatch(token, verifications) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    if (!verifications || !verifications.length) {
      return { success: true, count: 0 };
    }

    for (var i = 0; i < verifications.length; i++) {
      var item = verifications[i];
      PaymentService.verifyPayment(item.paymentId, item.status, item.remarks || '', session.email, session.userId);
    }

    return { success: true, count: verifications.length };
  });
}

function apiVerifyDocument(token, documentId, status, remarks) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    var result = DocumentService.verifyDocument(documentId, status, remarks, session.email, session.userId);

    // Re-evaluate student eligibility
    var doc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.DOCUMENTS, 'DocumentID', documentId);
    if (doc && doc.StudentID) {
      var activeYear = PolicyEngine.getActiveAcademicYear();
      var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
        return a.StudentID === doc.StudentID && a.AcademicYear === activeYear.AcademicYear;
      })[0];

      if (app) {
        var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', doc.StudentID);
        var docs = DocumentService.getStudentDocuments(doc.StudentID);
        var elig = EligibilityEngine.evaluateEligibility(student, app, docs);
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
          EligibilityStatus: elig.status,
          EligibilityRemarks: elig.reasons.join('; ')
        });
      }
    }

    return result;
  });
}

function apiVerifyDocumentsBatch(token, verifications) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    if (!verifications || !verifications.length) {
      return { success: true, count: 0 };
    }

    var affectedStudentIds = {};
    for (var i = 0; i < verifications.length; i++) {
      var item = verifications[i];
      DocumentService.verifyDocument(item.documentId, item.status, item.remarks || '', session.email, session.userId);
      var doc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.DOCUMENTS, 'DocumentID', item.documentId);
      if (doc && doc.StudentID) {
        affectedStudentIds[doc.StudentID] = true;
      }
    }

    // Re-evaluate student eligibility for affected students
    var activeYear = PolicyEngine.getActiveAcademicYear();
    for (var stuId in affectedStudentIds) {
      var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
        return a.StudentID === stuId && a.AcademicYear === activeYear.AcademicYear;
      })[0];
      if (app) {
        var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', stuId);
        var docs = DocumentService.getStudentDocuments(stuId);
        var elig = EligibilityEngine.evaluateEligibility(student, app, docs);
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
          EligibilityStatus: elig.status,
          EligibilityRemarks: elig.reasons.join('; ')
        });
      }
    }

    return { success: true, count: verifications.length };
  });
}

function apiRunAllocation(token, academicYear) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.runAllocation(academicYear, session.email, session.userId);
  });
}

function apiValidateAllocations(token, academicYear) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    var year = academicYear || PolicyEngine.getActiveAcademicYear().AcademicYear;
    var allocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === year;
    });
    return AllocationValidator.validateAllocations(allocations, year);
  });
}

function apiPublishAllocations(token, academicYear) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.publishAllocations(academicYear, session.email, session.userId);
  });
}

function apiReopenAllocations(token, academicYear, reason) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.reopenAllocations(academicYear, reason, session.email, session.userId);
  });
}

function apiOverrideAllocation(token, overrideData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.overrideAllocation(
      overrideData.allocationId,
      overrideData.newHostelId,
      overrideData.newRoomId,
      overrideData.reason,
      session.email,
      session.userId
    );
  });
}

function apiCancelAllocation(token, cancelData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.cancelAllocation(
      cancelData.allocationId,
      cancelData.reason,
      session.email,
      session.userId
    );
  });
}

function apiUpdateRegistrationStatus(token, allocationId, status, remarks) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    if (!allocationId) throw new Error('Allocation ID is required.');

    var cleanStatus = String(status || 'COMPLETED').toUpperCase();
    var nowIso = new Date().toISOString();

    var alloc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId);
    if (!alloc) throw new Error('Allocation record not found: ' + allocationId);

    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId, {
      RegistrationStatus: cleanStatus,
      RegisteredAt: nowIso,
      RegistrationRemarks: remarks || 'Offline physical registration & room possession confirmed by Warden'
    });

    if (alloc.StudentID) {
      var activeYear = PolicyEngine.getActiveAcademicYear();
      var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
        return a.StudentID === alloc.StudentID && a.AcademicYear === (alloc.AcademicYear || activeYear.AcademicYear);
      })[0];
      if (app) {
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
          RegistrationStatus: cleanStatus,
          RegisteredAt: nowIso
        });
      }
    }

    AuditService.logAction(
      session.userId,
      session.email,
      'WARDEN',
      'REGISTRATION_STATUS_UPDATE',
      'Allocation',
      allocationId,
      alloc.RegistrationStatus || 'PENDING',
      cleanStatus,
      remarks || 'Physical registration & key handover marked as ' + cleanStatus,
      'SUCCESS'
    );

    return {
      allocationId: allocationId,
      registrationStatus: cleanStatus,
      registeredAt: nowIso
    };
  });
}

function apiLapseUnreportedAllocations(token, academicYear) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.lapseUnreportedAllocations(academicYear, session.email, session.userId);
  });
}

function apiPromoteWaitlist(token, academicYear) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return AllocationEngine.promoteWaitlistCandidates(academicYear, session.email, session.userId);
  });
}

function apiSeedDatabase(token) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return SetupService.setupHostel360();
  });
}

function apiReleaseReservedSeats(token, releaseData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return ReservationEngine.releaseReservedSeats(
      releaseData.category,
      parseInt(releaseData.seatsToRelease, 10),
      releaseData.reason,
      session.email,
      session.userId
    );
  });
}

function apiUpdatePolicy(token, key, value, description) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PolicyEngine.setPolicyValue(key, value, description, session.email);
  });
}

function apiUpdateReservationRules(token, rules) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return ReservationEngine.updateReservationRules(rules, session.email, session.userId);
  });
}

function apiAddReservationCategory(token, category, percentage) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return ReservationEngine.addReservationCategory(category, percentage, session.email, session.userId);
  });
}

function apiUpdateReservationCategory(token, ruleId, category, percentage, status) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return ReservationEngine.updateReservationCategory(ruleId, category, percentage, status, session.email, session.userId);
  });
}

function apiDeleteReservationCategory(token, ruleId) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return ReservationEngine.deleteReservationCategory(ruleId, session.email, session.userId);
  });
}

function apiUpdatePriorityRules(token, rules) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PriorityEngine.savePriorityRules(rules, session.email, session.userId);
  });
}

function apiAddPriorityRule(token, priorityGroup, groupName, description, orderRank) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PriorityEngine.addPriorityRule(priorityGroup, groupName, description, orderRank, session.email, session.userId);
  });
}

function apiUpdatePriorityRule(token, ruleId, priorityGroup, groupName, description, orderRank, status) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PriorityEngine.updatePriorityRule(ruleId, priorityGroup, groupName, description, orderRank, status, session.email, session.userId);
  });
}

function apiDeletePriorityRule(token, ruleId) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PriorityEngine.deletePriorityRule(ruleId, session.email, session.userId);
  });
}

function apiSaveHostel(token, hostelData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    var hostelId = hostelData.HostelID || ('HST_' + String(hostelData.Name).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase());
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', hostelId);

    var record = {
      HostelID: hostelId,
      Name: hostelData.Name,
      Code: hostelData.Code,
      Gender: String(hostelData.Gender).toUpperCase(),
      TotalFloors: parseInt(hostelData.TotalFloors, 10) || 1,
      TotalRooms: parseInt(hostelData.TotalRooms, 10) || 0,
      Status: hostelData.Status || 'ACTIVE',
      Description: hostelData.Description || ''
    };

    if (existing) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', hostelId, record);
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.HOSTELS, record);
    }

    AuditService.logAction(
      session.userId,
      session.email,
      'WARDEN',
      'HOSTEL_SAVED',
      'Hostel',
      hostelId,
      existing,
      record,
      'Hostel saved/updated',
      'SUCCESS'
    );

    return record;
  });
}

function apiSaveRoom(token, roomData) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    var roomId = roomData.RoomID || ('RM_' + roomData.HostelID + '_' + roomData.RoomNumber);
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', roomId);

    var record = {
      RoomID: roomId,
      HostelID: roomData.HostelID,
      FloorNumber: parseInt(roomData.FloorNumber, 10) || 1,
      RoomNumber: roomData.RoomNumber,
      Capacity: 1, // Single occupancy enforced
      OccupancyStatus: roomData.OccupancyStatus || 'AVAILABLE',
      Status: roomData.Status || 'ACTIVE',
      Remarks: roomData.Remarks || 'Single occupancy room'
    };

    if (existing) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', roomId, record);
    } else {
      SheetRepository.insertRecord(SheetRepository.SHEETS.ROOMS, record);
      // Ensure Bed record exists
      SheetRepository.insertRecord(SheetRepository.SHEETS.BEDS, {
        BedID: 'BED_' + roomId,
        RoomID: roomId,
        HostelID: roomData.HostelID,
        BedNumber: '1',
        Status: record.OccupancyStatus,
        CurrentStudentID: ''
      });

      // Update total rooms count on Hostel
      var allHostelRooms = SheetRepository.findRecords(SheetRepository.SHEETS.ROOMS, function (r) {
        return r.HostelID === roomData.HostelID;
      });
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', roomData.HostelID, {
        TotalRooms: allHostelRooms.length
      });
    }

    AuditService.logAction(
      session.userId,
      session.email,
      'WARDEN',
      'ROOM_SAVED',
      'Room',
      roomId,
      existing,
      record,
      'Room saved/updated',
      'SUCCESS'
    );

    return record;
  });
}

function apiVerifyPayment(token, paymentId, status, remarks) {
  return apiResponse(function () {
    var session = AuthService.requireRole(token, 'WARDEN');
    return PaymentService.verifyPayment(paymentId, status, remarks, session.email, session.userId);
  });
}

function apiGetReports(token, reportType, academicYear) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    return ReportService.getReport(reportType, academicYear);
  });
}

function apiGetAuditLogs(token, limit, role, action) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    return AuditService.getAuditLogs(limit, role, action);
  });
}

function apiTriggerSystemSetup(token) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    return SetupService.setupHostel360();
  });
}

function apiResetAndSeed120Applicants(token) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    return SetupService.resetAndSeedLargeDataset(120);
  });
}

// ============================================================
// SMRITI ADVISORY INSTITUTIONAL MEMORY APIS (WARDEN ONLY)
// ============================================================

/**
 * Reflects over institutional memory to answer a warden inquiry.
 * Advisory only. Never influences or blocks allocation decisions.
 */
function apiSmritiAsk(token, question) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    if (!question || !String(question).trim()) {
      throw new Error('Question cannot be empty.');
    }

    try {
      var res = MemoryService.smritiReflect(question, 'Warden Institutional Query');
      if (!res.ok) {
        return {
          answer: 'Smriti is currently unconfigured or operating in offline mode. Please configure Hindsight credentials (HINDSIGHT_API_KEY and HINDSIGHT_BANK_ID) via smritiSetConfig() to enable memory reflection.',
          isConfigured: false
        };
      }
      return {
        answer: res.answer || 'No relevant precedents or institutional memory records found for this question.',
        isConfigured: true
      };
    } catch (err) {
      Logger.log('apiSmritiAsk error: ' + err.message);
      return {
        answer: 'Institutional memory service encountered a transient error: ' + err.message,
        isConfigured: false
      };
    }
  });
}
function smritiAsk(token, question) {
  return apiSmritiAsk(token, question);
}

/**
 * Recalls similar past manual override precedents for the target candidate.
 * Returns up to 3 short cases. Advisory only.
 */
function apiSmritiSuggestForOverride(token, ctx) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');
    var contextObj = ctx || {};

    try {
      var category = contextObj.category || 'GENERAL';
      var priority = contextObj.priorityGroup || '';
      var hostel = contextObj.toHostel || contextObj.hostelId || '';
      var query = 'manual override category ' + category + ' priority ' + priority + ' hostel ' + hostel;

      var res = MemoryService.smritiRecall(query);
      if (!res.ok || !res.items || !res.items.length) {
        return {
          cases: [],
          notice: res.error ? 'Smriti advisory memory is unconfigured or offline.' : 'No matching historical override precedents found.'
        };
      }

      var formattedCases = [];
      for (var i = 0; i < res.items.length && formattedCases.length < 3; i++) {
        var it = res.items[i];
        var text = (typeof it === 'string') ? it : (it.content || it.text || it.memory || JSON.stringify(it));
        if (text && text.trim().length > 10) {
          formattedCases.push({
            content: text,
            context: it.context || 'manual_override',
            timestamp: it.timestamp || ''
          });
        }
      }

      return {
        cases: formattedCases,
        notice: formattedCases.length ? null : 'No matching historical override precedents found.'
      };
    } catch (err) {
      Logger.log('apiSmritiSuggestForOverride error: ' + err.message);
      return {
        cases: [],
        notice: 'Smriti memory lookup error: ' + err.message
      };
    }
  });
}
function smritiSuggestForOverride(token, ctx) {
  return apiSmritiSuggestForOverride(token, ctx);
}

/**
 * Synthesizes a pre-publication briefing on patterns/cautions from earlier cycles.
 * Advisory only.
 */
function apiSmritiPrePublishBriefing(token) {
  return apiResponse(function () {
    AuthService.requireRole(token, 'WARDEN');

    try {
      var activeYearObj = PolicyEngine.getActiveAcademicYear();
      var yearStr = activeYearObj ? activeYearObj.AcademicYear : '2026-27';

      var drafts = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
        return a.AcademicYear === yearStr && (a.Status === 'DRAFT' || a.Status === 'REVIEW');
      });

      var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
        return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
      });

      var summaryContext = 'Cycle ' + yearStr + ': ' + drafts.length + ' draft allotments pending publication, ' + waitlist.length + ' waitlisted applicants.';
      var query = 'What patterns, pitfalls, or seat forfeiture trends from earlier allocation cycles should the warden watch before publishing hostel allocations?';

      var res = MemoryService.smritiReflect(query, summaryContext);
      if (!res.ok) {
        return {
          briefing: 'Smriti advisory memory is unconfigured or offline. You can proceed with publication—all deterministic checks remain fully guarded by the 12-point allocation validator.',
          isConfigured: false,
          draftCount: drafts.length,
          waitlistCount: waitlist.length
        };
      }

      return {
        briefing: res.answer || 'All previous cycle guidelines appear satisfied. Please review validator warnings if any.',
        isConfigured: true,
        draftCount: drafts.length,
        waitlistCount: waitlist.length
      };
    } catch (err) {
      Logger.log('apiSmritiPrePublishBriefing error: ' + err.message);
      return {
        briefing: 'Smriti briefing unavailable: ' + err.message,
        isConfigured: false
      };
    }
  });
}
function smritiPrePublishBriefing(token) {
  return apiSmritiPrePublishBriefing(token);
}

