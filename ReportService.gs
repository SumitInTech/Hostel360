/**
 * HOSTEL 360 - ReportService.gs
 * Report generation engine supporting CSV export and structured printable data for all 8 institutional reports.
 */

var ReportService = (function () {

  /**
   * Helper to convert 2D array of headers and rows into CSV string
   */
  function arrayToCsv(headers, rows) {
    var escapeCsvCell = function (cell) {
      if (cell === null || cell === undefined) return '""';
      var str = String(cell);
      if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 || str.indexOf('\n') !== -1) {
        return '"' + str.replace(/"/g, '""') + '"';
      }
      return '"' + str + '"';
    };

    var lines = [];
    lines.push(headers.map(escapeCsvCell).join(','));

    for (var i = 0; i < rows.length; i++) {
      lines.push(rows[i].map(escapeCsvCell).join(','));
    }

    return lines.join('\r\n');
  }

  /**
   * 1. Applications Master Report
   */
  function generateApplicationsReport(academicYear) {
    var apps = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return !academicYear || a.AcademicYear === academicYear;
    });
    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];

    var headers = ['Application ID', 'Student ID', 'Enrollment No', 'Student Name', 'Gender', 'Programme', 'Category', 'Region', 'Distance (km)', 'Eligibility Status', 'Application Status', 'Submission Date'];
    var rows = [];

    for (var i = 0; i < apps.length; i++) {
      var a = apps[i];
      var st = stMap[a.StudentID] || {};
      rows.push([
        a.ApplicationID,
        a.StudentID,
        st.EnrollmentNo || '',
        st.Name || '',
        st.Gender || '',
        st.Programme || '',
        st.Category || '',
        st.RegionType || '',
        st.DistanceKm || '',
        a.EligibilityStatus || 'PENDING',
        a.Status || '',
        a.SubmissionDate || ''
      ]);
    }

    return {
      title: 'Hostel Applications Master Report',
      academicYear: academicYear || 'Current',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 2. Allocation Master Report
   */
  function generateAllocationReport(academicYear) {
    var allocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return !academicYear || a.AcademicYear === academicYear;
    });
    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var hostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var rooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);

    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];
    var hMap = {};
    for (var h = 0; h < hostels.length; h++) hMap[hostels[h].HostelID] = hostels[h];
    var rMap = {};
    for (var r = 0; r < rooms.length; r++) rMap[rooms[r].RoomID] = rooms[r];

    var headers = ['Allocation ID', 'Student ID', 'Student Name', 'Gender', 'Hostel Name', 'Room Number', 'Floor', 'Priority Tier', 'Quota Category', 'Status', 'Allotment Date', 'Manual Override'];
    var rows = [];

    for (var i = 0; i < allocations.length; i++) {
      var al = allocations[i];
      var st = stMap[al.StudentID] || {};
      var host = hMap[al.HostelID] || {};
      var rm = rMap[al.RoomID] || {};

      rows.push([
        al.AllocationID,
        al.StudentID,
        st.Name || '',
        st.Gender || '',
        host.Name || '',
        rm.RoomNumber || '',
        rm.FloorNumber || '',
        al.PriorityGroup || '',
        al.ReservationCategory || '',
        al.Status || '',
        al.AllocatedDate || '',
        (al.IsManualOverride === true || al.IsManualOverride === 'true') ? 'YES' : 'NO'
      ]);
    }

    return {
      title: 'Hostel Allotment Master Report',
      academicYear: academicYear || 'Current',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 3. Waitlist Report
   */
  function generateWaitlistReport(academicYear) {
    var waitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return (!academicYear || w.AcademicYear === academicYear) && w.Status === 'ACTIVE';
    });
    waitlist.sort(function (a, b) { return (parseInt(a.WaitlistPosition, 10) || 0) - (parseInt(b.WaitlistPosition, 10) || 0); });

    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];

    var headers = ['Position', 'Waitlist ID', 'Student ID', 'Student Name', 'Gender', 'Priority Group', 'Category', 'Distance (km)', 'Reason', 'Date Added'];
    var rows = [];

    for (var i = 0; i < waitlist.length; i++) {
      var wl = waitlist[i];
      var st = stMap[wl.StudentID] || {};

      rows.push([
        wl.WaitlistPosition,
        wl.WaitlistID,
        wl.StudentID,
        st.Name || '',
        st.Gender || '',
        wl.PriorityGroup || '',
        st.Category || '',
        st.DistanceKm || '',
        wl.Reason || '',
        wl.CreatedAt || ''
      ]);
    }

    return {
      title: 'Hostel Official Waitlist Report',
      academicYear: academicYear || 'Current',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 4. Occupancy Report
   */
  function generateOccupancyReport() {
    var hostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var rooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
    var allocations = SheetRepository.getAllRecords(SheetRepository.SHEETS.ALLOCATIONS);
    var published = allocations.filter(function (a) { return a.Status === 'PUBLISHED'; });

    var headers = ['Hostel Name', 'Code', 'Gender', 'Total Rooms', 'Occupied Rooms', 'Available Rooms', 'Maintenance Rooms', 'Occupancy Rate (%)'];
    var rows = [];

    for (var h = 0; h < hostels.length; h++) {
      var host = hostels[h];
      var hRooms = rooms.filter(function (r) { return r.HostelID === host.HostelID; });
      var total = hRooms.length;
      var occupied = hRooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'OCCUPIED'; }).length;
      var avail = hRooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'AVAILABLE'; }).length;
      var maint = hRooms.filter(function (r) { return String(r.OccupancyStatus).toUpperCase() === 'MAINTENANCE'; }).length;
      var rate = total > 0 ? Math.round((occupied / total) * 100) : 0;

      rows.push([
        host.Name,
        host.Code,
        host.Gender,
        total,
        occupied,
        avail,
        maint,
        rate + '%'
      ]);
    }

    return {
      title: 'Hostel Occupancy & Capacity Report',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 5. Reservation Quota Report
   */
  function generateReservationReport(academicYear) {
    var rules = SheetRepository.findRecords(SheetRepository.SHEETS.RESERVATION_RULES, function (r) {
      return !academicYear || r.AcademicYear === academicYear;
    });

    var headers = ['Category', 'Percentage (%)', 'Seat Quota Count', 'Used Seats', 'Remaining Vacant Seats', 'Status'];
    var rows = [];

    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      rows.push([
        r.Category,
        r.Percentage + '%',
        r.SeatCount,
        r.UsedSeats,
        r.RemainingSeats,
        r.Status
      ]);
    }

    return {
      title: 'Reservation Quota Utilization Report',
      academicYear: academicYear || 'Current',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 6. Payment Reconciliation Report
   */
  function generatePaymentReport(academicYear) {
    var payments = SheetRepository.findRecords(SheetRepository.SHEETS.PAYMENTS, function (p) {
      return !academicYear || p.AcademicYear === academicYear;
    });
    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];

    var headers = ['Payment ID', 'Student ID', 'Student Name', 'Amount (INR)', 'Payment Mode', 'Transaction Reference', 'Payment Date', 'Verification Status', 'Verified By'];
    var rows = [];

    for (var i = 0; i < payments.length; i++) {
      var p = payments[i];
      var st = stMap[p.StudentID] || {};
      rows.push([
        p.PaymentID,
        p.StudentID,
        st.Name || '',
        p.Amount,
        p.PaymentMode,
        p.TransactionReference,
        p.PaymentDate,
        p.Status,
        p.VerifiedBy || ''
      ]);
    }

    return {
      title: 'Hostel Fee Payment Reconciliation Report',
      academicYear: academicYear || 'Current',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 7. Document Verification Report
   */
  function generateDocumentReport() {
    var docs = SheetRepository.getAllRecords(SheetRepository.SHEETS.DOCUMENTS);
    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var stMap = {};
    for (var s = 0; s < students.length; s++) stMap[students[s].StudentID] = students[s];

    var headers = ['Document ID', 'Student ID', 'Student Name', 'Document Type', 'Status', 'Uploaded At', 'Verified By', 'Verified At', 'Remarks'];
    var rows = [];

    for (var i = 0; i < docs.length; i++) {
      var d = docs[i];
      var st = stMap[d.StudentID] || {};
      rows.push([
        d.DocumentID,
        d.StudentID,
        st.Name || '',
        d.DocumentType,
        d.VerificationStatus,
        d.UploadedAt,
        d.VerifiedBy || '',
        d.VerifiedAt || '',
        d.Remarks || ''
      ]);
    }

    return {
      title: 'Student Document Verification Audit Report',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * 8. System Audit Log Report
   */
  function generateAuditReport(limit) {
    var logs = AuditService.getAuditLogs(limit || 500);
    var headers = ['Audit ID', 'Timestamp', 'User ID', 'Email', 'Role', 'Action', 'Entity Type', 'Entity ID', 'Status', 'Reason'];
    var rows = [];

    for (var i = 0; i < logs.length; i++) {
      var l = logs[i];
      rows.push([
        l.AuditID,
        l.Timestamp,
        l.UserID,
        l.Email,
        l.Role,
        l.Action,
        l.EntityType,
        l.EntityID,
        l.Status,
        l.Reason
      ]);
    }

    return {
      title: 'System Administrative Audit Trail Report',
      headers: headers,
      rows: rows,
      csv: arrayToCsv(headers, rows)
    };
  }

  /**
   * Master dispatcher for report generation
   */
  function getReport(reportType, academicYear) {
    switch (String(reportType).toUpperCase()) {
      case 'APPLICATIONS':
        return generateApplicationsReport(academicYear);
      case 'ALLOCATIONS':
        return generateAllocationReport(academicYear);
      case 'WAITLIST':
        return generateWaitlistReport(academicYear);
      case 'OCCUPANCY':
        return generateOccupancyReport();
      case 'RESERVATIONS':
        return generateReservationReport(academicYear);
      case 'PAYMENTS':
        return generatePaymentReport(academicYear);
      case 'DOCUMENTS':
        return generateDocumentReport();
      case 'AUDIT':
        return generateAuditReport();
      default:
        throw new Error('Unknown report type: ' + reportType);
    }
  }

  return {
    getReport: getReport,
    generateApplicationsReport: generateApplicationsReport,
    generateAllocationReport: generateAllocationReport,
    generateWaitlistReport: generateWaitlistReport,
    generateOccupancyReport: generateOccupancyReport,
    generateReservationReport: generateReservationReport,
    generatePaymentReport: generatePaymentReport,
    generateDocumentReport: generateDocumentReport,
    generateAuditReport: generateAuditReport
  };
})();
