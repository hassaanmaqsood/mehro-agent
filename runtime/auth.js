import crypto from 'crypto';
import logger from '../src/logger.js';
import { getDb } from './store.js';

export const CONTEXTS = {
  api: 'auth:api',
  session: 'auth:session',
  otp: 'auth:otp'
};

const ROLE_ENC = { admin: 0x00, device: 0x01 };
const ROLE_DEC = { 0x00: 'admin', 0x01: 'device' };
const CTX_ENC = { 'auth:api': 0x00, 'auth:session': 0x01, 'auth:otp': 0x02 };
const CTX_DEC = { 0x00: 'auth:api', 0x01: 'auth:session', 0x02: 'auth:otp' };
const HEX256_REGEX = /^[0-9A-Fa-f]{256}$/;

// In-memory rate limiter: Map<keyId, number[]> (timestamps in ms)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 60;

export function checkRateLimit(keyId, limit = RATE_LIMIT_MAX_REQUESTS, windowMs = RATE_LIMIT_WINDOW_MS) {
  const now = Date.now();
  const id = keyId || 'anonymous';
  let timestamps = rateLimitMap.get(id);

  if (!timestamps) {
    timestamps = [];
    rateLimitMap.set(id, timestamps);
  }

  // Filter out older timestamps outside window
  const windowStart = now - windowMs;
  while (timestamps.length > 0 && timestamps[0] <= windowStart) {
    timestamps.shift();
  }

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return {
      allowed: false,
      retryAfter: retryAfter > 0 ? retryAfter : 1
    };
  }

  timestamps.push(now);
  return { allowed: true, remaining: limit - timestamps.length };
}

export function resetRateLimits() {
  rateLimitMap.clear();
}

function hmacSha256(secret, data) {
  return crypto.createHmac('sha256', Buffer.from(secret, 'utf8')).update(data).digest();
}

export function generateToken({
  role = 'device',
  keyId = 'dev_key',
  epoch = 1,
  expiresInSeconds = 90 * 86400,
  context = CONTEXTS.api,
  secret = process.env.NODAIC_MASTER_SECRET || 'mehro-default-development-master-secret-32b-key!',
  nonce = null
}) {
  const buf = Buffer.alloc(128);

  buf[0] = ROLE_ENC[role] ?? 0x01;
  buf[1] = 0x01; // version
  buf[2] = CTX_ENC[context] ?? 0x00;
  buf[3] = 0x00; // reserved

  buf.writeUInt32BE(epoch >>> 0, 4);
  const expiresAt = Math.floor(Date.now() / 1000) + expiresInSeconds;
  buf.writeUInt32BE(expiresAt >>> 0, 8);

  const kidBuf = Buffer.from(String(keyId), 'utf8').subarray(0, 20);
  kidBuf.copy(buf, 12);

  const randomNonce = nonce || crypto.randomBytes(64);
  randomNonce.copy(buf, 32);

  const mac = hmacSha256(secret, buf.subarray(0, 96));
  mac.copy(buf, 96);

  return buf.toString('hex').toUpperCase();
}

export function validateToken(
  token,
  secret = process.env.NODAIC_MASTER_SECRET || 'mehro-default-development-master-secret-32b-key!',
  context = CONTEXTS.api,
  epoch = 1
) {
  if (typeof token !== 'string' || token.length !== 256) {
    return { valid: false, error: 'Invalid token length' };
  }
  if (!HEX256_REGEX.test(token)) {
    return { valid: false, error: 'Invalid token characters' };
  }

  const buf = Buffer.from(token, 'hex');
  const expectedMac = hmacSha256(secret, buf.subarray(0, 96));
  const actualMac = buf.subarray(96, 128);

  if (!crypto.timingSafeEqual(expectedMac, actualMac)) {
    return { valid: false, error: 'Invalid signature' };
  }

  const role = ROLE_DEC[buf[0]];
  if (!role) {
    return { valid: false, error: 'Unknown role code' };
  }

  const expectedCtx = CTX_ENC[context];
  if (expectedCtx !== undefined && buf[2] !== expectedCtx) {
    return { valid: false, error: 'Context mismatch' };
  }

  const tokenEpoch = buf.readUInt32BE(4);
  if (tokenEpoch < epoch) {
    return { valid: false, error: 'Token epoch revoked' };
  }

  const expiry = buf.readUInt32BE(8);
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (nowSeconds > expiry) {
    return { valid: false, error: 'Token expired' };
  }

  let keyId = buf.subarray(12, 32).toString('utf8').replace(/\0+$/, '');

  return {
    valid: true,
    role,
    keyId,
    epoch: tokenEpoch,
    expiresAt: expiry
  };
}

export function hashApiKey(key) {
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  return `sha256:${hash}`;
}

