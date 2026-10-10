// Existing handlers, registered at their original middleware positions.
function registerGoogleRoutes(app, context) {
app.get('/auth/google', (req, res, next) => {
  if (!context.googleSignInConfigured) return res.redirect('/?oauthError=google-not-configured');
  context.passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

app.get('/auth/google/callback',
  async (req, res, next) => {
    if (req.session?.mailboxOAuth?.provider === 'google') {
      return context.completeMailboxOAuth(req, res, 'google');
    }
    return next();
  },
  (req, res, next) => {
    context.passport.authenticate('google', { failureRedirect: '/?oauthError=google-sign-in-failed' })(req, res, next);
  },
  (req, res) => {
    const { account, error } = context.resolveOAuthAccount('google', req.user, context.db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    context.establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=google'), 'google');
  }
);

app.get('/auth/yahoo', (req, res) => {
  if (!context.yahooSignInConfigured) return res.redirect('/?oauthError=yahoo-not-configured');
  const state = context.crypto.randomBytes(24).toString('hex');
  req.session.yahooOAuthState = state;
  const authorizationUrl = new URL('https://api.login.yahoo.com/oauth2/request_auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.YAHOO_CLIENT_ID,
    redirect_uri: context.yahooCallbackUrl,
    response_type: 'code',
    scope: 'openid profile email',
    state
  }).toString();
  req.session.save(error => res.redirect(error ? '/?oauthError=session-failed' : authorizationUrl.toString()));
});

app.get('/auth/yahoo/callback', async (req, res) => {
  if (!context.yahooSignInConfigured || req.query.error || !req.query.code || req.query.state !== req.session.yahooOAuthState) {
    return res.redirect('/?oauthError=yahoo-sign-in-failed');
  }
  delete req.session.yahooOAuthState;
  try {
    const tokenResponse = await fetch('https://api.login.yahoo.com/oauth2/get_token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${process.env.YAHOO_CLIENT_ID}:${process.env.YAHOO_CLIENT_SECRET}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: context.yahooCallbackUrl })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Yahoo token exchange failed');
    const profileResponse = await fetch('https://api.login.yahoo.com/openid/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error('Yahoo profile request failed');
    const { account, error } = context.resolveOAuthAccount('yahoo', profile, context.db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    context.establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=yahoo'), 'yahoo');
  } catch (error) {
    context.logStructured('error', 'oauth.yahoo_signin_failed', { category: 'authentication', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?oauthError=yahoo-sign-in-failed');
  }
});

app.get('/auth/microsoft', (req, res) => {
  if (!context.microsoftSignInConfigured) return res.redirect('/?oauthError=microsoft-not-configured');
  const state = context.crypto.randomBytes(24).toString('hex');
  const verifier = context.crypto.randomBytes(48).toString('base64url');
  const challenge = context.crypto.createHash('sha256').update(verifier).digest('base64url');
  req.session.microsoftOAuthState = state;
  req.session.microsoftCodeVerifier = verifier;
  const authorizationUrl = new URL('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
  authorizationUrl.search = new URLSearchParams({
    client_id: process.env.MICROSOFT_CLIENT_ID,
    response_type: 'code',
    redirect_uri: context.microsoftCallbackUrl,
    response_mode: 'query',
    scope: 'openid profile email User.Read',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString();
  req.session.save(error => res.redirect(error ? '/?oauthError=session-failed' : authorizationUrl.toString()));
});

app.get('/auth/microsoft/callback', async (req, res) => {
  const verifier = req.session.microsoftCodeVerifier;
  if (!context.microsoftSignInConfigured || req.query.error || !req.query.code || !verifier || req.query.state !== req.session.microsoftOAuthState) {
    return res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
  delete req.session.microsoftOAuthState;
  delete req.session.microsoftCodeVerifier;
  try {
    const tokenResponse = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.MICROSOFT_CLIENT_ID,
        client_secret: process.env.MICROSOFT_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: req.query.code,
        redirect_uri: context.microsoftCallbackUrl,
        code_verifier: verifier,
        scope: 'openid profile email User.Read'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.access_token) throw new Error('Microsoft token exchange failed');
    const profileResponse = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName,otherMails', {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });
    const profile = await profileResponse.json();
    if (!profileResponse.ok) throw new Error('Microsoft profile request failed');
    const { account, error } = context.resolveOAuthAccount('microsoft', profile, context.db.users);
    if (error) return res.redirect(`/?oauthError=${encodeURIComponent(error)}`);
    context.establishAuthenticatedSession(req, account, error => res.redirect(error ? '/?oauthError=session-failed' : '/?oauth=microsoft'), 'microsoft');
  } catch (error) {
    context.logStructured('error', 'oauth.microsoft_signin_failed', { category: 'authentication', requestId: req.requestId, method: req.method, route: req.path, message: error.message });
    res.redirect('/?oauthError=microsoft-sign-in-failed');
  }
});
}

module.exports = { registerGoogleRoutes };
