import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const KEY_FILE = path.join(DATA_DIR, '.vault.key');

let cachedMasterKey = null;

/**
 * Resolves a 32-byte encryption key from ENCRYPTION_SECRET env var,
 * or generates & persists a local random key in data/.vault.key (gitignored).
 */
function getMasterKey() {
  if (cachedMasterKey) return cachedMasterKey;

  const envSecret = process.env.ENCRYPTION_SECRET?.trim();
  if (envSecret && envSecret !== 'change-me-to-a-long-random-secret') {
    cachedMasterKey = crypto.scryptSync(envSecret, 'pageturner-smpl-vault-v1', 32);
    return cachedMasterKey;
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (fs.existsSync(KEY_FILE)) {
    const raw = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (raw.length >= 64) {
      cachedMasterKey = Buffer.from(raw, 'hex').subarray(0, 32);
      return cachedMasterKey;
    }
  }

  const generated = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, generated.toString('hex'), { mode: 0o600 });
  cachedMasterKey = generated;
  return cachedMasterKey;
}

/**
 * Encrypts a UTF-8 string using AES-256-GCM.
 */
export function encryptSecret(plaintext) {
  if (!plaintext) return '';
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

/**
 * Decrypts a value produced by encryptSecret().
 */
export function decryptSecret(payload) {
  if (!payload) return '';
  if (!String(payload).startsWith('v1:')) return String(payload);
  const parts = String(payload).split(':');
  if (parts.length !== 4) return '';
  try {
    const [, ivB64, tagB64, dataB64] = parts;
    const key = getMasterKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataB64, 'base64')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

/**
 * Masks a library card number for safe display (e.g. "2904••••••1842").
 */
export function maskCardNumber(cardNumber) {
  const clean = String(cardNumber || '').replace(/\s+/g, '');
  if (clean.length <= 4) return clean ? '••••' : '';
  if (clean.length <= 8) return `••••${clean.slice(-4)}`;
  return `${clean.slice(0, 4)}••••••${clean.slice(-4)}`;
}

/**
 * Signs a lightweight session token for the optional Family Passcode Gate.
 */
export function createSessionToken() {
  const issuedAt = Date.now().toString();
  const sig = crypto.createHmac('sha256', getMasterKey()).update(`session:${issuedAt}`).digest('hex');
  return `${issuedAt}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return false;
  const [issuedAt, sig] = token.split('.');
  if (!issuedAt || !sig) return false;
  const ageMs = Date.now() - Number(issuedAt);
  // Sessions stay signed in for 30 days on family phones
  if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs > 30 * 24 * 60 * 60 * 1000) return false;
  const expected = crypto.createHmac('sha256', getMasterKey()).update(`session:${issuedAt}`).digest('hex');
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export function safeEqualPasscode(input, configured) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(configured || '')).digest();
  return crypto.timingSafeEqual(a, b);
}
