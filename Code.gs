/**
 * ALLStreaming — Google Apps Script backend
 *
 * This is your entire backend. It reads/writes keys in a Google Sheet and is
 * deployed as a Web App that your site (app.js / admin.js) calls.
 *
 * SETUP
 * 1. Create a new Google Sheet.
 * 2. Extensions -> Apps Script, delete the default code, paste this file in.
 * 3. Run the `setAdminPassword` function once (grants permissions + sets the
 *    admin panel password). You can also set it later via the Run menu.
 * 4. Deploy -> New deployment -> Web app:
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the /exec URL and paste it as APPS_SCRIPT_URL in app.js and admin.js.
 *
 * Sheet layout (tab "Keys"):
 *   key | validDays | validMinutes | userNote | status | createdBy | createdAt | activatedAt | expiresAt
 *   status values: active (default) or revoked
 *   activatedAt / expiresAt are written automatically on first use.
 */

var SHEET_NAME = 'Keys';

var COL = {
  KEY: 1,
  DAYS: 2,
  MINUTES: 3,
  NOTE: 4,
  STATUS: 5,
  CREATED_BY: 6,
  CREATED_AT: 7,
  ACTIVATED_AT: 8,
  EXPIRES_AT: 9
};

/* ------------------------------------------------------------------ */
/* Deployment entry points                                             */
/* ------------------------------------------------------------------ */

function doPost(e) {
  var body = {};
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    body = {};
  }
  var result;
  try {
    result = route_(body);
  } catch (err) {
    result = { ok: false, error: 'Server error: ' + err };
  }
  return jsonOut_(result);
}

