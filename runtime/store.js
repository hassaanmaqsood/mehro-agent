import Database from 'better-sqlite3';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import logger from '../src/logger.js';

let dbInstance = null;
let masterSecretKey = null;

function getMasterKey(masterSecret) {
  if (masterSecretKey) return masterSecretKey;
  const secret = masterSecret || process.env.NODAIC_MASTER_SECRET || 'mehro-default-development-master-secret-32b-key!';
  masterSecretKey = crypto.createHash('sha256').update(secret).digest();
  return masterSecretKey;
}

export function encryptSecret(plaintext, masterSecret) {
  const key = getMasterKey(masterSecret);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    iv: iv.toString('hex'),
    tag: tag.toString('hex'),
    data: encrypted
  });
}

export function decryptSecret(encryptedPayload, masterSecret) {
  try {
    const key = getMasterKey(masterSecret);
    const parsed = typeof encryptedPayload === 'string' ? JSON.parse(encryptedPayload) : encryptedPayload;
    const iv = Buffer.from(parsed.iv, 'hex');
    const tag = Buffer.from(parsed.tag, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    let decrypted = decipher.update(parsed.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    logger.error(`Failed to decrypt secret: ${err.message}`);
    return null;
  }
}

export function initStore(dbPath = ':memory:', options = {}) {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new Database(dbPath, {
    verbose: options.verbose ? (msg) => logger.debug(`[SQL] ${msg}`) : undefined
  });

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 1. artifacts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT NOT NULL,
      version TEXT NOT NULL DEFAULT '1.0.0',
      dispatch_key TEXT UNIQUE,
      artifact_type TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source TEXT NOT NULL,
      metadata TEXT,
      interface TEXT,
      is_static INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (id, version)
    );
  `);

  // 2. bindings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS bindings (
      event TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      dispatch_key TEXT,
      once INTEGER DEFAULT 0,
      public_token TEXT UNIQUE,
      roles_json TEXT,
      delivery TEXT DEFAULT 'direct',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (event, artifact_id)
    );
  `);

  // 3. principals table
  db.exec(`
    CREATE TABLE IF NOT EXISTS principals (
      principal_id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'device',
      scope_json TEXT,
      hash TEXT,
      encrypted_val TEXT,
      hint TEXT,
      revoked INTEGER DEFAULT 0,
      meta_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // 4. permissions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS permissions (
      grantee_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      action TEXT NOT NULL DEFAULT '*',
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (grantee_id, artifact_id, action)
    );
  `);

  // 5. variables table
  db.exec(`
    CREATE TABLE IF NOT EXISTS variables (
      namespace TEXT NOT NULL DEFAULT 'default',
      key TEXT NOT NULL,
      value TEXT,
      type TEXT DEFAULT 'variable',
      encrypted INTEGER DEFAULT 0,
      roles_json TEXT,
      owner_id TEXT DEFAULT 'local',
      meta_json TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (namespace, key)
    );
  `);

  // 6. audit_log table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      timestamp TEXT DEFAULT (datetime('now')),
      run_id TEXT,
      tool_id TEXT NOT NULL,
      input_hash TEXT,
      output_hash TEXT,
      input_json TEXT,
      output_json TEXT,
      status TEXT DEFAULT 'success',
      error TEXT,
      metadata TEXT
    );
  `);

  // 7. workflow_runs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      run_id TEXT PRIMARY KEY,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      inputs TEXT,
      outputs TEXT,
      error TEXT,
      started_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      duration_ms INTEGER
    );
  `);

  dbInstance = db;
  return db;
}

export function getDb(dbPath = null) {
  if (dbPath && (!dbInstance || dbInstance.name !== path.resolve(dbPath))) {
    if (dbInstance) dbInstance.close();
    dbInstance = initStore(dbPath);
    return dbInstance;
  }
  if (!dbInstance) {
    const finalPath = dbPath || process.env.MEHRO_DB_PATH || ':memory:';
    dbInstance = initStore(finalPath);
  }
  return dbInstance;
}

export function closeStore() {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}

