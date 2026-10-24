/**
 * HOSTEL 360 - ConstraintEngine.gs
 * Hard constraint enforcement: Gender isolation, single occupancy (capacity=1),
 * active room availability, and preventing duplicate allocations.
 */

var ConstraintEngine = (function () {

  /**
   * Validates if a proposed student-to-room allocation violates any hard system constraints
   *
   * @param {Object} student - Student record
   * @param {Object} hostel - Hostel record
   * @param {Object} room - Room record
   * @param {Object} allocationContext - { existingStudentAllocations, allocatedRoomIds }
   * @returns {Object} { isValid: boolean, violation: string|null }
   */
  function validateAllocationConstraints(student, hostel, room, allocationContext) {
    if (!student) {
      return { isValid: false, violation: 'Student record is missing.' };
    }
    if (!hostel) {
      return { isValid: false, violation: 'Hostel record is missing.' };
    }
    if (!room) {
      return { isValid: false, violation: 'Room record is missing.' };
    }

    // 1. Gender Compatibility Constraint
    var studentGender = String(student.Gender || '').toUpperCase();
    var hostelGender = String(hostel.Gender || '').toUpperCase();

    if (studentGender === 'MALE' && hostelGender !== 'BOYS') {
      return { isValid: false, violation: 'Gender mismatch: Male student cannot be allocated to ' + hostel.Name + ' (Girls Hostel).' };
    }
    if (studentGender === 'FEMALE' && hostelGender !== 'GIRLS') {
      return { isValid: false, violation: 'Gender mismatch: Female student cannot be allocated to ' + hostel.Name + ' (Boys Hostel).' };
    }

    // 2. Hostel Active Status
    var hostelStatus = String(hostel.Status || '').toUpperCase();
    if (hostelStatus !== 'ACTIVE' && hostelStatus !== 'TRUE') {
      return { isValid: false, violation: 'Hostel ' + hostel.Name + ' is currently inactive.' };
    }

    // 3. Room Status & Single-Occupancy Availability
    var roomStatus = String(room.Status || '').toUpperCase();
    var roomOccupancy = String(room.OccupancyStatus || '').toUpperCase();

    if (roomStatus !== 'ACTIVE' && roomStatus !== 'TRUE') {
      return { isValid: false, violation: 'Room ' + room.RoomNumber + ' in ' + hostel.Name + ' is inactive.' };
    }
    if (roomOccupancy !== 'AVAILABLE') {
      return { isValid: false, violation: 'Room ' + room.RoomNumber + ' in ' + hostel.Name + ' is not available (Status: ' + room.OccupancyStatus + ').' };
    }

    // 4. Room Capacity Constraint (Must be single occupancy)
    var capacity = parseInt(room.Capacity, 10);
    if (capacity !== 1) {
      return { isValid: false, violation: 'Room ' + room.RoomNumber + ' capacity must be 1 for single occupancy.' };
    }

    // 5. Contextual Double-Allocation Check (within current run or existing database)
    if (allocationContext) {
      if (allocationContext.allocatedStudentIds && allocationContext.allocatedStudentIds[student.StudentID]) {
        return { isValid: false, violation: 'Duplicate student allocation: Student ' + student.StudentID + ' is already allocated.' };
      }
      if (allocationContext.allocatedRoomIds && allocationContext.allocatedRoomIds[room.RoomID]) {
        return { isValid: false, violation: 'Duplicate room allocation: Room ' + room.RoomNumber + ' in ' + hostel.Name + ' is already assigned.' };
      }
    }

    return { isValid: true, violation: null };
  }

  return {
    validateAllocationConstraints: validateAllocationConstraints
  };
})();