function doGet() {
  return jsonOut_({ ok: true, service: 'ALLStreaming', time: new Date().toISOString() });
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ */
/* Router                                                              */
/* ------------------------------------------------------------------ */

function route_(body) {
  var action = body && body.action;

  if (action === 'validate-key') return validateKey_(body.key);
  if (action === 'verify-token') return verifyToken_(body.token);
  if (action === 'admin-login') return adminLogin_(body.password);

  if (!isAdmin_(body)) return { ok: false, error: 'Not authenticated' };

  switch (action) {
    case 'admin-check': return { ok: true, valid: true };
    case 'admin-list': return adminList_();
    case 'admin-check-key': return adminCheckKey_(body.key);
    case 'admin-add': return adminAdd_(body.key, body.validDays, body.validMinutes, body.userNote);
    case 'admin-disable': return adminSetStatus_(body.key, 'revoked');
    case 'admin-enable': return adminSetStatus_(body.key, 'active');
    case 'admin-delete': return adminDelete_(body.key);
    case 'admin-extend': return adminExtend_(body.key, body.addDays);
  }

  return { ok: false, error: 'Unknown action' };
}

/* ------------------------------------------------------------------ */
/* Public actions                                                      */
/* ------------------------------------------------------------------ */

function validateKey_(rawKey) {
  var key = String(rawKey || '').trim();
  if (!key) return { ok: false, valid: false, error: 'Invalid key' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sheet = getSheet_();
    var row = findRow_(sheet, key);
    if (!row) return { ok: false, valid: false, error: 'Invalid key' };

    var d = getData_(row, sheet);
    if (d.status === 'revoked') return { ok: false, valid: false, error: 'revoked' };

    var dur = durationMs_(d);
    if (dur <= 0) return { ok: false, valid: false, error: 'Invalid key configuration' };

    var now = Date.now();
    var activatedAt, expiresAt;
    if (d.activatedAt) {
      activatedAt = new Date(d.activatedAt);
      expiresAt = new Date(activatedAt.getTime() + dur);
    } else {
      activatedAt = new Date(now);
      expiresAt = new Date(now + dur);
      sheet.getRange(row, COL.ACTIVATED_AT).setValue(activatedAt);
      sheet.getRange(row, COL.EXPIRES_AT).setValue(expiresAt);
    }

    var remainingMs = expiresAt.getTime() - now;
    if (remainingMs <= 0) return { ok: false, valid: false, error: 'expired' };

    var token = makeToken_({ k: d.key, a: activatedAt.toISOString(), e: expiresAt.getTime() });

    return {
      ok: true,
      valid: true,
      token: token,
      remainingMs: remainingMs,
      remainingText: durationLabel_(d),
      redirectB64: encodeRedirect_(getTargetUrl_()),
      activatedAt: activatedAt.toISOString(),
      expiresAt: expiresAt.toISOString()
    };
  } finally {
    lock.releaseLock();
  }
}

function verifyToken_(token) {
  var d = parseToken_(token);
  if (!d || !d.e) return { ok: false, valid: false, error: 'Invalid token' };
  if (d.e < Date.now()) return { ok: false, valid: false, error: 'expired' };
  return { ok: true, valid: true, remainingMs: d.e - Date.now(), redirectB64: encodeRedirect_(getTargetUrl_()) };
}

/* ------------------------------------------------------------------ */
/* Admin actions                                                       */
/* ------------------------------------------------------------------ */

function adminLogin_(password) {
  if (String(password || '') !== getAdminPassword_()) {
    return { ok: false, error: 'Wrong password' };
  }
  return { ok: true, valid: true, token: makeAdminToken_() };
}

function adminList_() {
  var sheet = getSheet_();
  var last = sheet.getLastRow();
  var out = [];
  for (var r = 2; r <= last; r++) {
    var d = getData_(r, sheet);
    if (!d.key) continue;

    var dur = durationMs_(d);
    var item = {
      key: d.key,
      validDays: d.validDays,
      validMinutes: d.validMinutes,
      durationLabel: durationLabel_(d),
      userNote: d.note,
      disabled: d.status === 'revoked'
    };
    if (d.activatedAt) {
      var activatedAt = new Date(d.activatedAt);
      var expiresAt = d.expiresAt ? new Date(d.expiresAt) : new Date(activatedAt.getTime() + dur);
      item.activatedAt = activatedAt.toISOString();
      item.expiresAt = expiresAt.getTime();
      item.remainingMs = expiresAt.getTime() - Date.now();
    }
    out.push(item);
  }
  return { ok: true, keys: out };
}

function adminCheckKey_(rawKey) {
  var key = String(rawKey || '').trim();
  if (!key) return { ok: false, error: 'Key name required' };

  var sheet = getSheet_();
  var row = findRow_(sheet, key);
  if (!row) return { ok: true, valid: false, error: 'Key not found in spreadsheet' };

  var d = getData_(row, sheet);
  if (d.status === 'revoked') return { ok: true, valid: false, error: 'Key is revoked' };

  var dur = durationMs_(d);
  if (dur <= 0) return { ok: true, valid: false, error: 'Invalid key configuration' };

  var now = Date.now();
  if (d.activatedAt) {
    var activatedAt = new Date(d.activatedAt);
    var expiresAt = new Date(activatedAt.getTime() + dur);
    var remainingMs = expiresAt.getTime() - now;
    if (remainingMs <= 0) {
      return { ok: true, valid: false, error: 'expired', activatedAt: activatedAt.toISOString(), expiresAt: expiresAt.toISOString() };
    }
    return { ok: true, valid: true, activatedAt: activatedAt.toISOString(), expiresAt: expiresAt.toISOString(), remainingMs: remainingMs, durationLabel: durationLabel_(d) };
  }

  return { ok: true, valid: true, activatedAt: null, expiresAt: null, remainingMs: dur, durationLabel: durationLabel_(d), note: 'Not yet activated by any user' };
}

function adminAdd_(rawKey, days, minutes, note) {
  var key = String(rawKey || '').trim().toUpperCase();
  var d = Number(days) || 0;
  var m = Number(minutes) || 0;
  if (!key) return { ok: false, error: 'Key name required' };
  if (d <= 0 && m <= 0) return { ok: false, error: 'Valid duration required' };

  var sheet = getSheet_();
  if (findRow_(sheet, key)) return { ok: false, error: 'Key already exists' };

  sheet.appendRow([key, d || '', m || '', note || '', 'active', currentUser_(), new Date()]);
  return { ok: true, success: true };
}

function adminSetStatus_(rawKey, status) {
  var key = String(rawKey || '').trim();
  var sheet = getSheet_();
  var row = findRow_(sheet, key);
  if (!row) return { ok: false, error: 'Key not found' };
  sheet.getRange(row, COL.STATUS).setValue(status);
  return { ok: true, success: true };
}

function adminDelete_(rawKey) {
  var key = String(rawKey || '').trim();
  var sheet = getSheet_();
  var row = findRow_(sheet, key);
  if (!row) return { ok: false, error: 'Key not found' };
  sheet.deleteRow(row);
  return { ok: true, success: true };
}

function adminExtend_(rawKey, addDays) {
  var add = Number(addDays);
  if (!add || add <= 0) return { ok: false, error: 'Days to add required' };

  var key = String(rawKey || '').trim();
  var sheet = getSheet_();
  var row = findRow_(sheet, key);
  if (!row) return { ok: false, error: 'Key not found' };

  var d = getData_(row, sheet);
  var newDays = d.validDays + add;
  sheet.getRange(row, COL.DAYS).setValue(newDays);
  return { ok: true, success: true, newDays: newDays };
}

/* ------------------------------------------------------------------ */
/* Sheet helpers                                                       */
/* ------------------------------------------------------------------ */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    ensureHeaders_(sheet);
  }
  return sheet;
}

