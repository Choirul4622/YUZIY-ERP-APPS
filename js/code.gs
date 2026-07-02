/**
 * KIZIY APPS - Google Apps Script Backend (REST API)
 * URL: https://script.google.com/macros/s/AKfycbxr0HvZ6wOPMt_IBawWG68_dBDAnzKvEY2qvnU1lTyAUHkOvoLptiXEwq_Q-ZodjfCH/exec
 * Drive Folder ID: 15BELFMJiQV4RGVX927pXziFvyRdhhVE0
 *
 * Catatan keamanan:
 * - Kredensial TIDAK lagi hardcoded. User disimpan di sheet 'Users' (password di-hash
 *   SHA-256 + salt per-user). Sesi disimpan di sheet 'Sessions' (token UUID acak, berexpiry).
 * - Validasi token dilakukan untuk SEMUA aksi selain LOGIN (Zero-Trust).
 * - RBAC diterapkan di server: peran hanya boleh membaca/menulis modul yang diizinkan.
 *
 * SETUP PERTAMA KALI:
 *   1. Buka editor Apps Script, jalankan fungsi testSetup() SEKALI untuk otorisasi
 *      Google Sheets & Drive. Ini otomatis membuat sheet 'Users' & 'Sessions' dan
 *      men-seed 3 user default (superadmin/manager/staff, password: password123).
 *   2. SEGERA ganti password default melalui UI atau edit sheet 'Users' (input field
 *      baru dengan formula =hashPassword("passwordBaru", saltLama) — atau regenerate
 *      baris user). PASSWORD DEFAULT HANYA UNTUK TESTING.
 *   3. Deploy ulang sebagai Web App (versi baru) agar perubahan aktif.
 */

const FOLDER_ID = '15BELFMJiQV4RGVX927pXziFvyRdhhVE0';
const MASTER_INDEX_NAME = 'KIZIY_MASTER_INDEX';
const MAX_ROWS = 45000; // Limit sebelum auto-split (Maksimal GS ~5M cells, kita amankan di 45k baris)
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000; // 7 hari

// Peta RBAC: modul yang diizinkan per peran (lowercase, case-insensitive).
// Harus konsisten dengan auth.js (applyRBAC).
const RBAC_RULES = {
  'Superadmin': ['hrd', 'crm', 'pos', 'inventory', 'finance'],
  'Manager': ['hrd', 'crm', 'inventory'],
  'Staff': ['crm', 'pos']
};

// ==========================================
// 1. HTTP METHODS (GET & POST)
// ==========================================

function doPost(e) {
  // Serialisasi: Spreadsheet lemah terhadap concurrency, kunci dokumen.
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    return createJsonResponse({ status: 'error', message: 'Server sibuk, coba lagi sebentar.' });
  }

  try {
    const data = JSON.parse(e.postData.contents);
    const { action, payload, uuid, token } = data;

    // A. Login (satu-satunya aksi tanpa token)
    if (action === 'LOGIN') {
      const result = handleLogin_(payload);
      return createJsonResponse(result, result.status === 'success' ? 200 : 401);
    }

    // B. Logout (cukup token valid, lalu hapus sesi)
    if (action === 'LOGOUT') {
      if (token) deleteSession(token);
      return createJsonResponse({ status: 'success' });
    }

    // C. Zero-Trust: validasi token untuk semua aksi lain
    const session = validateToken(token);
    if (!session) {
      return createJsonResponse({ status: 'error', message: 'Unauthorized (Token tidak valid atau kedaluwarsa)' }, 401);
    }

    // D. Data Mutation Actions
    if (action === 'CREATE') {
      // RBAC server-side: tolak jika modul tidak diizinkan untuk peran ini
      const module = (payload && payload.module) ? String(payload.module) : '';
      if (!isModuleAllowed_(session.role, module)) {
        return createJsonResponse({ status: 'error', message: 'Forbidden: modul tidak diizinkan untuk peran Anda' }, 403);
      }

      let finalPayload = payload;

      // Jika ada sisipan foto dari mode Offline (Base64)
      if (payload.data) {
        let parsedData = JSON.parse(payload.data);
        if (parsedData.mediaBase64) {
          // Unggah ke Google Drive
          const driveResult = uploadToDrive(parsedData.mediaBase64, parsedData.fileName || 'upload.jpg', parsedData.mimeType || 'image/jpeg');

          // Hapus base64 yang sangat panjang agar tidak menuhin sel Spreadsheet
          delete parsedData.mediaBase64;
          delete parsedData.mimeType;
          delete parsedData.fileName;

          // Sisipkan URL hasil unggahan
          parsedData.mediaUrl = driveResult.url;
          finalPayload.data = JSON.stringify(parsedData);
        }
      }

      const result = saveRecordAutoSplit(finalPayload);
      return createJsonResponse({ status: 'success', data: result, uuid: uuid });
    } else if (action === 'UPLOAD_MEDIA') {
      const result = uploadToDrive(payload.base64, payload.fileName, payload.mimeType);
      return createJsonResponse({ status: 'success', data: result, uuid: uuid });
    }

    return createJsonResponse({ status: 'error', message: 'Aksi tidak dikenal' }, 400);
  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function doGet(e) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) {
    return createJsonResponse({ status: 'error', message: 'Server sibuk.' });
  }

  try {
    const action = e.parameter.action;
    const token = e.parameter.token;

    // Zero-Trust: GET juga butuh token
    const session = validateToken(token);
    if (!session) {
      return createJsonResponse({ status: 'error', message: 'Unauthorized' }, 401);
    }

    let result = [];
    if (action === 'fetchAll') {
      // Filter by role: user hanya menerima record modul yang diizinkan
      result = fetchAllData(session.role);
    }

    return createJsonResponse({ status: 'success', data: result });
  } catch (error) {
    return createJsonResponse({ status: 'error', message: error.toString() });
  } finally {
    lock.releaseLock();
  }
}