export function verifyApiKey(rawKey, configApiKeys = []) {
  if (!rawKey) return null;
  const computedHash = hashApiKey(rawKey);

  // 1. Check configured apiKeys in config.yaml
  for (const entry of configApiKeys) {
    if (entry.hash === computedHash) {
      return {
        keyId: entry.name || 'api_key',
        name: entry.name,
        role: entry.scopes?.includes('admin') ? 'admin' : 'developer',
        scopes: entry.scopes || ['run', 'read'],
        isAdmin: (entry.scopes || []).includes('admin')
      };
    }
  }

  // 2. Check DB principals
  try {
    const db = getDb();
    const row = db.prepare(`SELECT * FROM principals WHERE (hash = ? OR hash = ?) AND revoked = 0`).get(computedHash, rawKey);
    if (row) {
      const scopes = row.scope_json ? JSON.parse(row.scope_json) : [];
      return {
        keyId: row.principal_id,
        name: row.name,
        role: row.role,
        scopes,
        isAdmin: row.role === 'admin' || scopes.includes('*')
      };
    }
  } catch (err) {
    logger.debug(`API key db lookup skipped: ${err.message}`);
  }

  return null;
}

export function hasScope(grantedScopes = [], requiredScope = 'read') {
  if (!requiredScope) return true;
  if (!Array.isArray(grantedScopes)) grantedScopes = [grantedScopes];

  const normRequired = requiredScope.replace(/:/g, '.');

  for (const s of grantedScopes) {
    const norm = String(s).replace(/:/g, '.');
    if (norm === '*' || norm === normRequired) return true;
    if (norm.endsWith('.*')) {
      const prefix = norm.slice(0, -2);
      if (normRequired === prefix || normRequired.startsWith(`${prefix}.`)) return true;
    }
    // Also match general aliases
    if (norm === 'admin') return true;
    if (norm === 'run' && normRequired.startsWith('run')) return true;
    if (norm === 'read' && (normRequired.startsWith('read') || normRequired.endsWith('.read') || normRequired.endsWith('.list') || normRequired.endsWith('.get'))) return true;
    if (norm === 'library.read' && (normRequired === 'library.list' || normRequired === 'library.get')) return true;
    if (norm === 'library.write' && (normRequired === 'library.push' || normRequired === 'library.remove')) return true;
    if (norm === 'mcp' && normRequired.startsWith('mcp')) return true;
  }

  return false;
}

export function resolveAuth(tokenOrReq, config = {}) {
  let token = null;

  if (typeof tokenOrReq === 'string') {
    token = tokenOrReq;
  } else if (tokenOrReq && typeof tokenOrReq === 'object') {
    // Extract from headers / query / body
    const authHeader = tokenOrReq.headers?.['authorization'] || tokenOrReq.headers?.['Authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.slice(7).trim();
    } else if (tokenOrReq.query?.token) {
      token = tokenOrReq.query.token;
    } else if (tokenOrReq.query?.auth_token) {
      token = tokenOrReq.query.auth_token;
    } else if (tokenOrReq.body?.token) {
      token = tokenOrReq.body.token;
    }
  }

  if (!token) {
    return {
      valid: false,
      code: 'auth_required',
      reason: 'Missing bearer token or API key',
      status: 401
    };
  }

  // 1. Try 256-hex HMAC token
  if (token.length === 256 && HEX256_REGEX.test(token)) {
    const secret = process.env.NODAIC_MASTER_SECRET || 'mehro-default-development-master-secret-32b-key!';
    const val = validateToken(token, secret);
    if (!val.valid) {
      return {
        valid: false,
        code: 'unauthorized',
        reason: val.error || 'Invalid HMAC token',
        status: 401
      };
    }

    // Check rate limit
    const rl = checkRateLimit(val.keyId);
    if (!rl.allowed) {
      return {
        valid: false,
        code: 'rate_limit_exceeded',
        reason: `Rate limit exceeded. Retry after ${rl.retryAfter}s`,
        status: 429,
        retryAfter: rl.retryAfter
      };
    }

    // Check principals table for enrichments or revocation
    try {
      const db = getDb();
      const p = db.prepare(`SELECT * FROM principals WHERE principal_id = ?`).get(val.keyId);
      if (p) {
        if (p.revoked === 1) {
          return {
            valid: false,
            code: 'unauthorized',
            reason: 'Token has been revoked',
            status: 401
          };
        }
        const scopes = p.scope_json ? JSON.parse(p.scope_json) : [];
        return {
          valid: true,
          keyId: val.keyId,
          role: p.role || val.role,
          scopes: scopes.length ? scopes : (val.role === 'admin' ? ['*'] : ['run', 'read']),
          isAdmin: (p.role || val.role) === 'admin' || scopes.includes('*')
        };
      }
    } catch {
      // ignore db errors on token enrichment
    }

    return {
      valid: true,
      keyId: val.keyId,
      role: val.role,
      scopes: val.role === 'admin' ? ['*'] : ['run', 'read'],
      isAdmin: val.role === 'admin'
    };
  }

  // 2. Try API key check
  const apiKeyMatch = verifyApiKey(token, config.security?.apiKeys || []);
  if (apiKeyMatch) {
    const rl = checkRateLimit(apiKeyMatch.keyId);
    if (!rl.allowed) {
      return {
        valid: false,
        code: 'rate_limit_exceeded',
        reason: `Rate limit exceeded. Retry after ${rl.retryAfter}s`,
        status: 429,
        retryAfter: rl.retryAfter
      };
    }

    return {
      valid: true,
      keyId: apiKeyMatch.keyId,
      role: apiKeyMatch.role,
      scopes: apiKeyMatch.scopes,
      isAdmin: apiKeyMatch.isAdmin
    };
  }

  return {
    valid: false,
    code: 'unauthorized',
    reason: 'Invalid authentication token or API key',
    status: 401
  };
}
