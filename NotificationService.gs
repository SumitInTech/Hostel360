/**
 * HOSTEL 360 - NotificationService.gs
 * High-performance institutional email notifications with MailApp/GmailApp.
 * Delivers real-time emails to live addresses instantly,
 * while safely logging synthetic cohort notifications without network timeouts.
 */

var NotificationService = (function () {

  /**
   * Dispatches an email notification and records it
   */
  function sendEmail(recipientEmail, studentId, subject, messageBody, notificationType, skipDbInsert) {
    var notificationId = 'NOTIF_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var nowIso = new Date().toISOString();
    var status = 'SENT';
    var errorMessage = '';

    try {
      if (!recipientEmail || recipientEmail.indexOf('@') === -1) {
        throw new Error('Invalid recipient email: ' + recipientEmail);
      }

      var emailStr = String(recipientEmail).toLowerCase().trim();
      var isSynthetic = emailStr.indexOf('@hostel360.test') !== -1 || emailStr.indexOf('.test') !== -1 || emailStr.indexOf('.internal') !== -1;

      // Only invoke MailApp for real live email addresses (e.g. @gmail.com, university domains)
      if (!isSynthetic) {
        var htmlBody = '<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden;">' +
          '<div style="background-color: #1e3a8a; color: #ffffff; padding: 20px; text-align: center;">' +
          '<h2 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: 0.5px;">HOSTEL 360</h2>' +
          '<p style="margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;">Smart Hostel Allocation Management System</p>' +
          '</div>' +
          '<div style="padding: 24px; background-color: #ffffff;">' +
          messageBody.replace(/\n/g, '<br>') +
          '</div>' +
          '<div style="background-color: #f8fafc; padding: 16px; text-align: center; font-size: 12px; color: #64748b; border-top: 1px solid #e2e8f0;">' +
          '<p style="margin: 0;">This is an automated institutional notification from HOSTEL 360. Please do not reply directly to this email.</p>' +
          '</div>' +
          '</div>';

        MailApp.sendEmail({
          to: recipientEmail,
          subject: '[HOSTEL 360] ' + subject,
          body: messageBody,
          htmlBody: htmlBody,
          name: 'HOSTEL 360 Administration'
        });
      }

    } catch (err) {
      status = 'FAILED';
      errorMessage = err.message;
      Logger.log('Notification dispatch error for ' + recipientEmail + ': ' + err.message);
    }

    var notifRecord = {
      NotificationID: notificationId,
      RecipientEmail: recipientEmail || '',
      StudentID: studentId || '',
      Subject: subject || '',
      MessageBody: messageBody || '',
      NotificationType: notificationType || 'GENERAL',
      Status: status,
      SentAt: nowIso,
      ErrorMessage: errorMessage
    };

    if (!skipDbInsert) {
      try {
        SheetRepository.insertRecord(SheetRepository.SHEETS.NOTIFICATIONS, notifRecord);
      } catch (dbErr) {
        Logger.log('Failed to log notification record: ' + dbErr.message);
      }
    }

    return notifRecord;
  }

  /**
   * Sends confirmation when a student submits an application
   */
  function notifyApplicationSubmitted(student, application) {
    var subject = 'Hostel Application Submitted - ' + (application.ApplicationID || '');
    var body = 'Dear ' + (student.Name || 'Student') + ',\n\n' +
      'Your hostel accommodation application for Academic Year ' + (application.AcademicYear || '') + ' has been successfully submitted.\n\n' +
      'Application Summary:\n' +
      '- Application ID: ' + (application.ApplicationID || '') + '\n' +
      '- Enrollment Number: ' + (student.EnrollmentNo || 'N/A') + '\n' +
      '- Programme: ' + (student.Programme || 'N/A') + '\n' +
      '- Submission Timestamp: ' + (application.SubmissionDate || new Date().toISOString()) + '\n\n' +
      'Next Steps:\n' +
      '1. Ensure all mandatory documents have been uploaded in the student portal.\n' +
      '2. Your application and documents will be reviewed by the Hostel Warden.\n' +
      '3. You will receive an official notification once allocations are finalized and published.\n\n' +
      'Regards,\nHostel Administration';

    return sendEmail(student.StudentEmail, student.StudentID, subject, body, 'APPLICATION_SUBMITTED');
  }

  /**
   * Sends notification when hostel allocation is officially published
   */
  function notifyAllocationPublished(student, allocation, hostel, room, skipDbInsert) {
    var isAllocated = allocation && allocation.Status === 'PUBLISHED' && hostel && room;
    var subject = isAllocated ? 'Hostel Accommodation Allotted - ' + hostel.Name : 'Hostel Allocation Status Update';

    var body = '';
    if (isAllocated) {
      body = 'Dear ' + (student.Name || 'Student') + ',\n\n' +
        'We are pleased to inform you that you have been allotted a single-occupancy hostel room for Academic Year ' + (allocation.AcademicYear || '') + '.\n\n' +
        'Allotment Details:\n' +
        '- Hostel Name: ' + (hostel.Name || '') + ' (' + (hostel.Code || '') + ')\n' +
        '- Floor: ' + (room.FloorNumber || '') + '\n' +
        '- Room Number: ' + (room.RoomNumber || '') + '\n' +
        '- Allotment Date: ' + (allocation.AllocatedDate || '') + '\n\n' +
        'Allocation Explanation:\n' +
        (allocation.Explanation || 'Rule-based single-occupancy allotment.') + '\n\n' +
        'Next Steps:\n' +
        '1. Log in to the HOSTEL 360 portal to view your allotment letter.\n' +
        '2. Complete hostel fee payment and record payment transaction details in your dashboard.\n' +
        '3. Report to the Warden\'s office during designated reporting hours for physical possession.\n\n' +
        'Regards,\nHostel Warden & Administration';
    } else {
      body = 'Dear ' + (student.Name || 'Student') + ',\n\n' +
        'The hostel allocations for Academic Year ' + (allocation.AcademicYear || '') + ' have been published.\n\n' +
        'Status: ' + (allocation.Status || 'WAITLISTED') + '\n\n' +
        'Explanation / Note:\n' +
        (allocation.Explanation || 'Your application is currently waitlisted based on rule hierarchy and availability.') + '\n\n' +
        'Please monitor your student dashboard for updates if rooms become available.\n\n' +
        'Regards,\nHostel Administration';
    }

    return sendEmail(student.StudentEmail, student.StudentID, subject, body, 'ALLOCATION_PUBLISHED', skipDbInsert);
  }

  return {
    sendEmail: sendEmail,
    notifyApplicationSubmitted: notifyApplicationSubmitted,
    notifyAllocationPublished: notifyAllocationPublished
  };
})();

