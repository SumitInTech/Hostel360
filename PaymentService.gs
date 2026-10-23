/**
 * HOSTEL 360 - PaymentService.gs
 * Offline payment tracking, receipt recording, and Warden reconciliation.
 */

var PaymentService = (function () {

  /**
   * Records an offline payment transaction submitted by a student
   */
  function recordPayment(studentId, applicationId, academicYear, amount, paymentMode, transactionRef, paymentDate, ddBankName, ddBranchName, ddInFavorOf) {
    if (!studentId || !amount || !transactionRef) {
      throw new Error('Student ID, amount, and transaction reference / DD Number are required.');
    }

    var mode = String(paymentMode || 'DEMAND_DRAFT').toUpperCase();
    var paymentId = 'PAY_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var nowIso = new Date().toISOString();

    var fullRef = String(transactionRef).trim();
    var remarks = 'Submitted by student for physical verification';
    if (mode === 'DEMAND_DRAFT' && ddBankName) {
      remarks = 'DD #' + fullRef + ' | ' + ddBankName + (ddBranchName ? (' (' + ddBranchName + ')') : '') + ' | Payee: ' + (ddInFavorOf || 'Registrar, GGSIP University');
    }

    var paymentRecord = {
      PaymentID: paymentId,
      StudentID: studentId,
      ApplicationID: applicationId || '',
      AcademicYear: academicYear || '2026-27',
      Amount: parseFloat(amount) || 0,
      PaymentMode: mode,
      TransactionReference: fullRef,
      PaymentDate: paymentDate || nowIso.split('T')[0],
      DDBankName: ddBankName || '',
      DDBranchName: ddBranchName || '',
      DDInFavorOf: ddInFavorOf || 'Registrar, GGSIP University',
      Status: 'PENDING',
      VerifiedBy: '',
      VerifiedAt: '',
      Remarks: remarks,
      CreatedAt: nowIso
    };

    SheetRepository.insertRecord(SheetRepository.SHEETS.PAYMENTS, paymentRecord);

    AuditService.logAction(
      studentId,
      '',
      'STUDENT',
      'PAYMENT_SUBMITTED',
      'Payment',
      paymentId,
      null,
      { amount: amount, reference: transactionRef, mode: mode, bank: ddBankName },
      'Student recorded ' + mode + ' payment of INR ' + amount,
      'SUCCESS'
    );

    return paymentRecord;
  }

  /**
   * Warden verification of payment receipt
   */
  function verifyPayment(paymentId, status, remarks, wardenEmail, wardenUserId) {
    if (!paymentId || !status) {
      throw new Error('Payment ID and status are required.');
    }

    var cleanStatus = String(status).toUpperCase();
    var validStatuses = ['VERIFIED', 'REJECTED', 'PENDING', 'PAID'];
    if (validStatuses.indexOf(cleanStatus) === -1) {
      throw new Error('Invalid payment status: ' + status);
    }

    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.PAYMENTS, 'PaymentID', paymentId);
    if (!existing) {
      throw new Error('Payment record not found: ' + paymentId);
    }

    var nowIso = new Date().toISOString();
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.PAYMENTS, 'PaymentID', paymentId, {
      Status: cleanStatus,
      VerifiedBy: wardenEmail || 'Warden',
      VerifiedAt: nowIso,
      Remarks: remarks || ''
    });

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'PAYMENT_VERIFICATION',
      'Payment',
      paymentId,
      existing.Status,
      cleanStatus,
      remarks || 'Payment status updated to ' + cleanStatus,
      'SUCCESS'
    );

    return {
      paymentId: paymentId,
      status: cleanStatus,
      verifiedBy: wardenEmail,
      verifiedAt: nowIso
    };
  }

  /**
   * Retrieves payments for a specific student
   */
  function getStudentPayments(studentId) {
    if (!studentId) return [];
    return SheetRepository.findRecords(SheetRepository.SHEETS.PAYMENTS, function (p) {
      return String(p.StudentID) === String(studentId);
    });
  }

  /**
   * Retrieves all payments for an academic year
   */
  function getAllPayments(academicYear) {
    return SheetRepository.findRecords(SheetRepository.SHEETS.PAYMENTS, function (p) {
      if (!academicYear) return true;
      return String(p.AcademicYear) === String(academicYear);
    });
  }

  return {
    recordPayment: recordPayment,
    verifyPayment: verifyPayment,
    getStudentPayments: getStudentPayments,
    getAllPayments: getAllPayments
  };
})();