function createJsonResponse(data, statusCode) {
  // Catatan: GAS ContentService selalu mengembalikan HTTP 200 ke klien.
  // Sinyal status sebenarnya dibawa di field JSON `status`. Parameter statusCode
  // hanya untuk kejelasan dokumentasi.
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

// ==========================================
// 2. AUTHENTICATION & AUTHORIZATION
// ==========================================

/**
 * Proses login: cari user di sheet Users, bandingkan hash password.
 */
function handleLogin_(payload) {
  const username = (payload && payload.username) ? String(payload.username).trim() : '';
  const password = (payload && payload.password) ? String(payload.password) : '';

  if (!username || !password) {
    return { status: 'error', message: 'Username dan password wajib diisi' };
  }

  const sheet = getUsersSheet();
  const values = sheet.getDataRange().getValues();

  for (let i = 1; i < values.length; i++) {
    const row = values[i];
    const storedUsername = String(row[0]);
    if (storedUsername.toLowerCase() === username.toLowerCase()) {
      const storedHash = String(row[1]);
      const salt = String(row[2]);
      const role = String(row[3]);
      const computed = hashPassword(password, salt);
      if (computed === storedHash) {
        const session = createSession({ username: storedUsername, role: role });
        return {
          status: 'success',
          token: session.token,
          user: { username: storedUsername, role: role }
        };
      }
      break; // user cocok tapi password salah → jangan lanjut cari
    }
  }

  return { status: 'error', message: 'Kredensial tidak valid' };
}

/**
 * Buat sesi baru (token UUID acak + expiry). Disimpan di sheet Sessions.
 */
function createSession(user) {
  const sheet = getSessionsSheet();
  const token = Utilities.getUuid();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_DURATION_MS);
  sheet.appendRow([token, user.username, user.role, now.toISOString(), expires.toISOString()]);
  return { token: token, username: user.username, role: user.role };
}

/**
 * Validasi token: ada di sheet Sessions dan belum kedaluwarsa.
 * Mengembalikan {username, role} atau null.
 */
function validateToken(token) {
  if (!token) return null;
  const sheet = getSessionsSheet();
  const values = sheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][0]) === token) {
      const expires = new Date(values[i][4]);
      if (expires > now) {
        return { username: String(values[i][1]), role: String(values[i][2]) };
      }
      // kedaluwarsa → bersihkan
      sheet.deleteRow(i + 1);
      return null;
    }
  }
  return null;
}

/**
 * Hapus sesi (logout server-side).
 */
function deleteSession(token) {
  if (!token) return;
  const sheet = getSessionsSheet();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === token) {
      sheet.deleteRow(i + 1);
      return;
    }
  }
}

/**
 * RBAC: cek apakah peran boleh mengakses modul (case-insensitive).
 */
function isModuleAllowed_(role, module) {
  const allowed = getAllowedModules_(role);
  return allowed.indexOf(String(module).toLowerCase()) !== -1;
}

