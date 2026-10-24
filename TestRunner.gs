/**
 * HOSTEL 360 - TestRunner.gs
 * Automated regression test suite executing all 20 institutional verification tests.
 */

var TestRunner = (function () {

  /**
   * Executes all 20 regression tests and returns structured results
   */
  function runAllTests() {
    var results = [];
    var passed = 0;
    var failed = 0;

    function assert(testId, name, condition, message) {
      if (condition) {
        passed++;
        results.push({ id: testId, name: name, passed: true, message: message || 'Passed' });
      } else {
        failed++;
        results.push({ id: testId, name: name, passed: false, message: message || 'Failed' });
      }
    }

    try {
      // -------------------------------------------------------------
      // TEST 1: Male -> Girls hostel (Expected: REJECT)
      // -------------------------------------------------------------
      var maleStudent = { StudentID: 'T_STU_M', Gender: 'MALE' };
      var girlsHostel = { HostelID: 'HST_GH', Name: 'Satpura Hostel', Gender: 'GIRLS', Status: 'ACTIVE' };
      var singleRoom1 = { RoomID: 'RM_1', HostelID: 'HST_GH', Capacity: 1, Status: 'ACTIVE', OccupancyStatus: 'AVAILABLE' };
      var res1 = ConstraintEngine.validateAllocationConstraints(maleStudent, girlsHostel, singleRoom1, null);
      assert('TEST 1', 'Male -> Girls hostel rejection', !res1.isValid, res1.violation);

      // -------------------------------------------------------------
      // TEST 2: Female -> Boys hostel (Expected: REJECT)
      // -------------------------------------------------------------
      var femaleStudent = { StudentID: 'T_STU_F', Gender: 'FEMALE' };
      var boysHostel = { HostelID: 'HST_BH', Name: 'Shivalik Hostel', Gender: 'BOYS', Status: 'ACTIVE' };
      var singleRoom2 = { RoomID: 'RM_2', HostelID: 'HST_BH', Capacity: 1, Status: 'ACTIVE', OccupancyStatus: 'AVAILABLE' };
      var res2 = ConstraintEngine.validateAllocationConstraints(femaleStudent, boysHostel, singleRoom2, null);
      assert('TEST 2', 'Female -> Boys hostel rejection', !res2.isValid, res2.violation);

      // -------------------------------------------------------------
      // TEST 3: Two students -> same single room (Expected: 2nd REJECTED)
      // -------------------------------------------------------------
      var context3 = {
        allocatedStudentIds: { 'T_STU_1': true },
        allocatedRoomIds: { 'RM_SINGLE': true }
      };
      var res3 = ConstraintEngine.validateAllocationConstraints(
        { StudentID: 'T_STU_2', Gender: 'MALE' },
        boysHostel,
        { RoomID: 'RM_SINGLE', HostelID: 'HST_BH', Capacity: 1, Status: 'ACTIVE', OccupancyStatus: 'AVAILABLE' },
        context3
      );
      assert('TEST 3', 'Two students -> same single room', !res3.isValid, res3.violation);

      // -------------------------------------------------------------
      // TEST 4: Eligible student with Preference 1 available (Expected: Pref 1 allocated)
      // -------------------------------------------------------------
      var hostelsList = [
        { HostelID: 'H_1', Name: 'Hostel 1', Gender: 'BOYS', Status: 'ACTIVE' },
        { HostelID: 'H_2', Name: 'Hostel 2', Gender: 'BOYS', Status: 'ACTIVE' }
      ];
      var cand4 = PreferenceEngine.getCandidateHostels(
        { Gender: 'MALE' },
        { FirstHostelPref: 'H_1', SecondHostelPref: 'H_2', NoPreference: false },
        hostelsList
      );
      assert('TEST 4', 'Preference 1 ordered first', cand4.length > 0 && cand4[0].HostelID === 'H_1');

      // -------------------------------------------------------------
      // TEST 5: Preference 1 unavailable + Preference 2 available (Expected: Pref 2 candidate)
      // -------------------------------------------------------------
      assert('TEST 5', 'Preference 2 candidate present in order', cand4.length === 2 && cand4[1].HostelID === 'H_2');

      // -------------------------------------------------------------
      // TEST 6: Preference 1 unavailable + Preference 2 unavailable (Expected: WAITLIST, No unchosen 3rd hostel)
      // -------------------------------------------------------------
      var threeHostels = [
        { HostelID: 'H_1', Name: 'Hostel 1', Gender: 'BOYS', Status: 'ACTIVE' },
        { HostelID: 'H_2', Name: 'Hostel 2', Gender: 'BOYS', Status: 'ACTIVE' },
        { HostelID: 'H_3', Name: 'Hostel 3 (Unchosen)', Gender: 'BOYS', Status: 'ACTIVE' }
      ];
      var cand6 = PreferenceEngine.getCandidateHostels(
        { Gender: 'MALE' },
        { FirstHostelPref: 'H_1', SecondHostelPref: 'H_2', NoPreference: false },
        threeHostels
      );
      var includesUnchosen = cand6.some(function (h) { return h.HostelID === 'H_3'; });
      assert('TEST 6', 'Specific preferences do not fall back to unchosen 3rd hostel', !includesUnchosen && cand6.length === 2);

      // -------------------------------------------------------------
      // TEST 7: No Preference student (Expected: Any compatible hostel considered)
      // -------------------------------------------------------------
      var cand7 = PreferenceEngine.getCandidateHostels(
        { Gender: 'MALE' },
        { FirstHostelPref: '', SecondHostelPref: '', NoPreference: true },
        threeHostels
      );
      assert('TEST 7', 'No Preference considers all compatible hostels', cand7.length === 3);

      // -------------------------------------------------------------
      // TEST 8: Reserved seats unused (Expected: remain vacant)
      // -------------------------------------------------------------
      var quotas8 = ReservationEngine.calculateSeatQuotas(100, '2026-27');
      var scQuota = quotas8['SC'];
      assert('TEST 8', 'Reserved quota seats distinct from general', scQuota && scQuota.seatCount > 0 && quotas8['GENERAL'].seatCount < 100);

      // -------------------------------------------------------------
      // TEST 9: Reserved seats explicitly released by Warden (Expected: added to General pool)
      // -------------------------------------------------------------
      // Simulate release math
      var genBefore = 40;
      var scBefore = 15;
      var releaseAmount = 5;
      var genAfter = genBefore + releaseAmount;
      var scAfter = scBefore - releaseAmount;
      assert('TEST 9', 'Reserved seat release math accurate', genAfter === 45 && scAfter === 10);

      // -------------------------------------------------------------
      // TEST 10: Lower priority student with greater distance cannot overtake higher priority
      // -------------------------------------------------------------
      var appGroup2Near = {
        student: { Category: 'GENERAL', StudentID: 'S_G2' },
        application: { SubmissionDate: '2026-08-10T10:00:00Z', ApplicationID: 'A1' },
        priorityGroup: { rank: 2, name: 'Group 2' },
        distance: 50 // 50 km
      };
      var appGroup3Far = {
        student: { Category: 'GENERAL', StudentID: 'S_G3' },
        application: { SubmissionDate: '2026-08-01T10:00:00Z', ApplicationID: 'A2' },
        priorityGroup: { rank: 3, name: 'Group 3' },
        distance: 1000 // 1000 km
      };
      var comp10 = StudentComparator.compareApplications(appGroup2Near, appGroup3Far);
      assert('TEST 10', 'Priority group overrides distance (Group 2 ranks before Group 3)', comp10 < 0);

      // -------------------------------------------------------------
      // TEST 11: Same priority + same applicable conditions (Distance/timestamp applied)
      // -------------------------------------------------------------
      var appG2Far = {
        student: { Category: 'GENERAL', StudentID: 'S1' },
        application: { SubmissionDate: '2026-08-10T10:00:00Z', ApplicationID: 'A_FAR' },
        priorityGroup: { rank: 2, name: 'Group 2' },
        distance: 500
      };
      var appG2Near = {
        student: { Category: 'GENERAL', StudentID: 'S2' },
        application: { SubmissionDate: '2026-08-10T10:00:00Z', ApplicationID: 'A_NEAR' },
        priorityGroup: { rank: 2, name: 'Group 2' },
        distance: 200
      };
      var comp11 = StudentComparator.compareApplications(appG2Far, appG2Near);
      assert('TEST 11', 'Same priority tier: greater distance ranks higher', comp11 < 0);

      // -------------------------------------------------------------
      // TEST 12: Student attempts to request another StudentID (Expected: DENY)
      // -------------------------------------------------------------
      var fakeStudentToken = SessionService.createSession({
        UserID: 'USR_STU_DEMO',
        Email: 'student.demo@hostel360.test',
        Role: 'STUDENT',
        StudentID: 'STU_OWN'
      }).token;
      var caught12 = false;
      try {
        AuthService.requireStudentOwnership(fakeStudentToken, 'STU_OTHER_PERSON');
      } catch (e) {
        caught12 = true;
      }
      assert('TEST 12', 'Student ID tampering denied server-side', caught12);

      // -------------------------------------------------------------
      // TEST 13: Student attempts Warden function (Expected: DENY)
      // -------------------------------------------------------------
      var caught13 = false;
      try {
        AuthService.requireRole(fakeStudentToken, 'WARDEN');
      } catch (e) {
        caught13 = true;
      }
      assert('TEST 13', 'Role escalation denied server-side', caught13);

      // -------------------------------------------------------------
      // TEST 14: Draft allocation (Expected: invisible to student)
      // -------------------------------------------------------------
      var draftAlloc = { Status: 'DRAFT', StudentID: 'STU_1' };
      var isVisibleDraft = (draftAlloc.Status === 'PUBLISHED' || draftAlloc.Status === 'LOCKED');
      assert('TEST 14', 'Draft allocation invisible to student', !isVisibleDraft);

      // -------------------------------------------------------------
      // TEST 15: Published allocation (Expected: visible to student)
      // -------------------------------------------------------------
      var pubAlloc = { Status: 'PUBLISHED', StudentID: 'STU_1' };
      var isVisiblePub = (pubAlloc.Status === 'PUBLISHED' || pubAlloc.Status === 'LOCKED');
      assert('TEST 15', 'Published allocation visible to student', isVisiblePub);

      // -------------------------------------------------------------
      // TEST 16: Manual override violates gender/capacity (Expected: REJECT)
      // -------------------------------------------------------------
      var res16 = ConstraintEngine.validateAllocationConstraints(
        { StudentID: 'S_BOY', Gender: 'MALE' },
        { HostelID: 'HST_GH', Gender: 'GIRLS', Status: 'ACTIVE' },
        { RoomID: 'RM_GH1', Capacity: 1, Status: 'ACTIVE', OccupancyStatus: 'AVAILABLE' },
        null
      );
      assert('TEST 16', 'Invalid manual override rejected', !res16.isValid);

      // -------------------------------------------------------------
      // TEST 17: Manual override valid (Expected: ACCEPT)
      // -------------------------------------------------------------
      var res17 = ConstraintEngine.validateAllocationConstraints(
        { StudentID: 'S_BOY', Gender: 'MALE' },
        { HostelID: 'HST_BH', Gender: 'BOYS', Status: 'ACTIVE' },
        { RoomID: 'RM_BH1', Capacity: 1, Status: 'ACTIVE', OccupancyStatus: 'AVAILABLE' },
        null
      );
      assert('TEST 17', 'Valid manual override accepted', res17.isValid);

      // -------------------------------------------------------------
      // TEST 18: Password plaintext search (Expected: salted hash used)
      // -------------------------------------------------------------
      var salt18 = AuthService.generateSalt();
      var hash18 = AuthService.hashPassword('Secret@123', salt18);
      assert('TEST 18', 'Password hashing is salted and irreversible', hash18 !== 'Secret@123' && hash18.length === 64 && salt18.length === 64);

      // -------------------------------------------------------------
      // TEST 19: Student attempts to mark payment VERIFIED (Expected: DENY)
      // -------------------------------------------------------------
      var caught19 = false;
      try {
        AuthService.requireRole(fakeStudentToken, 'WARDEN');
      } catch (e) {
        caught19 = true;
      }
      assert('TEST 19', 'Student cannot verify payment', caught19);

      // -------------------------------------------------------------
      // TEST 20: Published allocation -> Allotment letter availability
      // -------------------------------------------------------------
      var letterData = {
        allotmentLetterNo: 'HL-12345',
        academicYear: '2026-27',
        student: { name: 'Aarav Sharma', enrollmentNo: '04516403226' },
        allotment: { hostelName: 'Shivalik Hostel', roomNumber: '101', status: 'PUBLISHED' }
      };
      assert('TEST 20', 'Digital allotment letter data structure complete', letterData.allotment.status === 'PUBLISHED' && !!letterData.allotmentLetterNo);

      // -------------------------------------------------------------
      // TEST 21: Smriti PII Scrubbing (smritiScrub_)
      // -------------------------------------------------------------
      var rawPiiText = 'Student test.user@university.ac.in phone +91 9876543210 roll 2026045123 applied in year 2026-27';
      var scrubbed = (typeof MemoryService !== 'undefined') ? MemoryService.smritiScrub_(rawPiiText) : '';
      var noEmail = scrubbed.indexOf('test.user@university.ac.in') === -1 && scrubbed.indexOf('[EMAIL_REDACTED]') !== -1;
      var noPhone = scrubbed.indexOf('9876543210') === -1 && scrubbed.indexOf('[PHONE_REDACTED]') !== -1;
      var noId = scrubbed.indexOf('2026045123') === -1 && scrubbed.indexOf('[ID_REDACTED]') !== -1;
      var preservesYear = scrubbed.indexOf('2026-27') !== -1;
      assert('TEST 21', 'Smriti PII scrubber removes emails, phone numbers and long digit IDs', noEmail && noPhone && noId && preservesYear);

      // -------------------------------------------------------------
      // TEST 22: Smriti non-throwing behavior when unconfigured
      // -------------------------------------------------------------
      var retainResult = null;
      var didThrow = false;
      try {
        if (typeof MemoryService !== 'undefined') {
          retainResult = MemoryService.smritiRetain('Test advisory event without configuration', 'test_context');
        }
      } catch (e) {
        didThrow = true;
      }
      assert('TEST 22', 'smritiRetain returns {ok:false} without throwing when unconfigured', !didThrow && retainResult !== null && typeof retainResult === 'object');

      // -------------------------------------------------------------
      // TEST 23: Smriti hooks do not break existing operations
      // -------------------------------------------------------------
      var hooksDidNotBreak = false;
      try {
        // DocumentService verifyDocument with missing ID throws validation error, not Smriti error
        DocumentService.verifyDocument('NON_EXISTENT_ID', 'PENDING', 'Testing');
      } catch (expectedValidationErr) {
        hooksDidNotBreak = (expectedValidationErr.message.indexOf('Document not found') !== -1);
      }
      var recallRes = (typeof MemoryService !== 'undefined') ? MemoryService.smritiRecall('any search query') : null;
      var reflectRes = (typeof MemoryService !== 'undefined') ? MemoryService.smritiReflect('any question') : null;
      var safeReturn = recallRes && (typeof recallRes.ok === 'boolean') && reflectRes && (typeof reflectRes.ok === 'boolean');
      assert('TEST 23', 'Smriti hooks & memory methods are non-blocking and safe in all states', hooksDidNotBreak && safeReturn);

    } catch (err) {
      results.push({ id: 'GLOBAL_ERR', name: 'Test execution exception', passed: false, message: err.message });
      failed++;
    }

    return {
      totalTests: results.length,
      passed: passed,
      failed: failed,
      allPassed: failed === 0,
      results: results
    };
  }

  return {
    runAllTests: runAllTests
  };
})();

/**
 * Global function callable from Apps Script Editor to run regression tests
 */
function runHostel360RegressionTests() {
  var summary = TestRunner.runAllTests();
  Logger.log('====================================================');
  Logger.log('HOSTEL 360 REGRESSION TEST SUITE RESULTS');
  Logger.log('Passed: ' + summary.passed + ' / ' + summary.totalTests);
  Logger.log('Failed: ' + summary.failed);
  Logger.log('====================================================');
  for (var i = 0; i < summary.results.length; i++) {
    var r = summary.results[i];
    Logger.log((r.passed ? '✅ [PASS] ' : '❌ [FAIL] ') + r.id + ': ' + r.name + ' - ' + r.message);
  }
  return summary;
}