// Variables repository
export const variablesRepo = {
  set(namespace, key, value, type = 'variable', isEncrypted = false, roles = null, meta = null) {
    const db = getDb();
    let valStr = typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value ?? '');
    let encFlag = isEncrypted ? 1 : 0;

    if (type === 'secret' && isEncrypted) {
      valStr = encryptSecret(valStr);
    }

    const stmt = db.prepare(`
      INSERT INTO variables (namespace, key, value, type, encrypted, roles_json, meta_json, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(namespace, key) DO UPDATE SET
        value = excluded.value,
        type = excluded.type,
        encrypted = excluded.encrypted,
        roles_json = excluded.roles_json,
        meta_json = excluded.meta_json,
        updated_at = datetime('now')
    `);

    stmt.run(namespace, key, valStr, type, encFlag, roles ? JSON.stringify(roles) : null, meta ? JSON.stringify(meta) : null);
    return { namespace, key, type };
  },

  get(namespace, key) {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM variables WHERE namespace = ? AND key = ?`).get(namespace, key);
    if (!row) return null;

    let value = row.value;
    if (row.encrypted === 1 && row.type === 'secret') {
      value = decryptSecret(value);
    }

    try {
      value = JSON.parse(value);
    } catch {
      // return as string if not JSON
    }

    return {
      ...row,
      value
    };
  },

  delete(namespace, key) {
    const db = getDb();
    const res = db.prepare(`DELETE FROM variables WHERE namespace = ? AND key = ?`).run(namespace, key);
    return res.changes > 0;
  },

  list(namespace = null) {
    const db = getDb();
    let rows;
    if (namespace) {
      rows = db.prepare(`SELECT namespace, key, type, encrypted, roles_json, meta_json, updated_at FROM variables WHERE namespace = ?`).all(namespace);
    } else {
      rows = db.prepare(`SELECT namespace, key, type, encrypted, roles_json, meta_json, updated_at FROM variables`).all();
    }
    return rows;
  }
};

// Audit Log repository
export const auditRepo = {
  log({ runId = null, toolId, input, output, status = 'success', error = null, metadata = null }) {
    const db = getDb();
    const id = crypto.randomUUID();
    const inputStr = input !== undefined ? JSON.stringify(input) : null;
    const outputStr = output !== undefined ? JSON.stringify(output) : null;
    const inputHash = inputStr ? crypto.createHash('sha256').update(inputStr).digest('hex') : null;
    const outputHash = outputStr ? crypto.createHash('sha256').update(outputStr).digest('hex') : null;

    const stmt = db.prepare(`
      INSERT INTO audit_log (id, run_id, tool_id, input_hash, output_hash, input_json, output_json, status, error, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      runId,
      toolId,
      inputHash,
      outputHash,
      inputStr,
      outputStr,
      status,
      error,
      metadata ? JSON.stringify(metadata) : null
    );

    return { id, inputHash, outputHash, timestamp: new Date().toISOString() };
  },

  query({ toolId, runId, limit = 50, offset = 0 } = {}) {
    const db = getDb();
    let query = `SELECT * FROM audit_log`;
    const conditions = [];
    const params = [];

    if (toolId) {
      conditions.push(`tool_id = ?`);
      params.push(toolId);
    }
    if (runId) {
      conditions.push(`run_id = ?`);
      params.push(runId);
    }
    if (conditions.length > 0) {
      query += ` WHERE ` + conditions.join(' AND ');
    }
    query += ` ORDER BY timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    return db.prepare(query).all(...params);
  }
};

// Workflow Runs repository
export const workflowRunsRepo = {
  create(workflowName, inputs = {}) {
    const db = getDb();
    const runId = crypto.randomUUID();
    const stmt = db.prepare(`
      INSERT INTO workflow_runs (run_id, workflow_name, status, inputs, started_at)
      VALUES (?, ?, 'running', ?, datetime('now'))
    `);
    stmt.run(runId, workflowName, JSON.stringify(inputs));
    return runId;
  },

  complete(runId, outputs = {}, durationMs = null) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE workflow_runs
      SET status = 'completed', outputs = ?, completed_at = datetime('now'), duration_ms = ?
      WHERE run_id = ?
    `);
    stmt.run(JSON.stringify(outputs), durationMs, runId);
  },

  fail(runId, error = '', durationMs = null) {
    const db = getDb();
    const stmt = db.prepare(`
      UPDATE workflow_runs
      SET status = 'failed', error = ?, completed_at = datetime('now'), duration_ms = ?
      WHERE run_id = ?
    `);
    stmt.run(String(error), durationMs, runId);
  },

  get(runId) {
    const db = getDb();
    return db.prepare(`SELECT * FROM workflow_runs WHERE run_id = ?`).get(runId);
  },

  list(limit = 50) {
    const db = getDb();
    return db.prepare(`SELECT * FROM workflow_runs ORDER BY started_at DESC LIMIT ?`).all(limit);
  }
};
