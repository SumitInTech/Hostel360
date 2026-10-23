/**
 * HOSTEL 360 - AllocationEngine.gs
 * Master deterministic allocation engine, lifecycle controller, manual override,
 * and allocation publication coordinator.
 */

var AllocationEngine = (function () {

  /**
   * Runs the complete deterministic allocation algorithm for an academic year
   *
   * @param {string} academicYear
   * @param {string} wardenEmail
   * @param {string} wardenUserId
   * @returns {Object} Allocation summary with draft counts, waitlist counts, and validator results
   */
  function runAllocation(academicYear, wardenEmail, wardenUserId) {
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;

    // 1. Check if an active published allocation already exists and is locked
    var existingPublished = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr && (a.Status === 'PUBLISHED' || a.Status === 'LOCKED');
    });

    if (existingPublished.length > 0) {
      throw new Error('Allocations for ' + yearStr + ' are already PUBLISHED and LOCKED. Please reopen allocations before re-running.');
    }

    // 2. Fast Bulk Clear previous DRAFT / REVIEW allocations and waitlist for this academic year
    SheetRepository.deleteRecordsWhere(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr && (a.Status === 'DRAFT' || a.Status === 'REVIEW');
    });

    SheetRepository.deleteRecordsWhere(SheetRepository.SHEETS.WAITLIST, function (w) {
      return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
    });

    // 3. Re-evaluate eligibility for all applications in high-speed bulk mode
    EligibilityEngine.evaluateAllApplications();

    // 4. Fetch all eligible applications for this academic year
    var eligibleApps = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (app) {
      return app.AcademicYear === yearStr && String(app.EligibilityStatus).toUpperCase() === 'ELIGIBLE';
    });

    // 5. Fetch all hostels and single-occupancy rooms
    var allHostels = SheetRepository.findRecords(SheetRepository.SHEETS.HOSTELS, function (h) {
      return h.Status === 'ACTIVE' || h.Status === 'true' || h.Status === true;
    });

    var allRooms = SheetRepository.findRecords(SheetRepository.SHEETS.ROOMS, function (r) {
      var isAct = r.Status === 'ACTIVE' || r.Status === 'true' || r.Status === true;
      var isAvail = String(r.OccupancyStatus).toUpperCase() === 'AVAILABLE';
      var isSingle = parseInt(r.Capacity, 10) === 1;
      return isAct && isAvail && isSingle;
    });

    // Pre-load all students into memory map for instant O(1) lookup
    var allStudents = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var studentsMap = {};
    for (var s = 0; s < allStudents.length; s++) {
      studentsMap[allStudents[s].StudentID] = allStudents[s];
    }

    // Separate applicants and rooms by gender
    var maleApplicants = [];
    var femaleApplicants = [];

    for (var i = 0; i < eligibleApps.length; i++) {
      var app = eligibleApps[i];
      var student = studentsMap[app.StudentID];
      if (!student) continue;

      var priorityGroup = PriorityEngine.determinePriorityGroup(student, yearStr);
      var distance = student.DistanceKm ? parseFloat(student.DistanceKm) : DistanceService.calculateDistance({
        address: student.PermanentAddress,
        city: student.PermanentCity,
        state: student.PermanentState,
        pincode: student.PermanentPincode,
        isDelhiNCR: student.IsDelhiNCRResident
      });

      var bundle = {
        student: student,
        application: app,
        priorityGroup: priorityGroup,
        distance: distance
      };

      if (String(student.Gender).toUpperCase() === 'MALE') {
        maleApplicants.push(bundle);
      } else if (String(student.Gender).toUpperCase() === 'FEMALE') {
        femaleApplicants.push(bundle);
      }
    }

    // Run allocation independently for Boys and Girls pools with strict gender isolation
    var boysAllocationResult = processAllocationPool(maleApplicants, allHostels, allRooms, 'BOYS', yearStr);
    var girlsAllocationResult = processAllocationPool(femaleApplicants, allHostels, allRooms, 'GIRLS', yearStr);

    var totalDraftAllocations = boysAllocationResult.allocations.concat(girlsAllocationResult.allocations);
    var totalDraftWaitlist = boysAllocationResult.waitlist.concat(girlsAllocationResult.waitlist);

    // Fast Batch insert into Sheets in 2 single API calls
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.ALLOCATIONS, totalDraftAllocations);
    SheetRepository.batchInsertRecords(SheetRepository.SHEETS.WAITLIST, totalDraftWaitlist);

    // Run Allocation Validator on generated drafts
    var validation = AllocationValidator.validateAllocations(totalDraftAllocations, yearStr);

    // Audit Log
    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'ALLOCATION_RUN',
      'Allocation',
      yearStr,
      null,
      { allocated: totalDraftAllocations.length, waitlisted: totalDraftWaitlist.length, valid: validation.valid },
      'Allocation engine executed in DRAFT mode for ' + yearStr,
      'SUCCESS'
    );

    // SMRITI ADVISORY HOOK: Retain allocation run summary
    try {
      if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
        var catCounts = {};
        for (var ta = 0; ta < totalDraftAllocations.length; ta++) {
          var c = totalDraftAllocations[ta].ReservationCategory || 'GENERAL';
          catCounts[c] = (catCounts[c] || 0) + 1;
        }
        var catSummaryParts = [];
        for (var ck in catCounts) catSummaryParts.push(ck + ': ' + catCounts[ck]);
        var catSummary = catSummaryParts.join(', ') || 'None';
        var remainingVacant = Math.max(0, allRooms.length - totalDraftAllocations.length);

        var runContent = 'In academic year ' + yearStr + ', allocation run completed in DRAFT mode with ' + totalDraftAllocations.length + ' allotments (' + catSummary + ') and ' + totalDraftWaitlist.length + ' waitlisted applicants. ' + remainingVacant + ' single rooms remain vacant.';
        MemoryService.smritiRetain(runContent, 'allocation_run');
      }
    } catch (smritiErr) {
      Logger.log('Smriti retain error (run): ' + smritiErr.message);
    }

    return {
      academicYear: yearStr,
      status: 'DRAFT',
      totalAllocated: totalDraftAllocations.length,
      totalWaitlisted: totalDraftWaitlist.length,
      boysAllocated: boysAllocationResult.allocations.length,
      boysWaitlisted: boysAllocationResult.waitlist.length,
      girlsAllocated: girlsAllocationResult.allocations.length,
      girlsWaitlisted: girlsAllocationResult.waitlist.length,
      validation: validation
    };
  }

  /**
   * Deterministically processes a gender-specific applicant pool against candidate hostels and rooms
   */
  function processAllocationPool(applicantBundles, allHostels, allRooms, targetGender, academicYear) {
    // Sort pool deterministically by:
    // 1. Priority Group Rank
    // 2. Category Quota Weight
    // 3. Distance from Dwarka Campus
    // 4. Submission Timestamp
    var sortedBundles = StudentComparator.sortApplications(applicantBundles);

    var genderHostels = allHostels.filter(function (h) {
      return String(h.Gender).toUpperCase() === targetGender;
    });

    var hostelIds = {};
    for (var gh = 0; gh < genderHostels.length; gh++) {
      hostelIds[genderHostels[gh].HostelID] = true;
    }

    // Get rooms belonging to these gender hostels
    var availableRooms = allRooms.filter(function (r) {
      return hostelIds[r.HostelID];
    });

    // Group available rooms by HostelID
    var roomsByHostel = {};
    for (var r = 0; r < availableRooms.length; r++) {
      var room = availableRooms[r];
      if (!roomsByHostel[room.HostelID]) {
        roomsByHostel[room.HostelID] = [];
      }
      roomsByHostel[room.HostelID].push(room);
    }

    // Sort rooms in each hostel by FloorNumber and RoomNumber for deterministic single room assignment
    for (var hid in roomsByHostel) {
      if (roomsByHostel.hasOwnProperty(hid)) {
        roomsByHostel[hid].sort(function (a, b) {
          var floorDiff = (parseInt(a.FloorNumber, 10) || 0) - (parseInt(b.FloorNumber, 10) || 0);
          if (floorDiff !== 0) return floorDiff;
          return String(a.RoomNumber).localeCompare(String(b.RoomNumber));
        });
      }
    }

    // Calculate quota seat constraints for this pool
    var totalRoomsInPool = availableRooms.length;
    var quotaMap = ReservationEngine.calculateSeatQuotas(totalRoomsInPool, academicYear);

    var allocations = [];
    var waitlist = [];
    var assignedStudentIds = {};
    var assignedRoomIds = {};
    var nowIso = new Date().toISOString();
    var waitlistCounter = 1;

    for (var i = 0; i < sortedBundles.length; i++) {
      var bundle = sortedBundles[i];
      var student = bundle.student;
      var app = bundle.application;
      var priorityGroup = bundle.priorityGroup;
      var distance = bundle.distance;
      var category = String(student.Category || 'GENERAL').toUpperCase();

      // Check quota limits (if category has quota, verify not exceeded)
      var categoryQuota = quotaMap[category] || quotaMap['GENERAL'];
      var isQuotaAvailable = categoryQuota ? (categoryQuota.allocatedSeats < categoryQuota.seatCount) : true;

      // If category quota is exhausted, the applicant cannot take a room from other reserved quotas!
      if (!isQuotaAvailable) {
        var waitlistId = 'WL_' + Utilities.getUuid().substring(0, 8).toUpperCase();
        var wlExplanation = ExplanationEngine.generateWaitlistExplanation({
          studentName: student.Name,
          waitlistPosition: waitlistCounter,
          priorityGroupName: priorityGroup.name,
          category: category,
          distance: distance,
          reason: 'Reserved quota limit reached (' + categoryQuota.seatCount + ' seats) for category ' + category
        });

        waitlist.push({
          WaitlistID: waitlistId,
          ApplicationID: app.ApplicationID,
          StudentID: student.StudentID,
          AcademicYear: academicYear,
          PriorityGroup: priorityGroup.code,
          PriorityRank: priorityGroup.rank,
          WaitlistPosition: waitlistCounter,
          Reason: 'Reserved quota full for ' + category,
          Status: 'ACTIVE',
          Explanation: wlExplanation,
          CreatedAt: nowIso,
          UpdatedAt: nowIso
        });

        waitlistCounter++;
        continue;
      }

      // Get candidate hostels matching student preferences and gender
      // (Preference 1 -> Preference 2 -> Waitlist, unless No Preference was explicitly selected)
      var candidateHostels = PreferenceEngine.getCandidateHostels(student, app, genderHostels);
      var allocatedRoom = null;
      var allocatedHostel = null;
      var preferenceRankMatched = 0;

      for (var c = 0; c < candidateHostels.length; c++) {
        var candHostel = candidateHostels[c];
        var candRooms = roomsByHostel[candHostel.HostelID] || [];

        // Find first unassigned room
        for (var rm = 0; rm < candRooms.length; rm++) {
          var potentialRoom = candRooms[rm];
          if (!assignedRoomIds[potentialRoom.RoomID]) {
            var constraintCheck = ConstraintEngine.validateAllocationConstraints(
              student,
              candHostel,
              potentialRoom,
              { allocatedStudentIds: assignedStudentIds, allocatedRoomIds: assignedRoomIds }
            );

            if (constraintCheck.isValid) {
              allocatedRoom = potentialRoom;
              allocatedHostel = candHostel;
              preferenceRankMatched = candHostel._preferenceRank || (c + 1);
              break;
            }
          }
        }

        if (allocatedRoom) break;
      }

      if (allocatedRoom && allocatedHostel) {
        // Mark room & student as assigned
        assignedRoomIds[allocatedRoom.RoomID] = true;
        assignedStudentIds[student.StudentID] = true;

        if (categoryQuota) {
          categoryQuota.allocatedSeats++;
        }

        var allocId = 'ALC_' + Utilities.getUuid().substring(0, 8).toUpperCase();
        var explanation = ExplanationEngine.generateAllocationExplanation({
          studentName: student.Name,
          hostelName: allocatedHostel.Name,
          roomNumber: allocatedRoom.RoomNumber,
          priorityGroupName: priorityGroup.name,
          category: category,
          distance: distance,
          preferenceRank: preferenceRankMatched
        });

        allocations.push({
          AllocationID: allocId,
          ApplicationID: app.ApplicationID,
          StudentID: student.StudentID,
          HostelID: allocatedHostel.HostelID,
          RoomID: allocatedRoom.RoomID,
          BedID: 'BED_' + allocatedRoom.RoomID,
          AcademicYear: academicYear,
          Status: 'DRAFT',
          AllocatedDate: nowIso.split('T')[0],
          PriorityGroup: priorityGroup.code,
          ReservationCategory: category,
          Explanation: explanation,
          IsManualOverride: false,
          OverrideReason: '',
          CreatedBy: 'ALLOCATION_ENGINE',
          PublishedAt: ''
        });
      } else {
        // Place on Waitlist
        var waitlistId = 'WL_' + Utilities.getUuid().substring(0, 8).toUpperCase();
        var wlExplanation = ExplanationEngine.generateWaitlistExplanation({
          studentName: student.Name,
          waitlistPosition: waitlistCounter,
          priorityGroupName: priorityGroup.name,
          category: category,
          distance: distance,
          reason: 'No available rooms in preferred hostel(s) for ' + targetGender + ' applicant pool'
        });

        waitlist.push({
          WaitlistID: waitlistId,
          ApplicationID: app.ApplicationID,
          StudentID: student.StudentID,
          AcademicYear: academicYear,
          PriorityGroup: priorityGroup.code,
          PriorityRank: priorityGroup.rank,
          WaitlistPosition: waitlistCounter,
          Reason: 'Capacity exhausted across candidate preference hostels for category ' + category,
          Status: 'ACTIVE',
          Explanation: wlExplanation,
          CreatedAt: nowIso,
          UpdatedAt: nowIso
        });

        waitlistCounter++;
      }
    }

    return {
      allocations: allocations,
      waitlist: waitlist
    };
  }

  /**
   * Publishes DRAFT allocations to official PUBLISHED status with high-speed bulk database operations
   */
  function publishAllocations(academicYear, wardenEmail, wardenUserId) {
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;

    var drafts = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr && (a.Status === 'DRAFT' || a.Status === 'REVIEW');
    });

    if (drafts.length === 0) {
      throw new Error('No draft allocations found for ' + yearStr + '. Please run allocation first.');
    }

    // Run validator before publication
    var validation = AllocationValidator.validateAllocations(drafts, yearStr);
    if (!validation.valid) {
      throw new Error('Cannot publish allocations. Critical validation errors detected:\n' + validation.errors.join('\n'));
    }

    var nowIso = new Date().toISOString();
    var deadlineDays = PolicyEngine.getFeePaymentDeadlineDays();
    var expiryIso = new Date(new Date().getTime() + (deadlineDays * 24 * 60 * 60 * 1000)).toISOString();

    // Pre-load reference maps in memory for instant lookups
    var allStudents = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var studentsMap = {};
    for (var s = 0; s < allStudents.length; s++) studentsMap[allStudents[s].StudentID] = allStudents[s];

    var allHostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var hostelsMap = {};
    for (var h = 0; h < allHostels.length; h++) hostelsMap[allHostels[h].HostelID] = allHostels[h];

    var allRooms = SheetRepository.getAllRecords(SheetRepository.SHEETS.ROOMS);
    var roomsMap = {};
    for (var r = 0; r < allRooms.length; r++) roomsMap[allRooms[r].RoomID] = allRooms[r];

    var allocUpdates = {};
    var roomUpdates = {};
    var appUpdates = {};
    var notifBatch = [];

    // 1. Process Draft Allocations
    for (var i = 0; i < drafts.length; i++) {
      var alloc = drafts[i];

      allocUpdates[alloc.AllocationID] = {
        Status: 'PUBLISHED',
        PublishedAt: nowIso,
        ExpiryDate: expiryIso,
        RegistrationStatus: 'PENDING'
      };

      roomUpdates[alloc.RoomID] = {
        OccupancyStatus: 'OCCUPIED'
      };

      appUpdates[alloc.ApplicationID] = {
        Status: 'ALLOCATED'
      };

      // Notification Dispatch
      try {
        var student = studentsMap[alloc.StudentID];
        var hostel = hostelsMap[alloc.HostelID];
        var room = roomsMap[alloc.RoomID];
        if (student) {
          alloc.Status = 'PUBLISHED';
          // Dispatches live email to real addresses immediately, and returns notification record
          var notifRec = NotificationService.notifyAllocationPublished(student, alloc, hostel, room, true);
          if (notifRec) notifBatch.push(notifRec);
        }
      } catch (notifErr) {
        Logger.log('Notification failed for student ' + alloc.StudentID + ': ' + notifErr.message);
      }
    }

    // 2. Process Waitlisted Applications
    var waitlistRecords = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
    });

    for (var w = 0; w < waitlistRecords.length; w++) {
      appUpdates[waitlistRecords[w].ApplicationID] = {
        Status: 'WAITLISTED'
      };
    }

    // 3. Execute High-Speed Bulk Sheet Updates (only 3 sheet writes total!)
    SheetRepository.bulkUpdateRecords(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocUpdates);
    SheetRepository.bulkUpdateRecords(SheetRepository.SHEETS.ROOMS, 'RoomID', roomUpdates);
    SheetRepository.bulkUpdateRecords(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', appUpdates);

    // 4. Batch insert all notification records in one single write
    if (notifBatch.length > 0) {
      SheetRepository.batchInsertRecords(SheetRepository.SHEETS.NOTIFICATIONS, notifBatch);
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'ALLOCATION_PUBLISHED',
      'Allocation',
      yearStr,
      'DRAFT',
      'PUBLISHED',
      'Official publication of ' + drafts.length + ' allocations and ' + waitlistRecords.length + ' waitlist entries',
      'SUCCESS'
    );

    // SMRITI ADVISORY HOOK: Retain official publication event with validator state
    try {
      if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
        var warnText = (validation && validation.warnings && validation.warnings.length > 0)
          ? 'Validator warnings: ' + validation.warnings.join('; ')
          : 'All 12 validation rules passed with zero warnings';
        var pubContent = 'In academic year ' + yearStr + ', officially published ' + drafts.length + ' allocations and ' + waitlistRecords.length + ' waitlist entries. ' + warnText + '.';
        MemoryService.smritiRetain(pubContent, 'allocation_published');
      }
    } catch (smritiErr) {
      Logger.log('Smriti retain error (publish): ' + smritiErr.message);
    }

    return {
      academicYear: yearStr,
      publishedAllocationsCount: drafts.length,
      waitlistCount: waitlistRecords.length,
      publishedAt: nowIso
    };
  }

  /**
   * Manually overrides a single student allocation with strict validation
   */
  function overrideAllocation(allocationId, newHostelId, newRoomId, reason, wardenEmail, wardenUserId) {
    if (!allocationId || !newHostelId || !newRoomId) {
      throw new Error('Allocation ID, new Hostel ID, and new Room ID are required.');
    }
    if (!reason || String(reason).trim().length < 5) {
      throw new Error('A detailed reason must be provided for manual override.');
    }

    var alloc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId);
    if (!alloc) {
      throw new Error('Allocation record not found: ' + allocationId);
    }

    var student = SheetRepository.findRecordByKey(SheetRepository.SHEETS.STUDENTS, 'StudentID', alloc.StudentID);
    var newHostel = SheetRepository.findRecordByKey(SheetRepository.SHEETS.HOSTELS, 'HostelID', newHostelId);
    var newRoom = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', newRoomId);

    // Validate new target room and hostel constraints
    var constraint = ConstraintEngine.validateAllocationConstraints(student, newHostel, newRoom, null);
    if (!constraint.isValid) {
      throw new Error('Cannot override allocation: ' + constraint.violation);
    }

    // Check if new room is currently occupied by another active allocation
    var existingInRoom = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.RoomID === newRoomId && a.AllocationID !== allocationId && (a.Status === 'PUBLISHED' || a.Status === 'DRAFT');
    });

    if (existingInRoom.length > 0) {
      throw new Error('Target Room ' + newRoom.RoomNumber + ' is already occupied by student ' + existingInRoom[0].StudentID);
    }

    var oldValues = {
      HostelID: alloc.HostelID,
      RoomID: alloc.RoomID
    };

    // Free up old room if previously occupied
    if (alloc.Status === 'PUBLISHED') {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', alloc.RoomID, {
        OccupancyStatus: 'AVAILABLE'
      });
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', newRoomId, {
        OccupancyStatus: 'OCCUPIED'
      });
    }

    // Update Allocation
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId, {
      HostelID: newHostelId,
      RoomID: newRoomId,
      BedID: 'BED_' + newRoomId,
      IsManualOverride: true,
      OverrideReason: reason,
      Explanation: 'Manually reallocated by Warden to Room ' + newRoom.RoomNumber + ' in ' + newHostel.Name + '. Reason: ' + reason
    });

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'ALLOCATION_OVERRIDE',
      'Allocation',
      allocationId,
      oldValues,
      { HostelID: newHostelId, RoomID: newRoomId },
      reason,
      'SUCCESS'
    );

    // SMRITI ADVISORY HOOK: Retain manual override precedent
    try {
      if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
        var yr = alloc.AcademicYear || (typeof PolicyEngine !== 'undefined' ? PolicyEngine.getActiveAcademicYear().AcademicYear : '2026-27');
        var overrideContent = 'In academic year ' + yr + ', manual override approved for student in category ' + (alloc.ReservationCategory || alloc.Category || 'GENERAL') + ', priority ' + (alloc.PriorityGroup || 'Standard') + ' from hostel ' + alloc.HostelID + ' to ' + newHostelId + '. Reason: ' + reason;
        MemoryService.smritiRetain(overrideContent, 'manual_override');
      }
    } catch (smritiErr) {
      Logger.log('Smriti retain error (override): ' + smritiErr.message);
    }

    return {
      allocationId: allocationId,
      studentId: alloc.StudentID,
      newHostel: newHostel.Name,
      newRoom: newRoom.RoomNumber,
      reason: reason
    };
  }

  /**
   * Officially cancels / revokes an existing room allocation with mandatory reason
   */
  function cancelAllocation(allocationId, reason, wardenEmail, wardenUserId) {
    if (!allocationId) {
      throw new Error('Allocation ID is required.');
    }
    if (!reason || String(reason).trim().length < 5) {
      throw new Error('A valid administrative reason (min 5 characters) must be provided to cancel an allocation.');
    }

    var alloc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId);
    if (!alloc) {
      throw new Error('Allocation not found: ' + allocationId);
    }

    var oldValues = {
      AllocationID: alloc.AllocationID,
      StudentID: alloc.StudentID,
      HostelID: alloc.HostelID,
      RoomID: alloc.RoomID,
      Status: alloc.Status
    };

    // Free up the allocated room and bed
    if (alloc.RoomID) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', alloc.RoomID, {
        OccupancyStatus: 'AVAILABLE'
      });
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.BEDS, 'RoomID', alloc.RoomID, {
        Status: 'AVAILABLE',
        CurrentStudentID: ''
      });
    }

    var nowIso = new Date().toISOString();

    // Update Allocation record
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocationId, {
      Status: 'CANCELLED',
      IsManualOverride: true,
      OverrideReason: reason,
      Explanation: 'Allotment officially revoked/cancelled by Warden. Justification: ' + reason
    });

    // Update Application record if present
    var activeYear = PolicyEngine.getActiveAcademicYear();
    var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return a.StudentID === alloc.StudentID && a.AcademicYear === (alloc.AcademicYear || activeYear.AcademicYear);
    })[0];

    if (app) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
        Status: 'CANCELLED',
        Remarks: 'Room allocation cancelled by Warden: ' + reason
      });
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'ALLOCATION_CANCELLED',
      'Allocation',
      allocationId,
      oldValues,
      { Status: 'CANCELLED', RoomFreed: alloc.RoomID },
      reason,
      'SUCCESS'
    );

    return {
      allocationId: allocationId,
      studentId: alloc.StudentID,
      roomFreed: alloc.RoomID,
      status: 'CANCELLED',
      reason: reason
    };
  }

  /**
   * Reopens a published allocation back to REVIEW mode
   */
  function reopenAllocations(academicYear, reason, wardenEmail, wardenUserId) {
    if (!reason || String(reason).trim().length < 5) {
      throw new Error('A detailed reason must be provided to reopen allocations.');
    }

    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;

    var allocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr;
    });

    for (var i = 0; i < allocations.length; i++) {
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', allocations[i].AllocationID, {
        Status: 'REVIEW'
      });
    }

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'ALLOCATION_REOPENED',
      'Allocation',
      yearStr,
      'PUBLISHED',
      'REVIEW',
      reason,
      'SUCCESS'
    );

    return {
      academicYear: yearStr,
      status: 'REVIEW',
      reopenedCount: allocations.length
    };
  }

  /**
   * Lapses all allocations that have exceeded the fee payment and reporting deadline without verified payment
   */
  function lapseUnreportedAllocations(academicYear, wardenEmail, wardenUserId) {
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;
    var now = new Date();

    var publishedAllocations = SheetRepository.findRecords(SheetRepository.SHEETS.ALLOCATIONS, function (a) {
      return a.AcademicYear === yearStr && a.Status === 'PUBLISHED' && a.RegistrationStatus !== 'COMPLETED';
    });

    var allPayments = SheetRepository.getAllRecords(SheetRepository.SHEETS.PAYMENTS);
    var paymentsByStudent = {};
    for (var p = 0; p < allPayments.length; p++) {
      var pay = allPayments[p];
      if (!paymentsByStudent[pay.StudentID]) paymentsByStudent[pay.StudentID] = [];
      paymentsByStudent[pay.StudentID].push(pay);
    }

    var lapsedAllocations = [];

    for (var i = 0; i < publishedAllocations.length; i++) {
      var alloc = publishedAllocations[i];
      var stuPayments = paymentsByStudent[alloc.StudentID] || [];
      var hasVerifiedPayment = stuPayments.some(function (pm) { return pm.Status === 'VERIFIED'; });

      // If student already has a verified payment, they are not lapsed
      if (hasVerifiedPayment) continue;

      // Check if deadline has passed
      var isExpired = false;
      if (alloc.ExpiryDate) {
        isExpired = new Date(alloc.ExpiryDate) < now;
      } else if (alloc.PublishedAt) {
        var deadlineDays = PolicyEngine.getFeePaymentDeadlineDays();
        var deadlineMs = new Date(alloc.PublishedAt).getTime() + (deadlineDays * 24 * 60 * 60 * 1000);
        isExpired = deadlineMs < now.getTime();
      } else {
        isExpired = true;
      }

      if (isExpired) {
        // 1. Free up the Room and Bed
        if (alloc.RoomID) {
          SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', alloc.RoomID, {
            OccupancyStatus: 'AVAILABLE'
          });
          SheetRepository.updateRecordByKey(SheetRepository.SHEETS.BEDS, 'RoomID', alloc.RoomID, {
            Status: 'AVAILABLE',
            CurrentStudentID: ''
          });
        }

        // 2. Mark Allocation as LAPSED_UNREPORTED
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ALLOCATIONS, 'AllocationID', alloc.AllocationID, {
          Status: 'LAPSED_UNREPORTED',
          IsManualOverride: true,
          OverrideReason: 'Allotment lapsed due to non-reporting / unpaid fees within institutional deadline',
          Explanation: 'Allotment forfeited on ' + now.toLocaleDateString() + ' due to lack of fee submission/reporting within deadline.'
        });

        // 3. Mark Application as LAPSED
        var app = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
          return a.StudentID === alloc.StudentID && a.AcademicYear === yearStr;
        })[0];

        if (app) {
          SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
            Status: 'LAPSED',
            Remarks: 'Hostel seat forfeited: fee payment deadline elapsed without interaction'
          });
        }

        lapsedAllocations.push({
          allocationId: alloc.AllocationID,
          studentId: alloc.StudentID,
          roomFreed: alloc.RoomID,
          hostelId: alloc.HostelID
        });

        AuditService.logAction(
          wardenUserId || 'WARDEN',
          wardenEmail || 'warden@hostel360.internal',
          'WARDEN',
          'ALLOCATION_LAPSED',
          'Allocation',
          alloc.AllocationID,
          'PUBLISHED',
          'LAPSED_UNREPORTED',
          'Auto-lapsed seat for student ' + alloc.StudentID + '; Room ' + alloc.RoomID + ' released to available pool',
          'SUCCESS'
        );
      }
    }

    // SMRITI ADVISORY HOOK: Retain seat forfeiture and lapse patterns
    if (lapsedAllocations.length > 0) {
      try {
        if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
          var lapsesByHostel = {};
          for (var lp = 0; lp < lapsedAllocations.length; lp++) {
            var hId = lapsedAllocations[lp].hostelId || 'UNKNOWN';
            lapsesByHostel[hId] = (lapsesByHostel[hId] || 0) + 1;
          }
          for (var hostKey in lapsesByHostel) {
            var lapseContent = 'In academic year ' + yearStr + ', ' + lapsesByHostel[hostKey] + ' unreported seat(s) in hostel ' + hostKey + ' lapsed due to non-reporting and unpaid fees within the institutional deadline, and were released back to the vacancy pool.';
            MemoryService.smritiRetain(lapseContent, 'lapse_unreported');
          }
        }
      } catch (smritiErr) {
        Logger.log('Smriti retain error (lapse): ' + smritiErr.message);
      }
    }

    return {
      academicYear: yearStr,
      lapsedCount: lapsedAllocations.length,
      lapsedAllocations: lapsedAllocations
    };
  }

  /**
   * Promotes top waitlisted candidates into newly available vacant rooms
   */
  function promoteWaitlistCandidates(academicYear, wardenEmail, wardenUserId) {
    var activeYear = academicYear ? { AcademicYear: academicYear } : PolicyEngine.getActiveAcademicYear();
    var yearStr = activeYear.AcademicYear;
    var now = new Date();
    var nowIso = now.toISOString();

    // Get active waitlist entries ordered by position
    var activeWaitlist = SheetRepository.findRecords(SheetRepository.SHEETS.WAITLIST, function (w) {
      return w.AcademicYear === yearStr && w.Status === 'ACTIVE';
    });
    activeWaitlist.sort(function (a, b) {
      return (parseInt(a.WaitlistPosition, 10) || 0) - (parseInt(b.WaitlistPosition, 10) || 0);
    });

    if (activeWaitlist.length === 0) {
      return { promotedCount: 0, message: 'No active waitlisted candidates to promote.' };
    }

    // Get all available rooms
    var availableRooms = SheetRepository.findRecords(SheetRepository.SHEETS.ROOMS, function (r) {
      return r.OccupancyStatus === 'AVAILABLE' && r.Status === 'ACTIVE';
    });

    var allHostels = SheetRepository.getAllRecords(SheetRepository.SHEETS.HOSTELS);
    var hostelMap = {};
    for (var h = 0; h < allHostels.length; h++) hostelMap[allHostels[h].HostelID] = allHostels[h];

    var allStudents = SheetRepository.getAllRecords(SheetRepository.SHEETS.STUDENTS);
    var studentMap = {};
    for (var s = 0; s < allStudents.length; s++) studentMap[allStudents[s].StudentID] = allStudents[s];

    var allApps = SheetRepository.findRecords(SheetRepository.SHEETS.APPLICATIONS, function (a) {
      return a.AcademicYear === yearStr;
    });
    var appMap = {};
    for (var a = 0; a < allApps.length; a++) appMap[allApps[a].StudentID] = allApps[a];

    var promoted = [];
    var assignedRoomIds = {};
    var deadlineDays = PolicyEngine.getFeePaymentDeadlineDays();
    var expiryIso = new Date(now.getTime() + (deadlineDays * 24 * 60 * 60 * 1000)).toISOString();

    for (var w = 0; w < activeWaitlist.length; w++) {
      var wl = activeWaitlist[w];
      var student = studentMap[wl.StudentID];
      var app = appMap[wl.StudentID];
      if (!student) continue;

      var stuGender = String(student.Gender || '').toUpperCase().trim();
      var isMale = (stuGender === 'MALE' || stuGender === 'BOYS');

      // Find first available room in a gender-compatible hostel
      var matchedRoom = null;
      var matchedHostel = null;

      for (var r = 0; r < availableRooms.length; r++) {
        var room = availableRooms[r];
        if (assignedRoomIds[room.RoomID]) continue;

        var host = hostelMap[room.HostelID];
        if (!host) continue;

        var hostGender = String(host.Gender || '').toUpperCase().trim();
        var hostIsMale = (hostGender === 'BOYS' || hostGender === 'MALE');

        if (isMale === hostIsMale) {
          matchedRoom = room;
          matchedHostel = host;
          assignedRoomIds[room.RoomID] = true;
          break;
        }
      }

      if (matchedRoom && matchedHostel) {
        var newAllocId = 'AL_' + Utilities.getUuid().substring(0, 8).toUpperCase();
        var explanation = 'Promoted from Waitlist (Position #' + wl.WaitlistPosition + ') into newly available Room ' + matchedRoom.RoomNumber + ' in ' + matchedHostel.Name + ' following seat vacancy.';

        // 1. Create Allocation record
        SheetRepository.insertRecord(SheetRepository.SHEETS.ALLOCATIONS, {
          AllocationID: newAllocId,
          ApplicationID: wl.ApplicationID,
          StudentID: wl.StudentID,
          HostelID: matchedHostel.HostelID,
          RoomID: matchedRoom.RoomID,
          BedID: 'BED_' + matchedRoom.RoomID,
          AcademicYear: yearStr,
          Status: 'PUBLISHED',
          AllocatedDate: nowIso.split('T')[0],
          PriorityGroup: wl.PriorityGroup,
          ReservationCategory: student.Category || 'GENERAL',
          Explanation: explanation,
          IsManualOverride: true,
          OverrideReason: 'Waitlist Promotion',
          CreatedBy: wardenUserId || 'WARDEN',
          PublishedAt: nowIso,
          ExpiryDate: expiryIso,
          RegistrationStatus: 'PENDING'
        });

        // 2. Mark Room as OCCUPIED
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.ROOMS, 'RoomID', matchedRoom.RoomID, {
          OccupancyStatus: 'OCCUPIED'
        });

        // 3. Mark Waitlist entry as ALLOCATED
        SheetRepository.updateRecordByKey(SheetRepository.SHEETS.WAITLIST, 'WaitlistID', wl.WaitlistID, {
          Status: 'ALLOCATED',
          UpdatedAt: nowIso
        });

        // 4. Mark Application as ALLOCATED
        if (app) {
          SheetRepository.updateRecordByKey(SheetRepository.SHEETS.APPLICATIONS, 'ApplicationID', app.ApplicationID, {
            Status: 'ALLOCATED'
          });
        }

        promoted.push({
          studentId: student.StudentID,
          studentName: student.Name,
          waitlistPosition: wl.WaitlistPosition,
          allocatedRoom: matchedRoom.RoomNumber,
          allocatedHostel: matchedHostel.Name
        });

        AuditService.logAction(
          wardenUserId || 'WARDEN',
          wardenEmail || 'warden@hostel360.internal',
          'WARDEN',
          'WAITLIST_PROMOTION',
          'Allocation',
          newAllocId,
          'WAITLIST_#' + wl.WaitlistPosition,
          'PUBLISHED',
          explanation,
          'SUCCESS'
        );

        // SMRITI ADVISORY HOOK: Retain waitlist promotion event
        try {
          if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
            var promoContent = 'In academic year ' + yearStr + ', waitlist candidate in category ' + (student.Category || 'GENERAL') + ', priority ' + wl.PriorityGroup + ' was promoted from waitlist position #' + wl.WaitlistPosition + ' into newly vacant room in hostel ' + matchedHostel.HostelID + ' following seat vacancy.';
            MemoryService.smritiRetain(promoContent, 'waitlist_promotion');
          }
        } catch (smritiErr) {
          Logger.log('Smriti retain error (waitlist promo): ' + smritiErr.message);
        }
      }
    }

    return {
      academicYear: yearStr,
      promotedCount: promoted.length,
      promotedCandidates: promoted
    };
  }

  return {
    runAllocation: runAllocation,
    publishAllocations: publishAllocations,
    overrideAllocation: overrideAllocation,
    cancelAllocation: cancelAllocation,
    reopenAllocations: reopenAllocations,
    lapseUnreportedAllocations: lapseUnreportedAllocations,
    promoteWaitlistCandidates: promoteWaitlistCandidates
  };
})();
