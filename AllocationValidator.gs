/**
 * HOSTEL 360 - AllocationValidator.gs
 * Comprehensive pre-publication validation engine.
 * Ensures zero data corruption, no double-allocations, and complete rule compliance.
 */

var AllocationValidator = (function () {

  /**
   * Validates an entire batch of allocations against all integrity and institutional rules
   *
   * @param {Array} allocations - Array of allocation records
   * @param {string} academicYear
   * @returns {Object} { valid: boolean, errors: string[], warnings: string[], stats: Object }
   */
  function validateAllocations(allocations, academicYear) {
    var errors = [];
    var warnings = [];
    var year = academicYear || PolicyEngine.getActiveAcademicYear().AcademicYear;

    var studentMap = {};
    var students = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    for (var s = 0; s < students.length; s++) {
      studentMap[students[s].StudentID] = students[s];
    }

    var hostelMap = {};
    var hostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    for (var h = 0; h < hostels.length; h++) {
      hostelMap[hostels[h].HostelID] = hostels[h];
    }

    var roomMap = {};
    var rooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
    for (var r = 0; r < rooms.length; r++) {
      roomMap[rooms[r].RoomID] = rooms[r];
    }

    var allocatedStudentIds = {};
    var allocatedRoomIds = {};
    var categoryCounts = {};
    var genderCounts = { BOYS: 0, GIRLS: 0 };

    for (var i = 0; i < allocations.length; i++) {
      var alloc = allocations[i];
      var indexStr = 'Allocation #' + (i + 1) + ' (ID: ' + (alloc.AllocationID || 'Draft') + '): ';

      // 1. Missing Student Check
      var student = studentMap[alloc.StudentID];
      if (!student) {
        errors.push(indexStr + 'Student ID "' + alloc.StudentID + '" does not exist in Students database.');
        continue;
      }

      // 2. Duplicate Student Allocation Check
      if (allocatedStudentIds[alloc.StudentID]) {
        errors.push(indexStr + 'Student ' + student.Name + ' (' + alloc.StudentID + ') is allocated more than once.');
      } else {
        allocatedStudentIds[alloc.StudentID] = alloc;
      }

      // 3. Missing Room Check
      var room = roomMap[alloc.RoomID];
      if (!room) {
        errors.push(indexStr + 'Room ID "' + alloc.RoomID + '" does not exist in Rooms database.');
        continue;
      }

      // 4. Duplicate Room Allocation Check (Single occupancy constraint)
      if (allocatedRoomIds[alloc.RoomID]) {
        errors.push(indexStr + 'Room ' + room.RoomNumber + ' (ID: ' + alloc.RoomID + ') is allocated to multiple students.');
      } else {
        allocatedRoomIds[alloc.RoomID] = alloc;
      }

      // 5. Room Capacity Check
      var capacity = parseInt(room.Capacity, 10);
      if (capacity !== 1) {
        errors.push(indexStr + 'Room ' + room.RoomNumber + ' capacity is ' + capacity + ' (Must be strictly 1).');
      }

      // 6. Missing Hostel Check
      var hostel = hostelMap[alloc.HostelID || room.HostelID];
      if (!hostel) {
        errors.push(indexStr + 'Hostel ID "' + alloc.HostelID + '" does not exist.');
        continue;
      }

      // 7. Gender Isolation Check
      var studentGender = String(student.Gender || '').toUpperCase();
      var hostelGender = String(hostel.Gender || '').toUpperCase();

      if (studentGender === 'MALE' && hostelGender !== 'BOYS') {
        errors.push(indexStr + 'CRITICAL GENDER VIOLATION: Male student ' + student.Name + ' assigned to Girls Hostel ' + hostel.Name + '.');
      }
      if (studentGender === 'FEMALE' && hostelGender !== 'GIRLS') {
        errors.push(indexStr + 'CRITICAL GENDER VIOLATION: Female student ' + student.Name + ' assigned to Boys Hostel ' + hostel.Name + '.');
      }

      // 8. Active Status Checks
      if (hostel.Status !== 'ACTIVE' && hostel.Status !== 'true' && hostel.Status !== true) {
        warnings.push(indexStr + 'Hostel ' + hostel.Name + ' is marked INACTIVE in master configuration.');
      }
      if (room.Status !== 'ACTIVE' && room.Status !== 'true' && room.Status !== true) {
        warnings.push(indexStr + 'Room ' + room.RoomNumber + ' is marked INACTIVE in master configuration.');
      }

      // 9. Student Eligibility Check
      var app = SheetRepository.findRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', alloc.ApplicationID);
      if (app && String(app.EligibilityStatus).toUpperCase() === 'INELIGIBLE') {
        errors.push(indexStr + 'CRITICAL: Ineligible student ' + student.Name + ' (' + app.ApplicationID + ') has an allocation record.');
      }

      // Tally metrics
      var cat = String(student.Category || 'GENERAL').toUpperCase();
      categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      if (hostelGender === 'BOYS') genderCounts.BOYS++;
      if (hostelGender === 'GIRLS') genderCounts.GIRLS++;
    }

    var isValid = errors.length === 0;

    return {
      valid: isValid,
      errors: errors,
      warnings: warnings,
      stats: {
        totalAllocationsValidated: allocations.length,
        uniqueStudents: Object.keys(allocatedStudentIds).length,
        uniqueRooms: Object.keys(allocatedRoomIds).length,
        genderBreakdown: genderCounts,
        categoryBreakdown: categoryCounts
      }
    };
  }

  return {
    validateAllocations: validateAllocations
  };
})();
