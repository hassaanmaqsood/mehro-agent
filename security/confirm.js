import crypto from 'crypto';

const CONFIRMATION_SECRET = process.env.CONFIRMATION_SECRET || 'mehro-confirmation-secret-key-32b!';
const TOKEN_TTL_MS = 5 * 60 * 1000; // 5 minutes

export function signConfirmationToken(action = 'shell', details = {}, secret = CONFIRMATION_SECRET) {
  const payload = {
    action,
    details,
    ts: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex')
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');
  return `${payloadB64}.${signature}`;
}

export function verifyConfirmationToken(token, expectedAction = null, secret = CONFIRMATION_SECRET) {
  if (!token || typeof token !== 'string') {
    return { valid: false, error: 'confirmation_required' };
  }

  const parts = token.split('.');
  if (parts.length !== 2) {
    return { valid: false, error: 'malformed_confirmation_token' };
  }

  const [payloadB64, signature] = parts;
  const expectedSig = crypto.createHmac('sha256', secret).update(payloadB64).digest('base64url');

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expectedSig);

  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, error: 'invalid_confirmation_signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { valid: false, error: 'malformed_token_payload' };
  }

  // Check TTL
  if (Date.now() - payload.ts > TOKEN_TTL_MS) {
    return { valid: false, error: 'confirmation_token_expired' };
  }

  // Check action match if requested
  if (expectedAction && payload.action !== expectedAction) {
    return { valid: false, error: 'confirmation_action_mismatch' };
  }

  return { valid: true, error: null, payload };
}

export default {
  signConfirmationToken,
  verifyConfirmationToken
};
