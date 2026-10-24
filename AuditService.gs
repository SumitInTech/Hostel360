/**
 * HOSTEL 360 - AuditService.gs
 * Immutable audit logging for all administrative, security, and lifecycle actions.
 */

var AuditService = (function () {

  /**
   * Logs an action to the AuditLog sheet
   */
  function logAction(userId, email, role, action, entityType, entityId, oldValue, newValue, reason, status) {
    try {
      var auditId = 'AUD_' + Utilities.getUuid().substring(0, 8).toUpperCase();
      var nowIso = new Date().toISOString();

      var record = {
        AuditID: auditId,
        Timestamp: nowIso,
        UserID: userId || 'SYSTEM',
        Email: email || 'system@hostel360.internal',
        Role: role || 'SYSTEM',
        Action: action || 'UNKNOWN',
        EntityType: entityType || 'GENERAL',
        EntityID: entityId || '',
        OldValue: oldValue ? (typeof oldValue === 'object' ? JSON.stringify(oldValue) : String(oldValue)) : '',
        NewValue: newValue ? (typeof newValue === 'object' ? JSON.stringify(newValue) : String(newValue)) : '',
        Reason: reason || '',
        IPAddress: '0.0.0.0', // GAS does not expose client IP directly
        Status: status || 'SUCCESS'
      };

      SheetRepository.insertRecord(SheetRepository.SHEETS.AUDIT_LOG, record);
      return auditId;
    } catch (err) {
      Logger.log('Error writing audit log: ' + err.message);
      return null;
    }
  }

  /**
   * Fetches audit logs with optional filtering and limit
   */
  function getAuditLogs(limit, filterRole, filterAction) {
    var records = SheetRepository.getAllRecords(SheetRepository.SHEETS.AUDIT_LOG);
    records.reverse(); // Newest first

    if (filterRole) {
      records = records.filter(function (r) { return String(r.Role).toUpperCase() === String(filterRole).toUpperCase(); });
    }
    if (filterAction) {
      records = records.filter(function (r) { return String(r.Action).toUpperCase().indexOf(String(filterAction).toUpperCase()) !== -1; });
    }

    var max = limit || 200;
    return records.slice(0, max);
  }

  return {
    logAction: logAction,
    getAuditLogs: getAuditLogs
  };
})();
