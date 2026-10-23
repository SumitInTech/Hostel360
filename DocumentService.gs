/**
 * HOSTEL 360 - DocumentService.gs
 * Google Drive file management, metadata tracking, and Warden verification workflows.
 */

var DocumentService = (function () {

  var DRIVE_FOLDER_NAME = 'HOSTEL_360_STUDENT_DOCUMENTS';

  /**
   * Gets or creates the dedicated Google Drive folder for document storage
   */
  function getOrCreateDocumentFolder() {
    var folders = DriveApp.getFoldersByName(DRIVE_FOLDER_NAME);
    if (folders.hasNext()) {
      return folders.next();
    }
    return DriveApp.createFolder(DRIVE_FOLDER_NAME);
  }

  /**
   * Uploads a document from Base64 data to Google Drive and records metadata in Documents sheet
   *
   * @param {string} studentId
   * @param {string} applicationId
   * @param {string} documentType
   * @param {string} base64Data
   * @param {string} fileName
   * @param {string} mimeType
   */
  function uploadDocument(studentId, applicationId, documentType, base64Data, fileName, mimeType) {
    if (!studentId || !documentType || !base64Data) {
      throw new Error('Student ID, document type, and file data are required.');
    }

    var cleanMimeType = mimeType || 'application/pdf';
    var cleanFileName = (studentId + '_' + documentType + '_' + (fileName || 'document.pdf')).replace(/[^a-zA-Z0-9._-]/g, '_');
    
    // Clean base64 header if present
    var rawBase64 = base64Data;
    if (base64Data.indexOf(',') !== -1) {
      rawBase64 = base64Data.split(',')[1];
    }

    var decodedBytes = Utilities.base64Decode(rawBase64);
    var blob = Utilities.newBlob(decodedBytes, cleanMimeType, cleanFileName);

    var folder = getOrCreateDocumentFolder();
    var driveFile = folder.createFile(blob);
    var fileId = driveFile.getId();
    var fileUrl = driveFile.getUrl();

    var documentId = 'DOC_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var nowIso = new Date().toISOString();

    // Check if a document of this type already exists for this student/application
    var existingDocs = SheetRepository.findRecords(SheetRepository.SHEETS.DOCUMENTS, function (doc) {
      return String(doc.StudentID) === String(studentId) && String(doc.DocumentType) === String(documentType);
    });

    if (existingDocs.length > 0) {
      // Update existing record with new file and reset verification status to PENDING
      var existingId = existingDocs[0].DocumentID;
      SheetRepository.updateRecordByKey(SheetRepository.SHEETS.DOCUMENTS, 'DocumentID', existingId, {
        ApplicationID: applicationId || existingDocs[0].ApplicationID,
        DriveFileID: fileId,
        DriveURL: fileUrl,
        UploadedAt: nowIso,
        VerificationStatus: 'PENDING',
        VerifiedBy: '',
        VerifiedAt: '',
        Remarks: 'Updated by student'
      });
      documentId = existingId;
    } else {
      var record = {
        DocumentID: documentId,
        ApplicationID: applicationId || '',
        StudentID: studentId,
        DocumentType: documentType,
        DriveFileID: fileId,
        DriveURL: fileUrl,
        UploadedAt: nowIso,
        VerificationStatus: 'PENDING',
        VerifiedBy: '',
        VerifiedAt: '',
        Remarks: ''
      };
      SheetRepository.insertRecord(SheetRepository.SHEETS.DOCUMENTS, record);
    }

    AuditService.logAction(
      studentId,
      '',
      'STUDENT',
      'DOCUMENT_UPLOADED',
      'Document',
      documentId,
      null,
      { documentType: documentType, fileName: cleanFileName },
      'Student uploaded document: ' + documentType,
      'SUCCESS'
    );

    return {
      documentId: documentId,
      documentType: documentType,
      fileId: fileId,
      fileUrl: fileUrl,
      status: 'PENDING'
    };
  }

  /**
   * Retrieves all documents for a specific student
   */
  function getStudentDocuments(studentId) {
    if (!studentId) return [];
    return SheetRepository.findRecords(SheetRepository.SHEETS.DOCUMENTS, function (doc) {
      return String(doc.StudentID) === String(studentId);
    });
  }

  /**
   * Retrieves all documents for a specific application
   */
  function getApplicationDocuments(applicationId) {
    if (!applicationId) return [];
    return SheetRepository.findRecords(SheetRepository.SHEETS.DOCUMENTS, function (doc) {
      return String(doc.ApplicationID) === String(applicationId);
    });
  }

  /**
   * Warden verification or rejection of a student document
   */
  function verifyDocument(documentId, status, remarks, wardenEmail, wardenUserId) {
    if (!documentId || !status) {
      throw new Error('Document ID and status are required.');
    }

    var validStatuses = ['VERIFIED', 'REJECTED', 'PENDING'];
    var cleanStatus = String(status).toUpperCase();
    if (validStatuses.indexOf(cleanStatus) === -1) {
      throw new Error('Invalid verification status: ' + status);
    }

    var doc = SheetRepository.findRecordByKey(SheetRepository.SHEETS.DOCUMENTS, 'DocumentID', documentId);
    if (!doc) {
      throw new Error('Document not found: ' + documentId);
    }

    var nowIso = new Date().toISOString();
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.DOCUMENTS, 'DocumentID', documentId, {
      VerificationStatus: cleanStatus,
      VerifiedBy: wardenEmail || 'Warden',
      VerifiedAt: nowIso,
      Remarks: remarks || ''
    });

    AuditService.logAction(
      wardenUserId || 'WARDEN',
      wardenEmail || 'warden@hostel360.internal',
      'WARDEN',
      'DOCUMENT_VERIFICATION',
      'Document',
      documentId,
      doc.VerificationStatus,
      cleanStatus,
      remarks || 'Document status updated to ' + cleanStatus,
      'SUCCESS'
    );

    // SMRITI ADVISORY HOOK: Retain document rejection
    if (cleanStatus === 'REJECTED') {
      try {
        if (typeof MemoryService !== 'undefined' && MemoryService.smritiRetain) {
          var yr = (typeof PolicyEngine !== 'undefined') ? PolicyEngine.getActiveAcademicYear().AcademicYear : '2026-27';
          var docContent = 'In academic year ' + yr + ', document of type ' + (doc.DocumentType || 'DOCUMENT') + ' was rejected. Rejection reason: ' + (remarks || 'Document verification criteria not satisfied') + '.';
          MemoryService.smritiRetain(docContent, 'document_rejection');
        }
      } catch (smritiErr) {
        Logger.log('Smriti retain error (doc rejection): ' + smritiErr.message);
      }
    }

    return {
      documentId: documentId,
      status: cleanStatus,
      verifiedBy: wardenEmail,
      verifiedAt: nowIso
    };
  }

  return {
    uploadDocument: uploadDocument,
    getStudentDocuments: getStudentDocuments,
    getApplicationDocuments: getApplicationDocuments,
    verifyDocument: verifyDocument
  };
})();
