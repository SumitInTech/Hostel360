/**
 * HOSTEL 360 - StudentComparator.gs
 * Deterministic multi-criteria comparator for ranking student applications.
 *
 * Official Logical Ordering:
 * 1. Priority Group (Hierarchy Tiers 1 to 6)
 * 2. Applicable Reservation / Category Priority
 * 3. Distance from Dwarka Campus (where applicable)
 * 4. Application Submission Timestamp (earliest first)
 *
 * Note: Academic marks/merit and Enrollment Numbers are NEVER used as institutional criteria.
 * An internal immutable ID is used solely as a technical deterministic safeguard if all fields match identically.
 */

var StudentComparator = (function () {

  // Category sorting weights when breaking ties within identical priority groups
  var CATEGORY_WEIGHTS = {
    'PWD': 1,
    'FOREIGN': 2,
    'ST': 3,
    'SC': 4,
    'OBC': 5,
    'EWS': 6,
    'GENERAL': 7
  };

  /**
   * Compares two application bundles for deterministic priority ordering
   *
   * @param {Object} a - { student, application, priorityGroup, distance }
   * @param {Object} b - { student, application, priorityGroup, distance }
   * @returns {number} Negative if a has higher priority than b, positive if b higher, 0 if equal
   */
  function compareApplications(a, b) {
    // 1. Primary: Priority Group Rank (1 to 6, lowest rank number is highest priority)
    var rankA = (a.priorityGroup && a.priorityGroup.rank) ? a.priorityGroup.rank : 99;
    var rankB = (b.priorityGroup && b.priorityGroup.rank) ? b.priorityGroup.rank : 99;
    if (rankA !== rankB) {
      return rankA - rankB;
    }

    // 2. Secondary: Category Weight (Reserved quotas evaluated before general within same tier)
    var catA = String(a.student.Category || 'GENERAL').toUpperCase();
    var catB = String(b.student.Category || 'GENERAL').toUpperCase();
    var weightA = (catA === 'GENERAL') ? 999 : (CATEGORY_WEIGHTS[catA] || 50);
    var weightB = (catB === 'GENERAL') ? 999 : (CATEGORY_WEIGHTS[catB] || 50);
    if (weightA !== weightB) {
      return weightA - weightB;
    }

    // 3. Tertiary: Distance from Dwarka Campus in km (Greater distance has higher priority within same tier)
    var distA = parseFloat(a.distance) || 0;
    var distB = parseFloat(b.distance) || 0;
    if (Math.abs(distA - distB) >= 0.1) {
      return distB - distA; // Descending: furthest student first
    }

    // 4. Quaternary: Application Submission Timestamp (Earliest submission first)
    var timeA = a.application.SubmissionDate ? new Date(a.application.SubmissionDate).getTime() : 0;
    var timeB = b.application.SubmissionDate ? new Date(b.application.SubmissionDate).getTime() : 0;
    if (timeA !== timeB) {
      return timeA - timeB; // Ascending: earlier first
    }

    // 5. Technical Deterministic Safeguard: Internal immutable ID
    var idA = String(a.application.ApplicationID || a.student.StudentID || '');
    var idB = String(b.application.ApplicationID || b.student.StudentID || '');
    return idA.localeCompare(idB);
  }

  /**
   * Sorts an array of application bundles deterministically
   */
  function sortApplications(applicationBundles) {
    return applicationBundles.slice().sort(compareApplications);
  }

  return {
    compareApplications: compareApplications,
    sortApplications: sortApplications
  };
})();
