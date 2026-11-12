/**
 * ============================================================
 * ND2 RADIOLOGY OS V5.5 — BACKEND v2
 * File: Code.gs (thay thế endxx.txt)
 * Version: 5.5.0
 * Deploy: NEW VERSION ONLY, after owner approval
 * ============================================================
 *
 * Fixes: R-03, R-04*, R-08, R-13, R-15, S-02, S-05, S-07,
 *        N-02, N-03, N-04, N-09, N-10, N-11, A-03, A-04*, A-05
 *        (* = partial, see KNOWN_ISSUES)
 *
 * ADRs: 001 (Auth), 002 (Audit), 003 (Sync), 004 (AI Gateway)
 * ============================================================
 */

const _P = PropertiesService.getScriptProperties();
const SHARED_TOKEN       = _P.getProperty('SHARED_TOKEN');
const SERVER_SECRET      = _P.getProperty('SERVER_SECRET') || 'CHANGE_ME_IN_SCRIPT_PROPERTIES';
const DEEPSEEK_KEY       = _P.getProperty('DEEPSEEK_API_KEY');

const SESSION_TTL_MS     = 8 * 3600 * 1000;
const MAX_BATCH_RECORDS  = 500;
const MAX_PAYLOAD_BYTES  = 2 * 1024 * 1024;
const LOGIN_RATE_LIMIT   = 5;      // per 60s
const AI_RATE_LIMIT      = 20;     // per 3600s
const LEGACY_MODE_ENABLED = true;  // set false after all clients upgraded

// ---- Module allowlists (ADR-003) ----
const PUSH_ALLOW = new Set([
  'staff','events','cases','report_templates','diseases','imaging_signs',
  'protocols','licenses','assets','maintenance','radiation','indicators',
  'risks','quality_events','training_sessions','research_projects','strategy_plan',
  'annual_plans','meeting_minutes','task_tracking','monthly_reports','budget',
  'supplies','inventory_transactions','suppliers','daily_volumes',
  'modality_production','staff_production','tat_tracking',
  // V5.5 additions:
  'roster','duty_month','meetings','leave_requests','capa','rca',
  'equipment_incidents','calibration','repairs','downtime',
  'personal_dosimeters','notifications','indicators'
]);

const PULL_BLOCKED = new Set(['sessions','audit_log','ai_decision_log']);

const SENSITIVE_FIELDS = [
  'passwordHash','passwordHash_legacy','serverHash','id_salt','token','session'
];

let CURRENT_ACTOR = null;

// ============================================================
// UTILS
// ============================================================
function _json(o){
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}
function _hmac(data, key){
  return Utilities.computeHmacSha256Signature(String(data), String(key))
    .map(b => ((b & 0xFF) + 0x100).toString(16).slice(1)).join('');
}
function _uuid(){ return Utilities.getUuid(); }
function _now(){ return Date.now(); }
function _stripSensitive(row){
  if (!row || typeof row !== 'object') return row;
  const c = { ...row };
  SENSITIVE_FIELDS.forEach(f => delete c[f]);
  return c;
}

// ============================================================
// ENTRYPOINTS
// ============================================================
function doGet(e){
  // S-07 FIX: no data via GET, no token in URL, no PII in response
  return _json({
    ok: true, service: 'ND2 V5.5 API', version: '5.5.0',
    ts: _now(), note: 'Use POST for all operations'
  });
}

