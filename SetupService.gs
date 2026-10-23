/**
 * HOSTEL 360 - SetupService.gs
 * Automated idempotent database setup, plain-text column formatting,
 * self-healing formula error repairs, and demo seed data initialization.
 */

var SetupService = (function () {

  var SCHEMA = {
    Users: ['UserID', 'Email', 'PasswordHash', 'Salt', 'Role', 'StudentID', 'Name', 'Status', 'CreatedAt', 'LastLogin'],
    Students: ['StudentID', 'UserID', 'EnrollmentNo', 'Name', 'DateOfBirth', 'Gender', 'Nationality', 'Programme', 'Department', 'JoiningDate', 'Category', 'AdmissionCategory', 'RegionType', 'IsDelhiNCRResident', 'IsParentPostedOutsideNCR', 'IsPwD', 'StudentEmail', 'StudentMobile', 'ParentName', 'ParentMobile', 'PermanentAddress', 'PermanentCity', 'PermanentState', 'PermanentPincode', 'DistanceKm', 'LocalGuardianName', 'LocalGuardianContact', 'EmergencyContact', 'CreatedAt', 'UpdatedAt'],
    Applications: ['ApplicationID', 'StudentID', 'AcademicYear', 'SubmissionDate', 'Status', 'EligibilityStatus', 'EligibilityRemarks', 'PriorityGroup', 'PriorityScore', 'CalculatedDistance', 'FirstHostelPref', 'SecondHostelPref', 'NoPreference', 'RegistrationStatus', 'RegisteredAt', 'VerifiedBy', 'VerifiedAt', 'Remarks', 'CreatedAt', 'UpdatedAt'],
    Documents: ['DocumentID', 'ApplicationID', 'StudentID', 'DocumentType', 'DriveFileID', 'DriveURL', 'UploadedAt', 'VerificationStatus', 'VerifiedBy', 'VerifiedAt', 'Remarks'],
    Hostels: ['HostelID', 'Name', 'Code', 'Gender', 'TotalFloors', 'TotalRooms', 'Status', 'Description'],
    Rooms: ['RoomID', 'HostelID', 'FloorNumber', 'RoomNumber', 'Capacity', 'OccupancyStatus', 'Status', 'Remarks'],
    Beds: ['BedID', 'RoomID', 'HostelID', 'BedNumber', 'Status', 'CurrentStudentID'],
    Policies: ['PolicyID', 'AcademicYear', 'PolicyKey', 'PolicyValue', 'Description', 'UpdatedAt', 'UpdatedBy'],
    ReservationRules: ['RuleID', 'AcademicYear', 'Category', 'Percentage', 'SeatCount', 'UsedSeats', 'RemainingSeats', 'Status', 'UpdatedAt'],
    PriorityRules: ['RuleID', 'AcademicYear', 'PriorityGroup', 'GroupName', 'Description', 'OrderRank', 'Status'],
    Preferences: ['PreferenceID', 'ApplicationID', 'StudentID', 'PreferenceOrder', 'HostelID', 'CreatedAt'],
    Allocations: ['AllocationID', 'ApplicationID', 'StudentID', 'HostelID', 'RoomID', 'BedID', 'AcademicYear', 'Status', 'AllocatedDate', 'PriorityGroup', 'ReservationCategory', 'Explanation', 'IsManualOverride', 'OverrideReason', 'RegistrationStatus', 'RegisteredAt', 'RegistrationRemarks', 'CreatedBy', 'PublishedAt'],
    Waitlist: ['WaitlistID', 'ApplicationID', 'StudentID', 'AcademicYear', 'PriorityGroup', 'PriorityRank', 'WaitlistPosition', 'Reason', 'Status', 'Explanation', 'CreatedAt', 'UpdatedAt'],
    Payments: ['PaymentID', 'StudentID', 'ApplicationID', 'AcademicYear', 'Amount', 'PaymentMode', 'TransactionReference', 'PaymentDate', 'Status', 'VerifiedBy', 'VerifiedAt', 'Remarks', 'CreatedAt'],
    AuditLog: ['AuditID', 'Timestamp', 'UserID', 'Email', 'Role', 'Action', 'EntityType', 'EntityID', 'OldValue', 'NewValue', 'Reason', 'IPAddress', 'Status'],
    Notifications: ['NotificationID', 'RecipientEmail', 'StudentID', 'Subject', 'MessageBody', 'NotificationType', 'Status', 'SentAt', 'ErrorMessage'],
    AcademicYears: ['YearID', 'AcademicYear', 'StartDate', 'EndDate', 'ApplicationStartDate', 'ApplicationDeadline', 'IsActive', 'Status', 'CreatedAt']
  };

  /**
   * Initializes the entire Google Spreadsheet database structure safely and idempotently
   */
  function initializeDatabase() {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error('SpreadsheetApp.getActiveSpreadsheet() returned null. Please run this from a container-bound script or configure script properties.');
    }

    var existingSheets = ss.getSheets().map(function (s) { return s.getName(); });
    var createdCount = 0;

    for (var sheetName in SCHEMA) {
      if (SCHEMA.hasOwnProperty(sheetName)) {
        var headers = SCHEMA[sheetName];
        var sheet = ss.getSheetByName(sheetName);

        if (!sheet) {
          sheet = ss.insertSheet(sheetName);
          createdCount++;
        }

        // Check if headers need writing
        if (sheet.getLastRow() === 0) {
          sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
          // Style Header
          var headerRange = sheet.getRange(1, 1, 1, headers.length);
          headerRange.setFontWeight('bold');
          headerRange.setBackground('#1e3a8a');
          headerRange.setFontColor('#ffffff');
          sheet.setFrozenRows(1);
        }

        // Enforce Plain Text format across the sheet to prevent formula parse errors on phone numbers
        var maxRows = Math.max(10, sheet.getMaxRows());
        var maxCols = Math.max(headers.length, sheet.getMaxColumns());
        sheet.getRange(1, 1, maxRows, maxCols).setNumberFormat('@');
      }
    }

    // Remove default 'Sheet1' if it exists and is empty
    var defaultSheet = ss.getSheetByName('Sheet1');
    if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
      try {
        ss.deleteSheet(defaultSheet);
      } catch (e) {
        // Ignore deletion error
      }
    }

    // Self-healing: Repair any existing #ERROR! formula parse cells
    cleanMobileFormulaErrors();

    return { success: true, createdSheetsCount: createdCount };
  }

  /**
   * Cleans any existing #ERROR! formula parse cells in phone number columns
   */
  function cleanMobileFormulaErrors() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      if (!ss) return;

      var studentsSheet = ss.getSheetByName('Students');
      if (!studentsSheet || studentsSheet.getLastRow() <= 1) return;

      var lastRow = studentsSheet.getLastRow();
      var lastCol = studentsSheet.getLastColumn();
      var range = studentsSheet.getRange(1, 1, lastRow, lastCol);
      var values = range.getValues();
      var formulas = range.getFormulas();
      var headers = values[0].map(function (h) { return String(h).trim(); });

      var mobileCols = ['StudentMobile', 'ParentMobile', 'LocalGuardianContact', 'EmergencyContact'];
      var colIndices = [];

      for (var m = 0; m < mobileCols.length; m++) {
        var idx = headers.indexOf(mobileCols[m]);
        if (idx !== -1) {
          colIndices.push(idx);
          // Set entire column to plain text format
          studentsSheet.getRange(1, idx + 1, lastRow, 1).setNumberFormat('@');
        }
      }

      var hasChanges = false;
      for (var r = 1; r < values.length; r++) {
        for (var c = 0; c < colIndices.length; c++) {
          var colIdx = colIndices[c];
          var rawVal = String(values[r][colIdx] || '');
          var formula = String(formulas[r][colIdx] || '');

          // If formula exists (e.g. =+91... or =98765...) or value shows #ERROR!
          if (formula || rawVal.indexOf('#ERROR!') !== -1 || rawVal.charAt(0) === '+') {
            var cleanPhone = '98765432' + (r < 10 ? '0' + r : r);
            if (rawVal.indexOf('#ERROR!') === -1 && rawVal) {
              cleanPhone = rawVal.replace(/[^\d]/g, '');
              if (cleanPhone.length > 10) cleanPhone = cleanPhone.slice(-10);
            }
            studentsSheet.getRange(r + 1, colIdx + 1).setValue(cleanPhone || '9876543210');
            hasChanges = true;
          }
        }
      }

      if (hasChanges) {
        Logger.log('Fixed formula parse errors in Students mobile number columns.');
      }
    } catch (e) {
      Logger.log('Error cleaning mobile formula errors: ' + e.message);
    }
  }

  /**
   * Seeds demo institutional configuration and accounts
   */
  function seedDefaultData() {
    return resetAndSeedLargeDataset(120);
  }

  /**
   * Completely resets database and seeds 100-150 realistic applicants including sumit.student@hostel360.test
   */
  function resetAndSeedLargeDataset(targetApplicantCount) {
    targetApplicantCount = targetApplicantCount || 120;
    var nowIso = new Date().toISOString();
    var academicYear = '2026-27';

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    if (!ss) {
      throw new Error('SpreadsheetApp.getActiveSpreadsheet() returned null.');
    }

    // Ensure all 17 tables and headers exist
    initializeDatabase();

    // 1. Clear transactional sheets completely (keep headers in row 1)
    var sheetsToClear = [
      'Allocations', 'Waitlist', 'Payments', 'Notifications', 'AuditLog',
      'Preferences', 'Documents', 'Applications', 'Students', 'Users',
      'Rooms', 'Beds', 'Hostels', 'ReservationRules', 'PriorityRules', 'Policies', 'AcademicYears'
    ];

    for (var sc = 0; sc < sheetsToClear.length; sc++) {
      var sName = sheetsToClear[sc];
      var sheet = ss.getSheetByName(sName);
      if (sheet && sheet.getLastRow() > 1) {
        sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).clearContent();
      }
    }

    // 2. Seed Academic Year
    SheetRepository.insertRecord(SheetRepository.SHEETS.ACADEMIC_YEARS, {
      YearID: 'AY_2026_27',
      AcademicYear: academicYear,
      StartDate: '2026-08-01',
      EndDate: '2027-05-31',
      ApplicationStartDate: '2026-08-01',
      ApplicationDeadline: '2026-10-31',
      IsActive: true,
      Status: 'ACTIVE',
      CreatedAt: nowIso
    });

    // 3. Seed Hostels & 80 Single-Occupancy Rooms (4 Hostels x 20 Rooms = 80 Total Capacity)
    var defaultHostels = [
      { HostelID: 'HST_SHIVALIK', Name: 'Shivalik Hostel', Code: 'BH-I', Gender: 'BOYS', TotalFloors: 4, TotalRooms: 20, Status: 'ACTIVE', Description: 'Senior Boys Single-Occupancy Residence' },
      { HostelID: 'HST_ARAVALI', Name: 'Aravali Hostel', Code: 'BH-II', Gender: 'BOYS', TotalFloors: 4, TotalRooms: 20, Status: 'ACTIVE', Description: 'Junior Boys Single-Occupancy Residence' },
      { HostelID: 'HST_SATPURA', Name: 'Satpura Hostel', Code: 'GH-I', Gender: 'GIRLS', TotalFloors: 4, TotalRooms: 20, Status: 'ACTIVE', Description: 'Senior Girls Single-Occupancy Residence' },
      { HostelID: 'HST_NILGIRI', Name: 'Nilgiri Hostel', Code: 'GH-II', Gender: 'GIRLS', TotalFloors: 4, TotalRooms: 20, Status: 'ACTIVE', Description: 'Junior Girls Single-Occupancy Residence' }
    ];

    for (var h = 0; h < defaultHostels.length; h++) {
      var hItem = defaultHostels[h];
      SheetRepository.insertRecord(SheetRepository.SHEETS.HOSTELS, hItem);

      var roomsBatch = [];
      var bedsBatch = [];
      // 4 floors x 5 rooms per floor = 20 single rooms
      for (var fl = 1; fl <= 4; fl++) {
        for (var rm = 1; rm <= 5; rm++) {
          var roomNum = (fl * 100) + rm;
          var roomId = 'RM_' + hItem.Code.replace('-', '') + '_' + roomNum;
          roomsBatch.push({
            RoomID: roomId,
            HostelID: hItem.HostelID,
            FloorNumber: fl,
            RoomNumber: roomNum,
            Capacity: 1, // Strictly single occupancy
            OccupancyStatus: 'AVAILABLE',
            Status: 'ACTIVE',
            Remarks: 'Single Occupancy Room'
          });
          bedsBatch.push({
            BedID: 'BED_' + roomId,
            RoomID: roomId,
            HostelID: hItem.HostelID,
            BedNumber: '1',
            Status: 'AVAILABLE',
            CurrentStudentID: ''
          });
        }
      }
      SheetRepository.batchInsertRecords(SheetRepository.SHEETS.ROOMS, roomsBatch);
      SheetRepository.batchInsertRecords(SheetRepository.SHEETS.BEDS, bedsBatch);
    }

    // 4. Seed Dynamic Statutory Quota Rules (scaled for 80 single rooms)
    var defaultReservation = [
      { RuleID: 'RR_GEN', AcademicYear: academicYear, Category: 'GENERAL', Percentage: 40.5, SeatCount: 32, UsedSeats: 0, RemainingSeats: 32, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_OBC', AcademicYear: academicYear, Category: 'OBC', Percentage: 27.0, SeatCount: 22, UsedSeats: 0, RemainingSeats: 22, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_SC', AcademicYear: academicYear, Category: 'SC', Percentage: 15.0, SeatCount: 12, UsedSeats: 0, RemainingSeats: 12, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_EWS', AcademicYear: academicYear, Category: 'EWS', Percentage: 10.0, SeatCount: 8, UsedSeats: 0, RemainingSeats: 8, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_ST', AcademicYear: academicYear, Category: 'ST', Percentage: 7.5, SeatCount: 6, UsedSeats: 0, RemainingSeats: 6, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_PWD', AcademicYear: academicYear, Category: 'PWD', Percentage: 5.0, SeatCount: 4, UsedSeats: 0, RemainingSeats: 4, Status: 'ACTIVE', UpdatedAt: nowIso },
      { RuleID: 'RR_FOREIGN', AcademicYear: academicYear, Category: 'FOREIGN', Percentage: 5.0, SeatCount: 4, UsedSeats: 0, RemainingSeats: 4, Status: 'ACTIVE', UpdatedAt: nowIso }
    ];

    for (var r = 0; r < defaultReservation.length; r++) {
      SheetRepository.insertRecord(SheetRepository.SHEETS.RESERVATION_RULES, defaultReservation[r]);
    }

    // 5. Seed Dynamic Priority Rules (6-Tier Strict Hierarchy)
    var defaultPriority = [
      { RuleID: 'PR_1', AcademicYear: academicYear, PriorityGroup: 'GROUP_1', GroupName: 'Specially-abled / PwD Students', Description: 'Differently-abled students with valid verified PwD certification', OrderRank: 1, Status: 'ACTIVE' },
      { RuleID: 'PR_2', AcademicYear: academicYear, PriorityGroup: 'GROUP_2', GroupName: 'Outside Delhi (OD) - Outstation Residence', Description: 'Outside Delhi category with permanent residence outside Delhi/NCR', OrderRank: 2, Status: 'ACTIVE' },
      { RuleID: 'PR_3', AcademicYear: academicYear, PriorityGroup: 'GROUP_3', GroupName: 'Delhi Category - Outstation Residence', Description: 'Delhi category with permanent residence outside Delhi/NCR', OrderRank: 3, Status: 'ACTIVE' },
      { RuleID: 'PR_4', AcademicYear: academicYear, PriorityGroup: 'GROUP_4', GroupName: 'Delhi Category - Parents Posted Outside NCR', Description: 'Delhi category students whose parents are posted outside NCR', OrderRank: 4, Status: 'ACTIVE' },
      { RuleID: 'PR_5', AcademicYear: academicYear, PriorityGroup: 'GROUP_5', GroupName: 'Delhi/OD - NCR Residents', Description: 'Delhi/OD students residing within Delhi-NCR boundaries', OrderRank: 5, Status: 'ACTIVE' },
      { RuleID: 'PR_6', AcademicYear: academicYear, PriorityGroup: 'GROUP_6', GroupName: 'Remaining Applicable Students', Description: 'All other eligible students ordered by distance from Dwarka campus', OrderRank: 6, Status: 'ACTIVE' }
    ];

    for (var p = 0; p < defaultPriority.length; p++) {
      SheetRepository.insertRecord(SheetRepository.SHEETS.PRIORITY_RULES, defaultPriority[p]);
    }

    // 6. Seed Master Policies
    var defaultPolicies = [
      { PolicyID: 'POL_FEE', AcademicYear: academicYear, PolicyKey: 'HOSTEL_FEE_AMOUNT', PolicyValue: '35000', Description: 'Annual hostel accommodation fee in INR', UpdatedAt: nowIso, UpdatedBy: 'System' },
      { PolicyID: 'POL_DEADLINE_DAYS', AcademicYear: academicYear, PolicyKey: 'REPORTING_DEADLINE_DAYS', PolicyValue: '3', Description: 'Days allowed for fee payment & physical reporting before seat lapses', UpdatedAt: nowIso, UpdatedBy: 'System' },
      { PolicyID: 'POL_FQ', AcademicYear: academicYear, PolicyKey: 'FOREIGN_STUDENT_QUOTA_PCT', PolicyValue: '5', Description: 'Percentage quota reserved for international students', UpdatedAt: nowIso, UpdatedBy: 'System' },
      { PolicyID: 'POL_DOCS', AcademicYear: academicYear, PolicyKey: 'MANDATORY_DOCUMENTS', PolicyValue: 'ADMISSION_FEE_RECEIPT,MEDICAL_FITNESS,PERMANENT_ADDRESS_PROOF,PARENT_UNDERTAKING,STUDENT_UNDERTAKING', Description: 'Comma-separated list of mandatory document types', UpdatedAt: nowIso, UpdatedBy: 'System' }
    ];

    for (var pol = 0; pol < defaultPolicies.length; pol++) {
      SheetRepository.insertRecord(SheetRepository.SHEETS.POLICIES, defaultPolicies[pol]);
    }

    // 7. Seed Chief Warden Account
    var wardenEmail = 'warden.demo@hostel360.test';
    var wardenSalt = AuthService.generateSalt();
    var wardenHash = AuthService.hashPassword('Warden@123', wardenSalt);
    SheetRepository.insertRecord(SheetRepository.SHEETS.USERS, {
      UserID: 'USR_WARDEN_DEMO',
      Email: wardenEmail,
      PasswordHash: wardenHash,
      Salt: wardenSalt,
      Role: 'WARDEN',
      StudentID: '',
      Name: 'Prof. Rajesh Sharma (Chief Warden)',
      Status: 'ACTIVE',
      CreatedAt: nowIso,
      LastLogin: ''
    });

    // 8. Seed Hero Primary Student: sumit.student@hostel360.test (Unsubmitted Application for Live Demo)
    var heroEmail = 'sumit.student@hostel360.test';
    var heroStudentId = 'STU_2026_001';
    var heroAppId = 'APP_2026_001';
    var heroSalt = AuthService.generateSalt();
    var heroHash = AuthService.hashPassword('Student@123', heroSalt);

    SheetRepository.insertRecord(SheetRepository.SHEETS.USERS, {
      UserID: 'USR_STU_HERO_001',
      Email: heroEmail,
      PasswordHash: heroHash,
      Salt: heroSalt,
      Role: 'STUDENT',
      StudentID: heroStudentId,
      Name: 'Sumit Kumar',
      Status: 'ACTIVE',
      CreatedAt: nowIso,
      LastLogin: ''
    });

    SheetRepository.insertRecord(SheetRepository.SHEETS.STUDENTS, {
      StudentID: heroStudentId,
      UserID: 'USR_STU_HERO_001',
      EnrollmentNo: '04516403226',
      Name: 'Sumit Kumar',
      DateOfBirth: '2004-06-15',
      Gender: 'MALE',
      Nationality: 'INDIAN',
      Programme: 'B.Tech Computer Science & Engineering',
      Department: 'University School of Information, Communication & Technology (USICT)',
      JoiningDate: '2026-08-01',
      Category: 'GENERAL',
      AdmissionCategory: 'OUTSIDE_DELHI',
      RegionType: 'OUTSIDE_DELHI',
      IsDelhiNCRResident: false,
      IsParentPostedOutsideNCR: false,
      IsPwD: false,
      StudentEmail: heroEmail,
      StudentMobile: '9876543210',
      ParentName: 'Ramesh Gupta',
      ParentMobile: '9876543211',
      PermanentAddress: 'House 42, MG Road, Indiranagar',
      PermanentCity: 'Bengaluru',
      PermanentState: 'KARNATAKA',
      PermanentPincode: '560038',
      DistanceKm: 2150,
      LocalGuardianName: 'Mahesh Sharma',
      LocalGuardianContact: '9876543212',
      EmergencyContact: '9876543210',
      CreatedAt: nowIso,
      UpdatedAt: nowIso
    });

    // Note: Application record for sumit.student@hostel360.test is NOT inserted here so you can submit it LIVE in the demo as applicant #120!

    // Seed documents for hero student: 4 pre-verified, 1 document (Student Undertaking) uploaded pending review for live Warden audit demo
    var heroDocs = ['ADMISSION_FEE_RECEIPT', 'MEDICAL_FITNESS', 'PERMANENT_ADDRESS_PROOF', 'PARENT_UNDERTAKING', 'STUDENT_UNDERTAKING'];
    var heroDocsBatch = heroDocs.map(function (dt, idx) {
      var isPendingDoc = (dt === 'STUDENT_UNDERTAKING');
      return {
        DocumentID: 'DOC_' + heroStudentId + '_' + idx,
        ApplicationID: heroAppId,
        StudentID: heroStudentId,
        DocumentType: dt,
        DriveFileID: 'demo_file_' + heroStudentId + '_' + idx,
        DriveURL: 'https://drive.google.com',
        UploadedAt: nowIso,
        VerificationStatus: isPendingDoc ? 'PENDING' : 'VERIFIED',
        VerifiedBy: isPendingDoc ? '' : 'warden.demo@hostel360.test',
        VerifiedAt: isPendingDoc ? '' : nowIso,
        Remarks: isPendingDoc ? 'Uploaded' : 'Pre-verified for demo presentation'
      };
    });
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.DOCUMENTS, heroDocsBatch);

    // 9. Generate Exactly 119 Pre-Submitted Student Applications (59 Boys + 60 Girls)
    generateDiverseApplicants(119, academicYear, nowIso);

    // Clean any formula errors that might exist in phone columns
    cleanMobileFormulaErrors();

    // Log initialization in AuditLog
    AuditService.logAction(
      'SYSTEM',
      'system@hostel360.internal',
      'SYSTEM',
      'SYSTEM_INITIALIZATION',
      'Database',
      'HOSTEL360_DB',
      null,
      { academicYear: academicYear, hostelsCount: 4, roomsCount: 80, preSubmittedApplicants: 119 },
      'HOSTEL 360 database reset: 119 applications pre-submitted; 120th ready for live submission by ' + heroEmail,
      'SUCCESS'
    );

    return {
      success: true,
      message: 'HOSTEL 360 reset: 119 applications pre-submitted. 120th ready for live submission by ' + heroEmail,
      accounts: {
        heroStudent: { email: heroEmail, password: 'Student@123', role: 'STUDENT', name: 'Sumit Kumar', studentId: heroStudentId, status: 'READY_FOR_LIVE_SUBMISSION' },
        warden: { email: wardenEmail, password: 'Warden@123', role: 'WARDEN', name: 'Prof. Rajesh Sharma' }
      }
    };
  }

  /**
   * Generates a realistic synthetic cohort of students across genders, categories, cities, and priority tiers
   */
  function generateDiverseApplicants(count, academicYear, nowIso) {
    var boyFirstNames = ['Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh', 'Ayaan', 'Krishna', 'Ishaan', 'Shaurya', 'Atharva', 'Advik', 'Pranav', 'Kabir', 'Rudra', 'Ayush', 'Rohan', 'Dhruv', 'Kavya', 'Tenzin', 'Nikhil', 'Harsh', 'Manish', 'Siddharth', 'Utkarsh', 'Yash', 'Varun', 'Karan', 'Dev'];
    var girlFirstNames = ['Aanya', 'Diya', 'Gauri', 'Ananya', 'Pari', 'Saanvi', 'Myra', 'Anaya', 'Aarohi', 'Advika', 'Ira', 'Avani', 'Tara', 'Riya', 'Ishita', 'Sneha', 'Pooja', 'Meera', 'Kritika', 'Nandini', 'Shruti', 'Simran', 'Tanvi', 'Vanshika', 'Aditi', 'Divya', 'Khushi', 'Neha', 'Prisha', 'Zoya'];
    var lastNames = ['Sharma', 'Verma', 'Gupta', 'Malhotra', 'Mehra', 'Singhal', 'Yadav', 'Kumar', 'Singh', 'Patel', 'Choudhary', 'Mishra', 'Joshi', 'Bhatia', 'Saxena', 'Kapoor', 'Reddy', 'Nair', 'Das', 'Sen', 'Banerjee', 'Rathore', 'Chauhan', 'Rawat', 'Thakur'];

    var cities = [
      { city: 'Patna', state: 'BIHAR', dist: 1050, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Lucknow', state: 'UTTAR PRADESH', dist: 550, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Varanasi', state: 'UTTAR PRADESH', dist: 820, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Chandigarh', state: 'PUNJAB', dist: 250, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Dehradun', state: 'UTTARAKHAND', dist: 260, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Bhopal', state: 'MADHYA PRADESH', dist: 780, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Kolkata', state: 'WEST BENGAL', dist: 1480, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Bengaluru', state: 'KARNATAKA', dist: 2150, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Pune', state: 'MAHARASHTRA', dist: 1420, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Hyderabad', state: 'TELANGANA', dist: 1560, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Guwahati', state: 'ASSAM', dist: 1900, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Shimla', state: 'HIMACHAL PRADESH', dist: 360, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Ranchi', state: 'JHARKHAND', dist: 1220, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Ahmedabad', state: 'GUJARAT', dist: 940, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Jammu', state: 'JAMMU & KASHMIR', dist: 600, reg: 'OUTSIDE_DELHI', ncr: false },
      { city: 'Thimphu', state: 'BHUTAN', dist: 1250, reg: 'OUTSIDE_DELHI', ncr: false },
      // Delhi Region Outstation & NCR
      { city: 'Delhi (East)', state: 'DELHI', dist: 32, reg: 'DELHI', ncr: true },
      { city: 'Noida', state: 'UTTAR PRADESH', dist: 42, reg: 'DELHI', ncr: true },
      { city: 'Gurgaon', state: 'HARYANA', dist: 28, reg: 'DELHI', ncr: true },
      { city: 'Faridabad', state: 'HARYANA', dist: 38, reg: 'DELHI', ncr: true },
      { city: 'Ghaziabad', state: 'UTTAR PRADESH', dist: 48, reg: 'DELHI', ncr: true },
      { city: 'New Delhi (Central)', state: 'DELHI', dist: 22, reg: 'DELHI', ncr: true }
    ];

    var categories = ['GENERAL', 'OBC', 'SC', 'ST', 'EWS', 'PWD', 'FOREIGN'];
    var categoryWeights = [35, 25, 15, 8, 10, 4, 3]; // Percentage distribution

    var usersBatch = [];
    var studentsBatch = [];
    var appsBatch = [];
    var docsBatch = [];

    var defaultSalt = AuthService.generateSalt();
    var defaultHash = AuthService.hashPassword('Student@123', defaultSalt);

    var halfCount = Math.floor(count / 2);

    for (var i = 0; i < count; i++) {
      var isMale = (i < halfCount);
      var gender = isMale ? 'MALE' : 'FEMALE';
      var fNames = isMale ? boyFirstNames : girlFirstNames;
      var fName = fNames[i % fNames.length];
      var lName = lastNames[(i * 3 + Math.floor(i / 2)) % lastNames.length];
      var fullName = fName + ' ' + lName;

      var stuNum = i + 2;
      var stuId = 'STU_2026_' + (stuNum < 10 ? '00' + stuNum : (stuNum < 100 ? '0' + stuNum : stuNum));
      var appId = 'APP_2026_' + (stuNum < 10 ? '00' + stuNum : (stuNum < 100 ? '0' + stuNum : stuNum));
      var email = fName.toLowerCase() + '.' + lName.toLowerCase() + stuNum + '@hostel360.test';

      // Pick City & Region
      var cityObj = cities[i % cities.length];
      var isNcr = cityObj.ncr;
      var reg = cityObj.reg;
      var dist = cityObj.dist + ((i * 7) % 50);

      // Pick Category
      var catRand = (i * 13) % 100;
      var chosenCat = 'GENERAL';
      var cum = 0;
      for (var cIdx = 0; cIdx < categories.length; cIdx++) {
        cum += categoryWeights[cIdx];
        if (catRand < cum) {
          chosenCat = categories[cIdx];
          break;
        }
      }

      var isPwd = (chosenCat === 'PWD');
      var isForeign = (chosenCat === 'FOREIGN');

      // Determine Priority Tier
      var pGroup = 'GROUP_2';
      var pScore = 2;
      if (isPwd) {
        pGroup = 'GROUP_1';
        pScore = 1;
      } else if (isNcr) {
        pGroup = 'GROUP_5';
        pScore = 5;
      } else if (reg === 'DELHI') {
        pGroup = (i % 4 === 0) ? 'GROUP_4' : 'GROUP_3';
        pScore = (pGroup === 'GROUP_4') ? 4 : 3;
      } else {
        pGroup = 'GROUP_2';
        pScore = 2;
      }

      // Hostel Preferences
      var pref1 = isMale ? 'HST_SHIVALIK' : 'HST_SATPURA';
      var pref2 = isMale ? 'HST_ARAVALI' : 'HST_NILGIRI';
      if (i % 2 === 1) {
        pref1 = isMale ? 'HST_ARAVALI' : 'HST_NILGIRI';
        pref2 = isMale ? 'HST_SHIVALIK' : 'HST_SATPURA';
      }

      // Specific Deterministic Setup for Aarav Sharma (i = 0):
      // Placed in Group 5 (Local Delhi-NCR resident, 18 km) so he deterministically lands on the WAITLIST
      if (i === 0) {
        fullName = 'Aarav Sharma';
        email = 'aarav.sharma2@hostel360.test';
        chosenCat = 'GENERAL';
        isPwd = false;
        isForeign = false;
        isNcr = true;
        reg = 'DELHI';
        cityObj = { city: 'New Delhi', state: 'DELHI', dist: 18, reg: 'DELHI', ncr: true };
        dist = 18;
        pGroup = 'GROUP_5';
        pScore = 5;
        pref1 = 'HST_SHIVALIK';
        pref2 = 'HST_ARAVALI';
      }

      // User Record
      usersBatch.push({
        UserID: 'USR_' + stuId,
        Email: email,
        PasswordHash: defaultHash,
        Salt: defaultSalt,
        Role: 'STUDENT',
        StudentID: stuId,
        Name: fullName,
        Status: 'ACTIVE',
        CreatedAt: nowIso,
        LastLogin: ''
      });

      // Student Profile Record
      var rollNum = '05' + (100 + i) + '6403226';
      studentsBatch.push({
        StudentID: stuId,
        UserID: 'USR_' + stuId,
        EnrollmentNo: rollNum,
        Name: fullName,
        DateOfBirth: '2004-04-' + ((i % 25) + 1),
        Gender: gender,
        Nationality: isForeign ? 'BHUTANESE' : 'INDIAN',
        Programme: (i % 3 === 0) ? 'B.Tech CSE' : ((i % 3 === 1) ? 'B.Tech IT' : 'B.Tech ECE'),
        Department: 'USICT',
        JoiningDate: '2026-08-01',
        Category: chosenCat,
        AdmissionCategory: reg,
        RegionType: reg,
        IsDelhiNCRResident: isNcr,
        IsParentPostedOutsideNCR: (pGroup === 'GROUP_4'),
        IsPwD: isPwd,
        StudentEmail: email,
        StudentMobile: '987654' + (1000 + i),
        ParentName: 'Parent of ' + fullName,
        ParentMobile: '987653' + (1000 + i),
        PermanentAddress: 'House ' + (i + 1) + ', ' + cityObj.city + ' Sector ' + (i % 12 + 1),
        PermanentCity: cityObj.city,
        PermanentState: cityObj.state,
        PermanentPincode: '1100' + (i < 10 ? '0' + i : i),
        DistanceKm: dist,
        LocalGuardianName: 'Guardian of ' + fullName,
        LocalGuardianContact: '987652' + (1000 + i),
        EmergencyContact: '987654' + (1000 + i),
        CreatedAt: nowIso,
        UpdatedAt: nowIso
      });

      // Application Record
      appsBatch.push({
        ApplicationID: appId,
        StudentID: stuId,
        AcademicYear: academicYear,
        SubmissionDate: nowIso,
        Status: 'SUBMITTED',
        EligibilityStatus: 'ELIGIBLE',
        EligibilityRemarks: 'Automated verification check passed',
        PriorityGroup: pGroup,
        PriorityScore: pScore,
        CalculatedDistance: dist,
        FirstHostelPref: pref1,
        SecondHostelPref: pref2,
        NoPreference: false,
        RegistrationStatus: 'PENDING',
        RegisteredAt: '',
        VerifiedBy: 'warden.demo@hostel360.test',
        VerifiedAt: nowIso,
        Remarks: 'Demo Cohort Applicant #' + (i + 1),
        CreatedAt: nowIso,
        UpdatedAt: nowIso
      });

      // Category-Specific Verified Documents strictly complying with Hostel Brochure norms
      var docTypes = ['ADMISSION_FEE_RECEIPT', 'MEDICAL_FITNESS', 'PERMANENT_ADDRESS_PROOF', 'PARENT_UNDERTAKING', 'STUDENT_UNDERTAKING'];
      if (isPwd) docTypes.push('PWD_CERTIFICATE');
      if (chosenCat === 'SC') docTypes.push('SC_CERTIFICATE');
      if (chosenCat === 'ST') docTypes.push('ST_CERTIFICATE');
      if (chosenCat === 'OBC') docTypes.push('OBC_NCL_CERTIFICATE');
      if (chosenCat === 'EWS') docTypes.push('EWS_CERTIFICATE');
      if (isForeign) docTypes.push('PASSPORT_AND_VISA');
      if (pGroup === 'GROUP_4') docTypes.push('PARENT_POSTING_CERTIFICATE');

      for (var d = 0; d < docTypes.length; d++) {
        docsBatch.push({
          DocumentID: 'DOC_' + stuId + '_' + d,
          ApplicationID: appId,
          StudentID: stuId,
          DocumentType: docTypes[d],
          DriveFileID: 'demo_file_' + stuId + '_' + d,
          DriveURL: 'https://drive.google.com',
          UploadedAt: nowIso,
          VerificationStatus: 'VERIFIED',
          VerifiedBy: 'warden.demo@hostel360.test',
          VerifiedAt: nowIso,
          Remarks: 'Verified in setup'
        });
      }
    }

    // Insert all records in batches
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.USERS, usersBatch);
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.STUDENTS, studentsBatch);
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.APPLICATIONS, appsBatch);
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.DOCUMENTS, docsBatch);
  }

  /**
   * Top-level entrypoint for system setup
   */
  function setupHostel360() {
    initializeDatabase();
    return seedDefaultData();
  }

  /**
   * Seeds historical synthetic memory events into Hindsight memory bank for Smriti.
   * Idempotent: checks Script Property SMRITI_HISTORY_SEEDED.
   * Retains ~45 realistic synthetic events across academic years 2024-25 and 2025-26.
   *
   * @param {boolean} [force=false] - If true, bypasses idempotency check and re-seeds
   * @returns {{ ok: boolean, count?: number, alreadySeeded?: boolean, error?: string }}
   */
  function seedSmritiHistory(force) {
    var props = PropertiesService.getScriptProperties();
    var isSeeded = props.getProperty('SMRITI_HISTORY_SEEDED');
    if (!force && (isSeeded === 'true' || isSeeded === true)) {
      Logger.log('Smriti history already seeded. Pass force=true to re-seed.');
      return { ok: true, alreadySeeded: true, message: 'Smriti history already seeded.' };
    }

    if (typeof MemoryService === 'undefined' || !MemoryService.smritiRetainBatch) {
      return { ok: false, error: 'MemoryService is not available.' };
    }

    var events = [
      // --- PATTERN 1: DOMICILE CERTIFICATE REJECTIONS (ADDRESS MISMATCH) ---
      {
        content: 'In academic year 2024-25, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Permanent address in application did not match the issuing authority district on the domicile certificate.',
        context: 'document_rejection',
        timestamp: '2024-08-14T10:15:00.000Z'
      },
      {
        content: 'In academic year 2024-25, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Address mismatch between applicant declared residence in Delhi NCR and uploaded domicile certificate issued in Uttar Pradesh.',
        context: 'document_rejection',
        timestamp: '2024-08-20T11:30:00.000Z'
      },
      {
        content: 'In academic year 2024-25, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Domicile certificate issued for ancestral village address outside state, conflicting with declared local permanent residence.',
        context: 'document_rejection',
        timestamp: '2024-08-28T14:45:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Permanent address in application did not match the issuing authority district on the domicile certificate.',
        context: 'document_rejection',
        timestamp: '2025-08-15T09:40:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Address mismatch: Domicile proof registered under maternal grandfather address with differing postal district.',
        context: 'document_rejection',
        timestamp: '2025-08-22T12:10:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Permanent address declared in application form differed from village and tehsil stamped on state domicile certificate.',
        context: 'document_rejection',
        timestamp: '2025-08-29T15:20:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type DOMICILE_CERTIFICATE was rejected. Rejection reason: Address mismatch between Aadhaar card copy and regional domicile certificate district jurisdiction.',
        context: 'document_rejection',
        timestamp: '2025-09-05T16:00:00.000Z'
      },

      // --- PATTERN 2: PwD OVERRIDES APPROVED FOR LATE MEDICAL CERTIFICATES ---
      {
        content: 'In academic year 2024-25, manual override approved for student in category PwD, priority Priority 1 - Divyangjan from hostel BH1 to BH1 Room 102. Reason: Student has 60% locomotor disability; civil hospital medical board certificate was delayed due to government hospital staff strike, verified genuine by University Medical Officer.',
        context: 'manual_override',
        timestamp: '2024-09-10T11:00:00.000Z'
      },
      {
        content: 'In academic year 2024-25, manual override approved for student in category PwD, priority Priority 1 - Divyangjan from hostel GH1 to GH1 Room 101. Reason: Late submission of disability certificate due to orthopedic surgery rehabilitation; warden approved ground floor single room placement on humanitarian grounds.',
        context: 'manual_override',
        timestamp: '2024-09-14T14:20:00.000Z'
      },
      {
        content: 'In academic year 2025-26, manual override approved for student in category PwD, priority Priority 1 - Divyangjan from hostel BH1 to BH1 Ground Floor Room 104. Reason: Student has severe mobility impairment; government medical board disability certificate was issued late due to civil hospital backlog, validated by university health centre.',
        context: 'manual_override',
        timestamp: '2025-09-12T10:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, manual override approved for student in category PwD, priority Priority 1 - Divyangjan from hostel GH2 to GH2 Room 103. Reason: Late medical board disability certificate renewal submitted with hospital verification slip; approved ground floor single room with ramp access.',
        context: 'manual_override',
        timestamp: '2025-09-16T15:10:00.000Z'
      },

      // --- PATTERN 3: RESERVED SEATS IN BH2 LAPSING AND RELEASED TO GENERAL ---
      {
        content: 'In academic year 2024-25, 3 unreported seat(s) in hostel BH2 lapsed due to non-reporting and unpaid fees within the institutional deadline for category ST.',
        context: 'lapse_unreported',
        timestamp: '2024-10-02T17:00:00.000Z'
      },
      {
        content: 'In academic year 2024-25, warden exercised quota release policy to transfer 3 lapsed ST seats in hostel BH2 to General pool after waitlist exhaustion.',
        context: 'quota_release',
        timestamp: '2024-10-05T11:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, 4 unreported seat(s) in hostel BH2 lapsed due to non-reporting and unpaid fees within the institutional deadline for category ST.',
        context: 'lapse_unreported',
        timestamp: '2025-10-04T17:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, warden released 4 vacant ST quota seats in hostel BH2 to General open merit pool following official notification and zero remaining ST waitlist applicants.',
        context: 'quota_release',
        timestamp: '2025-10-07T10:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, 2 unreported seat(s) in hostel BH2 lapsed due to unpaid fees within institutional deadline for category SC.',
        context: 'lapse_unreported',
        timestamp: '2025-10-12T18:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, warden released 2 vacant SC quota seats in hostel BH2 to General pool after all eligible waitlisted SC applicants were exhausted.',
        context: 'quota_release',
        timestamp: '2025-10-15T12:00:00.000Z'
      },

      // --- PATTERN 4: WAITLIST PROMOTIONS HAPPENING WITHIN 2-5 DAYS OF REPORTING DEADLINE ---
      {
        content: 'In academic year 2024-25, waitlist candidate in category GENERAL, priority Priority 4 - Distance-based was promoted from waitlist position #1 into newly vacant room in hostel BH1 following seat vacancy 3 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2024-10-03T09:30:00.000Z'
      },
      {
        content: 'In academic year 2024-25, waitlist candidate in category OBC-NCL, priority Priority 3 - Outstation was promoted from waitlist position #1 into newly vacant room in hostel GH1 following seat vacancy 2 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2024-10-04T10:15:00.000Z'
      },
      {
        content: 'In academic year 2024-25, waitlist candidate in category EWS, priority Priority 4 - Distance-based was promoted from waitlist position #2 into newly vacant room in hostel BH2 4 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2024-10-06T14:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, waitlist candidate in category GENERAL, priority Priority 4 - Distance-based was promoted from waitlist position #1 into newly vacant room in hostel BH1 following seat vacancy 2 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2025-10-05T09:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, waitlist candidate in category OBC-NCL, priority Priority 4 - Distance-based was promoted from waitlist position #1 into newly vacant room in hostel GH2 following seat vacancy 3 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2025-10-06T11:45:00.000Z'
      },
      {
        content: 'In academic year 2025-26, waitlist candidate in category GENERAL, priority Priority 3 - Outstation was promoted from waitlist position #2 into newly vacant room in hostel BH2 following seat vacancy 4 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2025-10-07T14:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, waitlist candidate in category EWS, priority Priority 4 - Distance-based was promoted from waitlist position #3 into newly vacant room in hostel BH1 5 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2025-10-08T16:00:00.000Z'
      },

      // --- ALLOCATION RUNS & OFFICIAL PUBLICATIONS ---
      {
        content: 'In academic year 2024-25, allocation run completed in DRAFT mode with 60 allotments (GENERAL: 30, OBC-NCL: 16, SC: 9, ST: 5) and 25 waitlisted applicants. 4 single rooms remain vacant.',
        context: 'allocation_run',
        timestamp: '2024-09-01T10:00:00.000Z'
      },
      {
        content: 'In academic year 2024-25, officially published 60 allocations and 25 waitlist entries. All 12 validation rules passed with zero warnings.',
        context: 'allocation_published',
        timestamp: '2024-09-03T16:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, allocation run completed in DRAFT mode with 68 allotments (GENERAL: 34, OBC-NCL: 18, SC: 10, ST: 6) and 32 waitlisted applicants. 2 single rooms remain vacant.',
        context: 'allocation_run',
        timestamp: '2025-09-01T10:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, officially published 68 allocations and 32 waitlist entries. Validator warnings: Single room occupancy verified; zero quota cross-allocation.',
        context: 'allocation_published',
        timestamp: '2025-09-03T17:00:00.000Z'
      },

      // --- OTHER PROCEDURAL PRECEDENTS ---
      {
        content: 'In academic year 2024-25, document of type INCOME_CERTIFICATE was rejected. Rejection reason: Gross family annual income exceeded 8 Lakh INR ceiling for EWS reservation tier.',
        context: 'document_rejection',
        timestamp: '2024-08-18T11:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type INCOME_CERTIFICATE was rejected. Rejection reason: Income certificate presented had expired prior to application opening date.',
        context: 'document_rejection',
        timestamp: '2025-08-19T14:15:00.000Z'
      },
      {
        content: 'In academic year 2024-25, manual override approved for student in category GENERAL, priority Priority 4 - Distance-based from hostel BH2 to BH1 Room 208. Reason: Student sustained knee ligament tear in university athletic trials, shifted to lower floor room with lift access.',
        context: 'manual_override',
        timestamp: '2024-10-18T11:45:00.000Z'
      },
      {
        content: 'In academic year 2025-26, manual override approved for student in category OBC-NCL, priority Priority 3 - Outstation from hostel GH1 to GH2 Room 215. Reason: Severe water seepage in GH1 Room 310 due to roof monsoon damage; shifted student to dry available room in GH2.',
        context: 'manual_override',
        timestamp: '2025-09-24T16:30:00.000Z'
      },
      {
        content: 'In academic year 2024-25, 2 unreported seat(s) in hostel GH1 lapsed due to non-reporting and unpaid fees within institutional deadline for category GENERAL.',
        context: 'lapse_unreported',
        timestamp: '2024-10-02T17:15:00.000Z'
      },
      {
        content: 'In academic year 2025-26, 1 unreported seat(s) in hostel GH2 lapsed due to non-reporting and unpaid fees within institutional deadline for category EWS.',
        context: 'lapse_unreported',
        timestamp: '2025-10-04T17:45:00.000Z'
      },
      {
        content: 'In academic year 2024-25, document of type PWD_CERTIFICATE was rejected. Rejection reason: Assessed permanent physical disability was below mandatory statutory 40% benchmark.',
        context: 'document_rejection',
        timestamp: '2024-08-25T13:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, document of type PWD_CERTIFICATE was rejected. Rejection reason: Submitted temporary disability slip from private clinic instead of statutory district medical board certificate.',
        context: 'document_rejection',
        timestamp: '2025-08-27T10:50:00.000Z'
      },
      {
        content: 'In academic year 2024-25, manual override approved for student in category SC, priority Priority 2 - Outstation from hostel BH1 to BH2 Room 106. Reason: Mutual room exchange request with consent due to same academic department research lab shift.',
        context: 'manual_override',
        timestamp: '2024-10-22T15:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, manual override approved for student in category GENERAL, priority Priority 1 - Divyangjan from hostel BH2 to BH2 Room 101. Reason: Visually impaired student placed in closest ground floor room adjacent to hostel entrance gate for safe mobility.',
        context: 'manual_override',
        timestamp: '2025-09-08T12:00:00.000Z'
      },
      {
        content: 'In academic year 2025-26, warden exercised quota release policy to transfer 1 lapsed EWS seat in hostel GH2 to General waitlist candidate following verification cutoff.',
        context: 'quota_release',
        timestamp: '2025-10-08T11:00:00.000Z'
      },
      {
        content: 'In academic year 2024-25, waitlist candidate in category GENERAL, priority Priority 4 - Distance-based was promoted from waitlist position #3 into newly vacant room in hostel BH1 5 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2024-10-07T12:30:00.000Z'
      },
      {
        content: 'In academic year 2025-26, waitlist candidate in category SC, priority Priority 3 - Outstation was promoted from waitlist position #1 into newly vacant room in hostel BH2 following seat vacancy 3 days after reporting deadline.',
        context: 'waitlist_promotion',
        timestamp: '2025-10-06T15:30:00.000Z'
      }
    ];

    Logger.log('Seeding ' + events.length + ' historical synthetic memory events for Smriti...');
    var res = MemoryService.smritiRetainBatch(events);

    if (res.ok) {
      props.setProperty('SMRITI_HISTORY_SEEDED', 'true');
      Logger.log('Smriti historical memory seeding completed successfully (' + res.count + ' events retained).');
    } else {
      Logger.log('Smriti historical memory seeding encountered issues: ' + res.error);
    }

    return res;
  }

  return {
    setupHostel360: setupHostel360,
    initializeDatabase: initializeDatabase,
    seedDefaultData: seedDefaultData,
    resetAndSeedLargeDataset: resetAndSeedLargeDataset,
    cleanMobileFormulaErrors: cleanMobileFormulaErrors,
    seedSmritiHistory: seedSmritiHistory
  };
})();

/**
 * Global function callable from Apps Script Editor to set up database & repair errors
 */
function setupHostel360() {
  return SetupService.setupHostel360();
}

/**
 * Global function callable from Apps Script Editor to seed historical synthetic Smriti memory
 */
function seedSmritiHistory(force) {
  return SetupService.seedSmritiHistory(force);
}

/**
 * Global function callable from Apps Script Editor to reset and seed 120 applicants with sumit.student@hostel360.test
 */
function resetAndSeed120Applicants() {
  var result = SetupService.resetAndSeedLargeDataset(120);
  Logger.log('====================================================');
  Logger.log('HOSTEL 360: 120 DEMO APPLICANTS SEEDED SUCCESSFULLY');
  Logger.log('Hero Student: ' + result.accounts.heroStudent.email + ' / ' + result.accounts.heroStudent.password);
  Logger.log('Chief Warden: ' + result.accounts.warden.email + ' / ' + result.accounts.warden.password);
  Logger.log('====================================================');
  return result;
}

/**
 * Global utility function to repair mobile formula parse errors in existing sheets
 */
function repairMobileFormulaErrors() {
  SetupService.cleanMobileFormulaErrors();
  Logger.log('Mobile number cells repaired successfully.');
}

