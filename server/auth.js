import { createSessionToken, safeEqualPasscode, verifySessionToken } from './crypto.js';

const COOKIE_NAME = 'pageturner_family_session';

export function isPasscodeEnabled() {
  return Boolean(process.env.APP_PASSCODE && process.env.APP_PASSCODE.trim().length > 0);
}

export function isAuthenticated(req) {
  if (!isPasscodeEnabled()) return true;
  const token = req.cookies?.[COOKIE_NAME];
  return verifySessionToken(token);
}

export function requireFamilyAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({
    error: 'Family passcode required',
    locked: true,
  });
}

export function handlePasscodeLogin(req, res) {
  if (!isPasscodeEnabled()) {
    return res.json({ authenticated: true, passcodeEnabled: false });
  }
  const { passcode } = req.body || {};
  if (!safeEqualPasscode(passcode, process.env.APP_PASSCODE.trim())) {
    return res.status(401).json({ error: 'Incorrect family passcode. Please try again.' });
  }

  const token = createSessionToken();
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production' && req.secure,
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  return res.json({ authenticated: true, passcodeEnabled: true });
}

export function handlePasscodeLogout(req, res) {
  res.clearCookie(COOKIE_NAME);
  return res.json({ authenticated: !isPasscodeEnabled(), passcodeEnabled: isPasscodeEnabled() });
}