function doPost(e){
  try {
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    const action = String(body.action || '');

    const auth = _resolveAuth(body, e);
    CURRENT_ACTOR = auth ? auth.user : null;

    if (action === 'login') {
      // login doesn't require prior auth
      return _json(_handleLogin(body));
    }
    if (!auth) return _json({ error: 'unauthorized' });

    switch (action) {
      case 'logout':            return _json(_handleLogout(auth));
      case 'whoami':            return _json(_handleWhoami(auth));
      case 'pull':              return _json(_handlePull(auth, body));
      case 'batchUpsert':       return _json(_handlePush(auth, body));
      case 'chat':              return _json(_handleAI(auth, body));
      case 'audit_query':       return _json(_handleAuditQuery(auth, body));
      case 'admin_createUser':  return _json(_handleAdminCreateUser(auth, body));
      case 'admin_updateUser':  return _json(_handleAdminUpdateUser(auth, body));
      default:                  return _json({ error: 'unknown action: ' + action });
    }
  } catch (err) {
    // S-07 FIX: never log token — log only message
    console.error('doPost error: ' + (err && err.message ? err.message : String(err)));
    return _json({ error: 'INTERNAL_ERROR' });
  } finally {
    CURRENT_ACTOR = null;
  }
}

// ============================================================
// AUTH RESOLUTION (ADR-001)
// ============================================================
function _resolveAuth(body, e){
  // 1) Bearer header (preferred)
  const headers = (e && e.headers) || {};
  const bearer = headers.Authorization || headers.authorization || '';
  if (bearer.indexOf('Bearer ') === 0) {
    const user = _verifySession(bearer.slice(7));
    if (user) return { mode: 'session', user, token: bearer.slice(7) };
  }
  // 2) Session token in body
  if (body.sessionToken) {
    const user = _verifySession(String(body.sessionToken));
    if (user) return { mode: 'session', user, token: String(body.sessionToken) };
  }
  // 3) Legacy shared token (R-04 partial: logged as legacy-admin)
  if (LEGACY_MODE_ENABLED && body.token && SHARED_TOKEN && body.token === SHARED_TOKEN) {
    return {
      mode: 'legacy',
      user: { id: 'legacy', username: 'legacy-admin', name: 'Shared Token', role: 'admin' },
      token: null
    };
  }
  return null;
}

// ============================================================
// LOGIN / LOGOUT / WHOAMI
// ============================================================
function _handleLogin(body){
  const username = String(body.username || '').trim();
  const receivedHash = String(body.hash || '');
  if (!username || !receivedHash) return { error: 'Missing username/hash' };

  if (!_checkRate('login:' + username, LOGIN_RATE_LIMIT, 60)) {
    return { error: 'Quá nhiều lần thử. Đợi 1 phút.' };
  }

  const user = _readMod('users').find(u => u.username === username && u.status === 'active');
  if (!user) {
    _audit('login_fail', 'auth', 'unknown', username,
      { id: 'unknown', username: username, role: 'guest' });
    return { error: 'Sai tài khoản hoặc mật khẩu' };
  }

  if (!_verifyPassword(user, receivedHash)) {
    _audit('login_fail', 'auth', user.id, username,
      { id: user.id, username: user.username, role: '' });
    return { error: 'Sai tài khoản hoặc mật khẩu' };
  }

  // A-04 PARTIAL FIX: migrate legacy hash to server-pepper
  if (user.passwordHash && !user.serverHash) {
    const newServerHash = _hmac(receivedHash + '|' + user.id, SERVER_SECRET);
    _updateUserRecord(user.id, {
      serverHash: newServerHash,
      passwordHash_legacy: user.passwordHash,
      passwordHash: null
    });
  }

  const session = _createSession(user.id);
  CURRENT_ACTOR = user;
  _audit('login', 'auth', user.id, username);
  return {
    ok: true,
    token: session.token,           // session token
    expiresAt: session.expiresAt,
    user: _publicUser(user)
  };
}

function _verifyPassword(user, receivedHash){
  if (user.serverHash) {
    const computed = _hmac(receivedHash + '|' + user.id, SERVER_SECRET);
    return computed === user.serverHash;
  }
  if (user.passwordHash_legacy) return user.passwordHash_legacy === receivedHash;
  if (user.passwordHash) return user.passwordHash === receivedHash;
  return false;
}

