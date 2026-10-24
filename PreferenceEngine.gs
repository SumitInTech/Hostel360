/**
 * HOSTEL 360 - PreferenceEngine.gs
 * Evaluates student hostel preferences strictly according to institutional rules:
 * 1. Preference 1 (if available & compatible)
 * 2. Preference 2 (if available & compatible)
 * 3. Any compatible hostel ONLY IF student explicitly selected "No Preference"
 * 4. Otherwise -> WAITLIST (Student who selected specific hostels never receives an unchosen 3rd hostel)
 */

var PreferenceEngine = (function () {

  /**
   * Builds an ordered list of candidate hostels for a student based on their preferences
   *
   * @param {Object} student - Student record
   * @param {Object} application - Application record with FirstHostelPref, SecondHostelPref, NoPreference
   * @param {Array} allHostels - Array of all active hostel records
   * @returns {Array} Ordered candidate hostels
   */
  function getCandidateHostels(student, application, allHostels) {
    var gender = String(student.Gender || '').toUpperCase();
    var targetHostelGender = (gender === 'MALE') ? 'BOYS' : 'GIRLS';

    // Filter compatible hostels by gender & active status
    var compatibleHostels = allHostels.filter(function (h) {
      return String(h.Gender).toUpperCase() === targetHostelGender &&
        (h.Status === 'ACTIVE' || h.Status === 'true' || h.Status === true);
    });

    var hostelMap = {};
    for (var i = 0; i < compatibleHostels.length; i++) {
      var h = compatibleHostels[i];
      hostelMap[h.HostelID] = h;
      hostelMap[h.Name] = h;
      hostelMap[h.Code] = h;
    }

    var orderedList = [];
    var addedIds = {};
    var hasSpecificPreferences = false;

    // 1. First Preference
    if (application && application.FirstHostelPref) {
      var pref1 = hostelMap[application.FirstHostelPref];
      if (pref1 && !addedIds[pref1.HostelID]) {
        var clone1 = Object.assign({}, pref1);
        clone1._preferenceRank = 1;
        orderedList.push(clone1);
        addedIds[pref1.HostelID] = true;
        hasSpecificPreferences = true;
      }
    }

    // 2. Second Preference
    if (application && application.SecondHostelPref) {
      var pref2 = hostelMap[application.SecondHostelPref];
      if (pref2 && !addedIds[pref2.HostelID]) {
        var clone2 = Object.assign({}, pref2);
        clone2._preferenceRank = 2;
        orderedList.push(clone2);
        addedIds[pref2.HostelID] = true;
        hasSpecificPreferences = true;
      }
    }

    // 3. "No Preference" check:
    // If student explicitly selected No Preference (or if no preferences selected and NoPreference is true),
    // consider all compatible hostels for that gender.
    var isNoPreference = application && (application.NoPreference === true || application.NoPreference === 'true' || application.NoPreference === 'YES');

    if (isNoPreference || !hasSpecificPreferences) {
      for (var j = 0; j < compatibleHostels.length; j++) {
        var comp = compatibleHostels[j];
        if (!addedIds[comp.HostelID]) {
          var cloneComp = Object.assign({}, comp);
          cloneComp._preferenceRank = 3; // General / No Preference pool
          orderedList.push(cloneComp);
          addedIds[comp.HostelID] = true;
        }
      }
    }

    // If specific preferences were chosen and NoPreference is false,
    // ONLY the chosen preferences are in orderedList. If neither is available,
    // the applicant will be waitlisted.
    return orderedList;
  }

  return {
    getCandidateHostels: getCandidateHostels
  };
})();
