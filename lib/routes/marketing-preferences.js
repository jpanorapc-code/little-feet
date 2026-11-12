'use strict';

function registerMarketingUnsubscribeRoutes(app, context) {
  app.post('/api/marketing/unsubscribe', (req, res) => {
    if (!context.enforcePublicRateLimit(req, res, 'marketing-unsubscribe', 8, 60 * 60 * 1000)) return;
    if (context.readOnlySnapshotMode) {
      return res.status(503).json({ message: 'Opt-out requests cannot be saved while the service is read-only. Please retry shortly.' });
    }

    const email = String(req.body?.email || '').trim().toLowerCase();
    if (email.length > 254 || !context.looksLikeEmailAddress(email)) {
      return res.status(400).json({ message: 'Enter a valid email address.' });
    }

    const key = String(process.env.LF_FIELD_ENCRYPTION_KEY || 'LittleFeet-development-key-change-before-production');
    const emailHash = context.crypto.createHmac('sha256', key).update(email).digest('hex');
    if (!Array.isArray(context.db.marketingOptOuts)) context.db.marketingOptOuts = [];
    const alreadyOptedOut = context.db.marketingOptOuts.some(record => record.emailHash === emailHash);
    if (!alreadyOptedOut) {
      context.db.marketingOptOuts.unshift({
        id: emailHash,
        emailHash,
        optedOutAt: new Date().toISOString(),
        source: 'website_footer'
      });
    }

    return res.json({ success: true, alreadyOptedOut });
  });
}

module.exports = { registerMarketingUnsubscribeRoutes };