function getAllowedModules_(role) {
  return RBAC_RULES[role] ? RBAC_RULES[role].slice() : [];
}

/**
 * Hash password SHA-256 dengan salt. Mengembalikan hex string.
 */
function hashPassword(password, salt) {
  const raw = salt + ':' + password;
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    raw,
    Utilities.Charset.UTF_8
  );
  return digest.map(function (b) {
    const v = (b < 0) ? b + 256 : b; // byte → 0..255
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

/**
 * Generate salt acak (32 hex chars).
 */
function genSalt() {
  const seed = String(new Date().getTime()) + '-' + Math.random();
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed);
  return digest.slice(0, 16).map(function (b) {
    const v = (b < 0) ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}

// ==========================================
// 3. MASTER SPREADSHEET & SHEET HELPERS
// ==========================================

/**
 * Buka (atau buat) Master Spreadsheet. DB index berada di active sheet
 * (kompatibilitas dengan deployment yang sudah ada).
 */
function getMasterSpreadsheet_() {
  const folder = DriveApp.getFolderById(FOLDER_ID);
  const files = folder.searchFiles("title = '" + MASTER_INDEX_NAME + "'");

  if (files.hasNext()) {
    return SpreadsheetApp.openById(files.next().getId());
  }

  // Buat Master Index baru jika belum ada
  const masterSpreadsheet = SpreadsheetApp.create(MASTER_INDEX_NAME);
  DriveApp.getFileById(masterSpreadsheet.getId()).moveTo(folder);

  const sheet = masterSpreadsheet.getActiveSheet();
  sheet.appendRow(['ID_Spreadsheet', 'Created_At', 'Row_Count', 'Status']);

  return masterSpreadsheet;
}

/**
 * Helper: dapatkan (atau buat) sheet bernama `name` dengan header `headers`
 * di dalam Master Spreadsheet.
 */
function getNamedSheet_(name, headers) {
  const ss = getMasterSpreadsheet_();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

/**
 * Sheet Users. Di-seed sekali dengan user default saat pertama dibuat atau
 * saat kosong (mis. admin menghapus semua baris). Setiap (re)seed memakai salt baru.
 */
function getUsersSheet() {
  const sheet = getNamedSheet_('Users', ['username', 'passwordHash', 'salt', 'role', 'createdAt']);
  const rowCount = sheet.getLastRow();
  if (rowCount < 2) {
    // kosong → seed user default (HANYA untuk testing; ganti password sesegera mungkin)
    const defaults = [
      { username: 'superadmin', password: 'password123', role: 'Superadmin' },
      { username: 'manager', password: 'password123', role: 'Manager' },
      { username: 'staff', password: 'password123', role: 'Staff' }
    ];
    const now = new Date().toISOString();
    for (let i = 0; i < defaults.length; i++) {
      const salt = genSalt();
      const hash = hashPassword(defaults[i].password, salt);
      sheet.appendRow([defaults[i].username, hash, salt, defaults[i].role, now]);
    }
  }
  return sheet;
}

function getSessionsSheet() {
  return getNamedSheet_('Sessions', ['token', 'username', 'role', 'createdAt', 'expiresAt']);
}

function getMasterIndexSheet() {
  // DB shard index tetap di active sheet (perilaku asli).
  return getMasterSpreadsheet_().getActiveSheet();
}

// ==========================================
// 4. DB SHARDING & AUTO-SPLIT (WRITER)
// ==========================================

function getActiveDatabaseSheet() {
  const masterSheet = getMasterIndexSheet();
  const data = masterSheet.getDataRange().getValues();

  let activeDbId = null;
  let activeDbRowIndex = -1;

  // Cek database yang berstatus 'ACTIVE'
  for (let i = 1; i < data.length; i++) {
    if (data[i][3] === 'ACTIVE') {
      activeDbId = data[i][0];
      activeDbRowIndex = i + 1; // 1-based index untuk update row
      break;
    }
  }

  let dbSpreadsheet;
  let isNewDb = false;
  const folder = DriveApp.getFolderById(FOLDER_ID);

  if (!activeDbId) {
    isNewDb = true;
  } else {
    dbSpreadsheet = SpreadsheetApp.openById(activeDbId);
    const sheet = dbSpreadsheet.getActiveSheet();
    const lastRow = sheet.getLastRow();

    if (lastRow >= MAX_ROWS) {
      // Tutup sheet lama (FULL)
      masterSheet.getRange(activeDbRowIndex, 4).setValue('FULL');
      masterSheet.getRange(activeDbRowIndex, 3).setValue(lastRow);
      isNewDb = true;
    }
  }

  if (isNewDb) {
    const timestamp = new Date().toISOString();
    dbSpreadsheet = SpreadsheetApp.create('KIZIY_DB_SHARD_' + timestamp);
    const file = DriveApp.getFileById(dbSpreadsheet.getId());
    file.moveTo(folder); // Simpan di folder yang sama

    const sheet = dbSpreadsheet.getActiveSheet();
    // Header standard (auto-capture fields)
    sheet.appendRow(['ID', 'Module', 'Data', 'Timestamp', 'SyncStatus']);

    // Daftarkan ke Master Index
    masterSheet.appendRow([dbSpreadsheet.getId(), timestamp, 1, 'ACTIVE']);
  }

  return dbSpreadsheet.getActiveSheet();
}

function saveRecordAutoSplit(payload) {
  const sheet = getActiveDatabaseSheet();

  // payload.data, payload.id, payload.module, payload.timestamp
  sheet.appendRow([
    payload.id,
    payload.module,
    payload.data,
    payload.timestamp,
    'synced' // Status saat masuk GAS
  ]);

  return { id: payload.id, status: 'saved' };
}

// ==========================================
// 5. CROSS-SHEET FETCHING (MAP-REDUCE)
// ==========================================

function fetchAllData(role) {
  const masterSheet = getMasterIndexSheet();
  const data = masterSheet.getDataRange().getValues();
  const allowedModules = getAllowedModules_(role);

  let allRecords = [];

  // Map: Ambil data dari semua spreadsheet yang terdaftar
  for (let i = 1; i < data.length; i++) {
    const dbId = data[i][0];
    try {
      const dbSs = SpreadsheetApp.openById(dbId);
      const sheet = dbSs.getActiveSheet();
      const rows = sheet.getDataRange().getValues();

      // Reduce: Gabungkan ke allRecords (skip header) + filter RBAC
      for (let j = 1; j < rows.length; j++) {
        const row = rows[j];
        const modLower = String(row[1]).toLowerCase();
        if (allowedModules.indexOf(modLower) === -1) continue;

        allRecords.push({
          id: row[0],
          module: row[1],
          data: row[2],
          timestamp: row[3],
          syncStatus: row[4]
        });
      }
    } catch (e) {
      Logger.log('Gagal membaca sheet ID: ' + dbId + ' Error: ' + e.message);
    }
  }

  return allRecords;
}

// ==========================================
// 6. GOOGLE DRIVE MULTIMEDIA STORAGE
// ==========================================

function uploadToDrive(base64Data, fileName, mimeType) {
  const folder = DriveApp.getFolderById(FOLDER_ID);

  // Konversi dari base64 ke Blob
  const decodedData = Utilities.base64Decode(base64Data);
  const blob = Utilities.newBlob(decodedData, mimeType, fileName);

  const file = folder.createFile(blob);

  return {
    url: file.getUrl(),
    id: file.getId()
  };
}

// ==========================================
// 7. SETUP & AUTHORIZATION
// ==========================================

/**
 * Jalankan fungsi ini HANYA SEKALI dari editor Apps Script
 * untuk memunculkan pop-up izin akses (Authorization)
 * ke Google Drive dan Google Sheets Anda.
 * Juga sekaligus menginisialisasi sheet Users & Sessions.
 */
function testSetup() {
  Logger.log('Memulai setup otorisasi...');
  try {
    const sheet = getMasterIndexSheet();
    Logger.log('Otorisasi Google Sheets & Drive OK. Master Index: ' + sheet.getName());

    const usersSheet = getUsersSheet();
    Logger.log('Sheet Users siap. Baris: ' + usersSheet.getLastRow());

    const sessionsSheet = getSessionsSheet();
    Logger.log('Sheet Sessions siap. Baris: ' + sessionsSheet.getLastRow());

    Logger.log('LOGIN UJI (superadmin/password123): ' + JSON.stringify(handleLogin_({ username: 'superadmin', password: 'password123' })));
    Logger.log('PENTING: segera ganti password default user di sheet Users.');
  } catch (e) {
    Logger.log('Gagal otorisasi: ' + e.message);
  }
}