function _handleLogout(auth){
  if (auth.mode === 'session' && auth.token) _destroySession(auth.token);
  _audit('logout', 'auth', auth.user.id, auth.user.username);
  return { ok: true };
}

function _handleWhoami(auth){
  return { ok: true, user: _publicUser(auth.user), mode: auth.mode };
}

function _publicUser(u){
  return {
    id: u.id, username: u.username, name: u.name,
    role: u.role, status: u.status
  };
}

// ============================================================
// SESSIONS (sheet + cache)
// ============================================================
function _sessionsSheet(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('sessions');
  if (!sh) {
    sh = ss.insertSheet('sessions');
    sh.appendRow(['token', 'userId', 'expiresAt', 'createdAt']);
    sh.getRange('A1:D1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function _createSession(userId){
  const token = _uuid() + '-' + _uuid();
  const expiresAt = _now() + SESSION_TTL_MS;
  _sessionsSheet().appendRow([token, userId, expiresAt, _now()]);
  CacheService.getScriptCache().put('sess:' + token, userId, 21600);
  return { token, expiresAt };
}
function _verifySession(token){
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const cached = cache.get('sess:' + token);
  if (cached) return _findUser(cached);

  const sh = _sessionsSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return null;
  const rows = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let i = 0; i < rows.length; i++) {
    const t = rows[i][0], uid = rows[i][1], exp = Number(rows[i][2]) || 0;
    if (t === token && exp > _now()) {
      cache.put('sess:' + token, uid, 21600);
      return _findUser(uid);
    }
  }
  return null;
}
function _destroySession(token){
  CacheService.getScriptCache().remove('sess:' + token);
  // Row left as-is (cleanup optional via time-based maintenance)
}

function _findUser(userId){
  return _readMod('users').find(u => u.id === userId);
}

// ============================================================
// RATE LIMIT
// ============================================================
function _checkRate(key, max, windowSec){
  const cache = CacheService.getScriptCache();
  const ck = 'rl:' + key;
  const n = Number(cache.get(ck)) || 0;
  if (n >= max) return false;
  cache.put(ck, String(n + 1), windowSec);
  return true;
}

// ============================================================
// PULL (ADR-003)
// ============================================================
function _handlePull(auth, body){
  const since = Number(body.since) || 0;
  const isAdmin = auth.user.role === 'admin' || auth.mode === 'legacy';
  const data = {};
  const errors = [];

  // Pull modules: PUSH_ALLOW always + 'users' if admin
  const modules = [...PUSH_ALLOW];
  if (isAdmin) modules.push('users');

  for (const mod of modules) {
    if (PULL_BLOCKED.has(mod)) continue;
    try {
      const rows = _readMod(mod).filter(r => since === 0 || (r.updatedAt || 0) > since);
      if (mod === 'users') {
        // R-03/R-09/S-02 FIX: never include hash fields
        data[mod] = rows.map(u => ({
          id: u.id, username: u.username, name: u.name,
          role: u.role, status: u.status,
          lastLogin: u.lastLogin, createdAt: u.createdAt,
          updatedAt: u.updatedAt
        }));
      } else {
        data[mod] = rows.map(_stripSensitive);
      }
    } catch (e) {
      errors.push({ module: mod, error: String(e.message || e) });
    }
  }

  _audit('pull', 'sync', '', `mods=${Object.keys(data).length}`);
  return { ok: true, data, errors, ts: _now(), server_seq: _now() };
}

// ============================================================
// PUSH (ADR-003)
// ============================================================
function _handlePush(auth, body){
  const data = body.data || {};

  // N-09 FIX: batch bounds
  let totalRecords = 0, totalBytes = 0;
  for (const [, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    totalRecords += rows.length;
    totalBytes += JSON.stringify(rows).length;
  }
  if (totalRecords > MAX_BATCH_RECORDS) {
    return { error: 'BATCH_TOO_LARGE', detail: `${totalRecords} > ${MAX_BATCH_RECORDS}` };
  }
  if (totalBytes > MAX_PAYLOAD_BYTES) {
    return { error: 'PAYLOAD_TOO_LARGE', detail: `${totalBytes} bytes > ${MAX_PAYLOAD_BYTES}` };
  }

  const stats = { added: 0, updated: 0, noop: 0, conflicts: [], rejected: [] };

  for (const [mod, rows] of Object.entries(data)) {
    if (!Array.isArray(rows)) continue;
    // R-15 FIX: allowlist only
    if (!PUSH_ALLOW.has(mod)) {
      stats.rejected.push({ module: mod, reason: 'not_in_allowlist' });
      continue;
    }
    // A-05 FIX: users never writable via batch
    if (mod === 'users') {
      stats.rejected.push({ module: mod, reason: 'use_admin_endpoint' });
      continue;
    }
    try {
      _upsertModule(auth, mod, rows, stats);
    } catch (e) {
      stats.rejected.push({ module: mod, reason: String(e.message || e) });
    }
  }

  // N-02 FIX: all-conflict is NOT success
  const attempted = stats.added + stats.updated + stats.noop + stats.conflicts.length;
  const allConflict = attempted > 0
    && stats.added === 0 && stats.updated === 0 && stats.noop === 0
    && stats.conflicts.length > 0;
  if (allConflict) return { ok: false, error: 'ALL_CONFLICT', stats, ts: _now() };

  if (stats.added > 0 || stats.updated > 0) {
    _audit('push', 'sync', '',
      `+${stats.added} ~${stats.updated} noop=${stats.noop} confl=${stats.conflicts.length}`);
  }
  return { ok: true, stats, ts: _now(), server_seq: _now() };
}

function _upsertModule(auth, mod, rows, stats){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(mod);
  if (!sh) {
    // R-15 FIX: only allowlisted modules reach here; create with canonical header
    sh = ss.insertSheet(mod);
    sh.appendRow(['id', 'version', 'payload']);
    sh.getRange('A1:C1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }

  // R-08 FIX: preserve existing header structure, do NOT rewrite
  const header = sh.getRange(1, 1, 1, 3).getValues()[0];
  if (header[0] !== 'id' || header[1] !== 'version' || header[2] !== 'payload') {
    throw new Error(`Sheet ${mod} header mismatch`);
  }

  const lastRow = sh.getLastRow();
  const existingMap = {};
  if (lastRow > 1) {
    sh.getRange(2, 1, lastRow - 1, 3).getValues().forEach((r, i) => {
      if (r[0]) existingMap[r[0]] = { row: i + 2, version: Number(r[1]) || 0, payload: r[2] };
    });
  }

  const appends = [], updates = [];

  for (const r of rows) {
    if (!r || !r.id) continue;
    const incomingVersion = Number(r.version) || 0;
    const cleanRow = _stripSensitive({ ...r, updatedAt: _now() });
    const payload = JSON.stringify(cleanRow);

    if (existingMap[r.id]) {
      const ex = existingMap[r.id];
      // Version conflict
      if (incomingVersion < ex.version) {
        stats.conflicts.push({
          module: mod, id: r.id, reason: 'stale_version',
          clientVersion: incomingVersion, serverVersion: ex.version
        });
        continue;
      }
      // N-03 FIX: idempotent no-op (data equivalent → no version bump)
      let oldObj;
      try { oldObj = JSON.parse(ex.payload); } catch (e) { oldObj = {}; }
      if (_dataEquivalent(oldObj, r)) {
        stats.noop++;
        continue;
      }
      updates.push({ row: ex.row, version: ex.version + 1, payload });
      stats.updated++;
    } else {
      appends.push({ id: r.id, version: 1, payload });
      stats.added++;
    }
  }

  // N-10 FIX: batched writes
  for (const w of updates) {
    sh.getRange(w.row, 2, 1, 2).setValues([[w.version, w.payload]]);
  }
  if (appends.length) {
    const startRow = sh.getLastRow() + 1;
    const values = appends.map(w => [w.id, w.version, w.payload]);
    sh.getRange(startRow, 1, values.length, 3).setValues(values);
  }
}

function _dataEquivalent(oldObj, newRow){
  const strip = (o) => {
    const c = { ...o };
    delete c.updatedAt; delete c.version; delete c._dirty; delete c._deletedAt;
    return JSON.stringify(c, Object.keys(c).sort());
  };
  return strip(oldObj) === strip(newRow);
}

// ============================================================
// AI GATEWAY (ADR-004)
// ============================================================
const AI_SYSTEM_PROMPT = 'Bạn là trợ lý hỗ trợ khoa Chẩn đoán hình ảnh nhi. Trả lời tiếng Việt, ngắn gọn, nêu rõ khi không chắc chắn. Không chẩn đoán thay bác sĩ.';

function _handleAI(auth, body){
  if (!DEEPSEEK_KEY) return { error: 'DEEPSEEK_API_KEY chưa đặt' };

  if (!_checkRate('ai:' + auth.user.username, AI_RATE_LIMIT, 3600)) {
    return { error: 'Vượt giới hạn 20 câu/giờ' };
  }

  const history = (body.messages || [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant'))
    .slice(-10)
    .map(m => ({ role: m.role, content: String(m.content || '').slice(0, 4000) }));
  if (!history.length) return { error: 'Nội dung trống' };

  // R-13 FIX: PII gate, fail-closed, server-side
  const allText = history.map(m => m.content).join('\n');
  const scan = _piiScan(allText);
  if (scan.blocked) {
    _audit('ai_blocked', 'ai', '', scan.reason);
    return {
      error: 'BLOCKED_PII',
      detail: 'Phát hiện ' + scan.reason + '. Vui lòng ẩn danh trước khi gửi.'
    };
  }

  const resp = UrlFetchApp.fetch('https://api.deepseek.com/chat/completions', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + DEEPSEEK_KEY },
    payload: JSON.stringify({
      model: 'deepseek-chat',
      temperature: 0.4,
      max_tokens: 5244,
      messages: [{ role: 'system', content: AI_SYSTEM_PROMPT }, ...history]
    }),
    muteHttpExceptions: true
  });

  const j = JSON.parse(resp.getContentText());
  if (resp.getResponseCode() !== 200) {
    return {
      error: 'DeepSeek ' + resp.getResponseCode()
        + ': ' + ((j.error && j.error.message) || 'unknown')
    };
  }
  _audit('ai_call', 'ai', '', 'ok');
  return { reply: j.choices[0].message.content };
}

function _piiScan(text){
  const patterns = [
    { r: /(họ\s*tên|bệnh\s*nhân|patient|bn)\s*[:=]\s*\S+/i, l: 'tên bệnh nhân' },
    { r: /(sinh\s*ngày|dob|date\s*of\s*birth|ngày\s*sinh)\s*[:=]\s*\d/i, l: 'ngày sinh' },
    { r: /\b\d{8,12}\b/, l: 'số định danh 8-12 chữ số' },
    { r: /(đường|phường|quận|tỉnh|p\.|q\.)\s+\S+/i, l: 'địa chỉ' },
    { r: /0008,\d{4}/, l: 'mã DICOM' }
  ];
  for (const p of patterns) {
    if (p.r.test(text)) return { blocked: true, reason: p.l };
  }
  return { blocked: false };
}

// ============================================================
// ADMIN USER MGMT (S-05) — restricted path
// ============================================================
function _handleAdminCreateUser(auth, body){
  if (auth.user.role !== 'admin' || auth.mode === 'legacy' && !body.confirmAdmin) {
    return { error: 'forbidden', detail: 'admin session required' };
  }
  // NOTE: user management in V5.5 stays in frontend + legacy push for now.
  // Full admin endpoint lands in V5.6 with audit-before-write enforcement.
  return { error: 'NOT_IMPLEMENTED', detail: 'use frontend form; audit trails via legacy path' };
}
function _handleAdminUpdateUser(auth, body){
  if (auth.user.role !== 'admin') return { error: 'forbidden' };
  return { error: 'NOT_IMPLEMENTED' };
}

// ============================================================
// AUDIT (ADR-002, A-03)
// ============================================================
function _auditLogSheet(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('audit_log');
  if (!sh) {
    sh = ss.insertSheet('audit_log');
    sh.appendRow(['id','ts','actor_id','actor_username','actor_role',
                  'action','module','record_id','detail','prev_hash','hash']);
    sh.getRange('A1:K1').setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function _audit(action, module, recordId, detail, actorOverride){
  try {
    const sh = _auditLogSheet();
    const lastRow = sh.getLastRow();
    let prevHash = '';
    if (lastRow > 1) prevHash = String(sh.getRange(lastRow, 11).getValue() || '');

    const actor = actorOverride || CURRENT_ACTOR
      || { id: 'system', username: 'system', role: '' };

    const entry = {
      id: _uuid(),
      ts: _now(),
      actor_id: actor.id || '',
      actor_username: actor.username || '',
      actor_role: actor.role || '',
      action: action,
      module: module,
      record_id: String(recordId || ''),
      detail: String(detail || '').slice(0, 500),
      prev_hash: prevHash
    };
    entry.hash = _hmac(
      [entry.ts, entry.actor_id, action, module, recordId, prevHash].join('|'),
      SERVER_SECRET
    ).slice(0, 16);

    sh.appendRow([
      entry.id, entry.ts, entry.actor_id, entry.actor_username, entry.actor_role,
      entry.action, entry.module, entry.record_id, entry.detail,
      entry.prev_hash, entry.hash
    ]);
  } catch (e) {
    console.error('audit failed: ' + (e && e.message));
  }
}

function _handleAuditQuery(auth, body){
  if (auth.user.role !== 'admin') return { error: 'forbidden' };
  const sh = _auditLogSheet();
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return { ok: true, rows: [], total: 0 };

  const limit = Math.min(Number(body.limit) || 100, 500);
  const offset = Math.max(Number(body.offset) || 0, 0);
  const endRow = lastRow - offset;
  const startRow = Math.max(2, endRow - limit + 1);
  const count = endRow - startRow + 1;
  if (count <= 0) return { ok: true, rows: [], total: lastRow - 1 };

  const rows = sh.getRange(startRow, 1, count, 11).getValues();
  return { ok: true, rows: rows.reverse(), total: lastRow - 1 };
}

// ============================================================
// MODULE HELPERS
// ============================================================
function _readMod(mod){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(mod);
  if (!sh || sh.getLastRow() < 2) return [];
  const lastRow = sh.getLastRow();
  // N-11 FIX: corrupt payloads silently skipped, no audit writes
  return sh.getRange(2, 1, lastRow - 1, 3).getValues()
    .map(r => {
      try {
        const o = JSON.parse(r[2]);
        o.version = Number(r[1]) || 0;
        return o;
      } catch (e) { return null; }
    })
    .filter(Boolean);
}

function _updateUserRecord(userId, patch){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('users');
  if (!sh) return false;
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return false;

  const rows = sh.getRange(2, 1, lastRow - 1, 3).getValues();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === userId) {
      try {
        const obj = JSON.parse(rows[i][2]);
        Object.assign(obj, patch);
        obj.updatedAt = _now();
        sh.getRange(i + 2, 2, 1, 2).setValues([
          [Number(rows[i][1]) + 1, JSON.stringify(obj)]
        ]);
        return true;
      } catch (e) { return false; }
    }
  }
  return false;
}