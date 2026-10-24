/**
 * HOSTEL 360 - AuthService.gs
 * Secure authentication with Salted SHA-256 password hashing and role-based access control.
 */

var AuthService = (function () {

  /**
   * Generates a cryptographically random salt string
   */
  function generateSalt() {
    var uuid = Utilities.getUuid();
    var randomStr = Math.random().toString(36).substring(2) + new Date().getTime().toString(36);
    var raw = uuid + '_' + randomStr;
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw, Utilities.Charset.UTF_8);
    return digestToHex(digest);
  }

  /**
   * Converts byte array digest to hexadecimal string
   */
  function digestToHex(digest) {
    var hex = '';
    for (var i = 0; i < digest.length; i++) {
      var byteVal = digest[i];
      if (byteVal < 0) byteVal += 256;
      var byteHex = byteVal.toString(16);
      if (byteHex.length === 1) byteHex = '0' + byteHex;
      hex += byteHex;
    }
    return hex;
  }

  /**
   * Computes SHA-256 hash of password combined with salt
   */
  function hashPassword(password, salt) {
    if (!password || !salt) {
      throw new Error('Password and salt are required for hashing.');
    }
    var combined = String(password) + ':' + String(salt);
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, combined, Utilities.Charset.UTF_8);
    return digestToHex(digest);
  }

  /**
   * Authenticates a user by email and password
   */
  function authenticate(email, password) {
    if (!email || !password) {
      throw new Error('Email and password are required.');
    }

    var cleanEmail = String(email).trim().toLowerCase();
    var userRecord = SheetRepository.findRecordByKey(SheetRepository.SHEETS.USERS, 'Email', cleanEmail);

    if (!userRecord) {
      throw new Error('Invalid email or password.');
    }

    if (String(userRecord.Status).toUpperCase() !== 'ACTIVE') {
      throw new Error('Account is deactivated. Please contact the Hostel Administration.');
    }

    var salt = userRecord.Salt;
    var expectedHash = userRecord.PasswordHash;
    var computedHash = hashPassword(password, salt);

    if (computedHash !== expectedHash) {
      AuditService.logAction(
        userRecord.UserID,
        cleanEmail,
        userRecord.Role || 'UNKNOWN',
        'LOGIN_FAILED',
        'User',
        userRecord.UserID,
        null,
        null,
        'Incorrect password attempt',
        'FAILURE'
      );
      throw new Error('Invalid email or password.');
    }

    // Update LastLogin
    var nowIso = new Date().toISOString();
    SheetRepository.updateRecordByKey(SheetRepository.SHEETS.USERS, 'UserID', userRecord.UserID, {
      LastLogin: nowIso
    });

    // Create authenticated session
    var session = SessionService.createSession(userRecord);

    // Audit log
    AuditService.logAction(
      userRecord.UserID,
      cleanEmail,
      userRecord.Role,
      'LOGIN_SUCCESS',
      'User',
      userRecord.UserID,
      null,
      null,
      'User logged in successfully',
      'SUCCESS'
    );

    return session;
  }

  /**
   * Registers a new user with salted SHA-256 hash
   */
  function registerUser(email, password, role, name, studentId) {
    var cleanEmail = String(email).trim().toLowerCase();
    var existing = SheetRepository.findRecordByKey(SheetRepository.SHEETS.USERS, 'Email', cleanEmail);
    if (existing) {
      throw new Error('An account with this email already exists.');
    }

    var salt = generateSalt();
    var passwordHash = hashPassword(password, salt);
    var userId = 'USR_' + Utilities.getUuid().substring(0, 8).toUpperCase();
    var nowIso = new Date().toISOString();

    var newUser = {
      UserID: userId,
      Email: cleanEmail,
      PasswordHash: passwordHash,
      Salt: salt,
      Role: String(role).toUpperCase(),
      StudentID: studentId || '',
      Name: name || '',
      Status: 'ACTIVE',
      CreatedAt: nowIso,
      LastLogin: ''
    };

    SheetRepository.insertRecord(SheetRepository.SHEETS.USERS, newUser);

    AuditService.logAction(
      userId,
      cleanEmail,
      newUser.Role,
      'USER_REGISTERED',
      'User',
      userId,
      null,
      null,
      'New user registered: ' + cleanEmail,
      'SUCCESS'
    );

    return {
      userId: newUser.UserID,
      email: newUser.Email,
      role: newUser.Role,
      studentId: newUser.StudentID,
      name: newUser.Name
    };
  }

  /**
   * Validates session token and returns session user payload
   */
  function validateSession(token) {
    if (!token) return null;
    return SessionService.getSession(token);
  }

  /**
   * Enforces that request is authenticated
   */
  function requireAuth(token) {
    var session = validateSession(token);
    if (!session) {
      throw new Error('Unauthorized. Invalid or expired session. Please log in again.');
    }
    return session;
  }

  /**
   * Enforces that request is authenticated with specified role
   */
  function requireRole(token, allowedRoles) {
    var session = requireAuth(token);
    var roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];
    var upperRoles = roles.map(function (r) { return String(r).toUpperCase(); });

    if (upperRoles.indexOf(session.role) === -1) {
      AuditService.logAction(
        session.userId,
        session.email,
        session.role,
        'UNAUTHORIZED_ACCESS_ATTEMPT',
        'Security',
        session.userId,
        null,
        null,
        'Role ' + session.role + ' attempted access requiring ' + upperRoles.join(','),
        'FAILURE'
      );
      throw new Error('Access denied. You do not have permission to perform this action.');
    }
    return session;
  }

  /**
   * Enforces that a student can only access their own records
   */
  function requireStudentOwnership(token, studentId) {
    var session = requireAuth(token);
    if (session.role === 'WARDEN') {
      return session; // Wardens can access any student record
    }
    if (session.role === 'STUDENT') {
      if (String(session.studentId) !== String(studentId)) {
        AuditService.logAction(
          session.userId,
          session.email,
          session.role,
          'SECURITY_VIOLATION_ID_MISMATCH',
          'Student',
          studentId,
          null,
          null,
          'Student attempted unauthorized access to record ' + studentId,
          'FAILURE'
        );
        throw new Error('Access denied. You may only access your own records.');
      }
      return session;
    }
    throw new Error('Access denied.');
  }

  return {
    generateSalt: generateSalt,
    hashPassword: hashPassword,
    authenticate: authenticate,
    registerUser: registerUser,
    validateSession: validateSession,
    requireAuth: requireAuth,
    requireRole: requireRole,
    requireStudentOwnership: requireStudentOwnership
  };
})();
