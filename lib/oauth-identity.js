const PROVIDERS = new Set(['google', 'yahoo', 'microsoft']);

const normalizeEmail = value => String(value || '').trim().toLocaleLowerCase('en-US');
const validEmail = value => {
  const email = normalizeEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
};

const providerEmails = (provider, profile = {}) => {
  const candidates = [];
  if (provider === 'google') {
    if (profile.emailVerified !== false) candidates.push(profile.email);
    for (const entry of Array.isArray(profile.emails) ? profile.emails : []) {
      if (entry?.verified !== false) candidates.push(entry?.value || entry);
    }
  } else if (provider === 'yahoo') {
    candidates.push(profile.email);
  } else if (provider === 'microsoft') {
    candidates.push(profile.mail, ...(Array.isArray(profile.otherMails) ? profile.otherMails : []), profile.userPrincipalName);
  }
  return [...new Set(candidates.map(validEmail).filter(Boolean))];
};

const accountEmails = account => [account?.username, ...(Array.isArray(account?.loginAliases) ? account.loginAliases : [])]
  .map(validEmail)
  .filter(Boolean);

const resolveOAuthAccount = (provider, profile, accounts = []) => {
  if (!PROVIDERS.has(provider)) return { error: 'oauth-provider-unsupported' };
  const emails = providerEmails(provider, profile);
  if (!emails.length) return { error: 'oauth-email-missing' };
  const matches = accounts.filter(account => accountEmails(account).some(email => emails.includes(email)));
  if (matches.length !== 1) return { error: matches.length ? 'account-link-ambiguous' : 'account-not-linked' };
  if (String(matches[0].verificationStatus || '').toLocaleLowerCase('en-US').includes('pending')) {
    return { error: 'account-pending' };
  }
  return { account: matches[0], email: emails.find(email => accountEmails(matches[0]).includes(email)) };
};

const publicOrigin = (env = process.env) => {
  const fallback = 'https://littlefeet.co.za';
  const requested = String(env.LF_PUBLIC_ORIGIN || fallback).trim();
  try {
    const url = new URL(requested);
    const localDevelopment = env.NODE_ENV !== 'production' && ['localhost', '127.0.0.1'].includes(url.hostname);
    if ((url.protocol !== 'https:' && !(localDevelopment && url.protocol === 'http:')) || url.username || url.password) return fallback;
    return url.origin;
  } catch {
    return fallback;
  }
};

const oauthCallbackUrl = (provider, env = process.env) => {
  if (!PROVIDERS.has(provider)) throw new Error('Unsupported OAuth provider.');
  return `${publicOrigin(env)}/auth/${provider}/callback`;
};

module.exports = { normalizeEmail, validEmail, providerEmails, resolveOAuthAccount, publicOrigin, oauthCallbackUrl };
