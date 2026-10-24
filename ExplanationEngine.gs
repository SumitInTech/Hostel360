/**
 * HOSTEL 360 - ExplanationEngine.gs
 * Deterministic template-based generation of human-readable allocation & waitlist explanations.
 * Zero LLM dependency.
 */

var ExplanationEngine = (function () {

  /**
   * Generates deterministic explanation for an allocated student
   */
  function generateAllocationExplanation(context) {
    var studentName = context.studentName || 'Student';
    var hostelName = context.hostelName || 'Hostel';
    var roomNumber = context.roomNumber || 'Room';
    var priorityGroupName = context.priorityGroupName || 'Standard Priority';
    var category = context.category || 'GENERAL';
    var distance = context.distance ? Math.round(context.distance) : 0;
    var preferenceRank = context.preferenceRank;

    var prefText = 'your primary hostel preference';
    if (preferenceRank === 2) {
      prefText = 'your secondary hostel preference (first preference was at full capacity)';
    } else if (preferenceRank >= 3) {
      prefText = 'an available compatible hostel in accordance with your "No Preference" selection';
    }

    var explanation = 'Dear ' + studentName + ', you have been allocated Room ' + roomNumber + ' in ' + hostelName +
      ' based on the institutional hostel policy. You qualified under the "' + priorityGroupName + '" priority tier' +
      (category !== 'GENERAL' ? ' under the ' + category + ' reservation quota' : '') +
      (distance > 0 ? ' with an evaluated distance of ' + distance + ' km from Dwarka campus' : '') + '.' +
      ' This allocation fulfilled ' + prefText + ' with a verified single-occupancy room adhering to strict capacity and gender isolation guidelines.';

    return explanation;
  }

  /**
   * Generates deterministic explanation for a waitlisted student
   */
  function generateWaitlistExplanation(context) {
    var studentName = context.studentName || 'Student';
    var waitlistPos = context.waitlistPosition || 1;
    var priorityGroupName = context.priorityGroupName || 'Standard Priority';
    var category = context.category || 'GENERAL';
    var distance = context.distance ? Math.round(context.distance) : 0;
    var reason = context.reason;

    var reasonText = reason || 'all single-occupancy rooms in your preferred/compatible hostels were allotted to higher-ranked applicants or reserved quota constraints';

    var explanation = 'Dear ' + studentName + ', you have been placed at position #' + waitlistPos +
      ' on the institutional hostel waitlist for your category. While your application is eligible under the "' +
      priorityGroupName + '" tier (' + category + ' category' + (distance > 0 ? ', ' + distance + ' km distance' : '') +
      '), ' + reasonText + '.' +
      ' Should vacancies arise through cancellation or explicit Warden quota release, waitlisted applicants will be admitted in strict position order.';

    return explanation;
  }

  /**
   * Generates deterministic explanation for an ineligible application
   */
  function generateIneligibilityExplanation(reasons) {
    var list = (reasons && reasons.length > 0) ? reasons : ['Eligibility criteria not satisfied.'];
    return 'Your hostel accommodation application is currently marked INELIGIBLE due to the following institutional requirement(s): ' +
      list.join('; ') + '. Please rectify the discrepancies or contact the Warden\'s office.';
  }

  return {
    generateAllocationExplanation: generateAllocationExplanation,
    generateWaitlistExplanation: generateWaitlistExplanation,
    generateIneligibilityExplanation: generateIneligibilityExplanation
  };
})();