function ensureHeaders_(sheet) {
  var headers = ['key', 'validDays', 'validMinutes', 'userNote', 'status', 'createdBy', 'createdAt', 'activatedAt', 'expiresAt'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
}

function findRow_(sheet, key) {
  var norm = String(key || '').trim().toUpperCase();
  var last = sheet.getLastRow();
  if (last < 2) return null;
  var vals = sheet.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '').trim().toUpperCase() === norm) return i + 2;
  }
  return null;
}

function getData_(row, sheet) {
  var v = sheet.getRange(row, 1, 1, 9).getValues()[0];
  return {
    key: String(v[0] || ''),
    validDays: Number(v[1]) || 0,
    validMinutes: Number(v[2]) || 0,
    note: String(v[3] || ''),
    status: String(v[4] || 'active').toLowerCase(),
    createdBy: v[5],
    createdAt: v[6],
    activatedAt: v[7],
    expiresAt: v[8]
  };
}

function currentUser_() {
  try { return Session.getEffectiveUser().getEmail() || ''; } catch (e) { return ''; }
}

/* ------------------------------------------------------------------ */
/* Tokens (HMAC-signed)                                                */
/* ------------------------------------------------------------------ */

function getSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('SESSION_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('SESSION_SECRET', s);
  }
  return s;
}

function getAdminPassword_() {
  return PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD') || 'admin123';
}

function getTargetUrl_() {
  return PropertiesService.getScriptProperties().getProperty('TARGET_URL') || 'https://dulo.cx/';
}

function encodeRedirect_(url) {
  return Utilities.base64Encode(Utilities.newBlob(url).getBytes());
}

function hex_(bytes) {
  return bytes.map(function (b) { return ('0' + (b & 0xFF).toString(16)).slice(-2); }).join('');
}

function sign_(payload) {
  return hex_(Utilities.computeHmacSha256Signature(payload, getSecret_()));
}

function makeToken_(payloadObj) {
  var p = JSON.stringify(payloadObj);
  var b64 = Utilities.base64EncodeWebSafe(Utilities.newBlob(p).getBytes());
  return b64 + '.' + sign_(p);
}

function makeAdminToken_() {
  return makeToken_({ admin: true, iat: Date.now() });
}

function parseToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  try {
    var payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
    var expected = sign_(payload);
    if (parts[1] !== expected) return null;
    return JSON.parse(payload);
  } catch (e) {
    return null;
  }
}

function isAdmin_(body) {
  var d = body && body.token ? parseToken_(body.token) : null;
  return !!(d && d.admin);
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */

function durationMs_(d) {
  return (Number(d.validDays) || 0) * 86400000 + (Number(d.validMinutes) || 0) * 60000;
}

function durationLabel_(d) {
  var days = Number(d.validDays) || 0;
  var mins = Number(d.validMinutes) || 0;
  if (days > 0 && mins > 0) return days + 'd ' + mins + 'm';
  if (days > 0) return days + ' day' + (days !== 1 ? 's' : '');
  if (mins > 0) return mins + ' minute' + (mins !== 1 ? 's' : '');
  return 'unknown';
}

/**
 * One-time setup: sets the admin panel password.
 * Run this from the Apps Script editor (Run -> setAdminPassword).
 */
function setAdminPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Admin password', 'Enter the password for the admin panel:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK && res.getResponseText()) {
    PropertiesService.getScriptProperties().setProperty('ADMIN_PASSWORD', res.getResponseText().trim());
    ui.alert('Password saved.');
  } else {
    ui.alert('Cancelled. A default password (admin123) is active until you set one.');
  }
}

/**
 * One-time setup: sets the URL users are redirected to after a valid key.
 * Run this from the Apps Script editor (Run -> setTargetUrl).
 * The URL is NOT stored in the website files — it only ever comes from this
 * script (base64-encoded), so it is not visible in the site's source.
 */
function setTargetUrl() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Platform URL', 'Enter the URL users are sent to after a valid key:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() === ui.Button.OK && res.getResponseText()) {
    PropertiesService.getScriptProperties().setProperty('TARGET_URL', res.getResponseText().trim());
    ui.alert('Platform URL saved.');
  } else {
    ui.alert('Cancelled.');
  }
}
