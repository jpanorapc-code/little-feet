const crypto = require('crypto');

function registerFinanceAutomation(app, deps) {
  const {
    db, getSessionAccount, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    findAccountByUsername, normalizeUsername, limitedText, billingAmount, cents, validDateKey,
    dateKeyInSouthAfrica, createParentPaymentRecord, parentPaymentFinancials, parentPaymentView,
    applyPaymentEvent, findPaymentTarget, expectedPaymentAmount, saveDatabaseState,
    scheduleReplicaSnapshot, persistenceReady
  } = deps;

  const financeActor = req => {
    const actor = getSessionAccount(req);
    return actor && ['principal', 'admin'].includes(actor.role) ? actor : null;
  };
  const financeRecords = (name, actor) => (Array.isArray(db[name]) ? db[name].filter(record => recordInSchool(record, actor)) : []);
  const todayParts = (dateKey = dateKeyInSouthAfrica()) => {
    const [year, month, day] = String(dateKey).split('-').map(Number);
    return { year, month, day, period: String(dateKey).slice(0, 7) };
  };
  const monthlyDueDate = (period, dueDay) => period + '-' + String(Math.max(1, Math.min(28, Number(dueDay) || 1))).padStart(2, '0');
  const monthLabel = period => {
    const parsed = new Date(period + '-01T12:00:00Z');
    return Number.isNaN(parsed.getTime()) ? period : new Intl.DateTimeFormat('en-ZA', { month: 'long', year: 'numeric', timeZone: 'Africa/Johannesburg' }).format(parsed);
  };
  const financeParents = actor => db.users.filter(account =>
    account.role === 'parent' && isSameSchool(actor, account) && account.verificationStatus !== 'Suspended'
  );
  const staffForPayroll = actor => db.users.filter(account =>
    ['teacher', 'principal', 'admin'].includes(account.role) && isSameSchool(actor, account)
  );
  const safeDateRange = (req) => {
    const today = dateKeyInSouthAfrica();
    const from = validDateKey(req.query?.from) || today.slice(0, 4) + '-01-01';
    const to = validDateKey(req.query?.to) || today;
    return from <= to ? { from, to } : { from: to, to: from };
  };
  const dateWithin = (value, from, to) => {
    const key = validDateKey(String(value || '').slice(0, 10));
    return Boolean(key && key >= from && key <= to);
  };

  function runRecurringRulesForActor(actor, { force = false, asOf = dateKeyInSouthAfrica() } = {}) {
    const { day, period } = todayParts(asOf);
    const rules = financeRecords('financeRecurringRules', actor).filter(rule => rule.active !== false);
    const created = [];
    const skipped = [];

    for (const rule of rules) {
      if (rule.cadence !== 'monthly') {
        skipped.push({ ruleId: rule.id, reason: 'Unsupported cadence' });
        continue;
      }
      if (!force && day < Number(rule.dueDay || 1)) continue;
      const parents = rule.parentUsername === '*'
        ? financeParents(actor)
        : financeParents(actor).filter(parent => normalizeUsername(parent.username) === normalizeUsername(rule.parentUsername));
      for (const parent of parents) {
        const duplicate = (db.parentPayments || []).some(payment =>
          payment.recurringRuleId === rule.id
          && payment.recurringPeriod === period
          && normalizeUsername(payment.parentUsername) === normalizeUsername(parent.username)
          && payment.schoolId === accountSchoolId(actor)
        );
        if (duplicate) {
          skipped.push({ ruleId: rule.id, parentUsername: parent.username, reason: 'Already generated for period' });
          continue;
        }
        const result = createParentPaymentRecord({
          parentUsername: parent.username,
          learnerName: rule.learnerName || '',
          description: String(rule.description || rule.name || 'Recurring school fee').replace(/\{month\}/gi, monthLabel(period)),
          amountDue: rule.amount,
          dueDate: monthlyDueDate(period, rule.dueDay),
          arrangementDueDate: '',
          arrangementAmount: '',
          arrangementNote: ''
        }, actor);
        if (result.error) {
          skipped.push({ ruleId: rule.id, parentUsername: parent.username, reason: result.error });
          continue;
        }
        result.record.recurringRuleId = rule.id;
        result.record.recurringPeriod = period;
        result.record.automationSource = 'monthly-recurring-rule';
        db.parentPayments.unshift(result.record);
        created.push(result.record);
      }
      rule.lastRunPeriod = period;
      rule.lastRunAt = new Date().toISOString();
    }
    return { created, skipped, period };
  }

  async function runDueRecurringRules() {
    let changed = false;
    const schoolIds = [...new Set((db.financeRecurringRules || []).filter(rule => rule.active !== false).map(rule => rule.schoolId).filter(Boolean))];
    for (const schoolId of schoolIds) {
      const actor = db.users.find(account => ['admin', 'principal'].includes(account.role) && accountSchoolId(account) === schoolId);
      if (!actor) continue;
      const result = runRecurringRulesForActor(actor);
      if (result.created.length) changed = true;
    }
    if (changed) {
      await saveDatabaseState();
      scheduleReplicaSnapshot();
    }
  }

  function statementFor(actor, parentUsername, from, to) {
    const parent = findAccountByUsername(parentUsername);
    if (!parent || parent.role !== 'parent' || !isSameSchool(actor, parent)) return null;
    const payments = (db.parentPayments || []).filter(record =>
      recordInSchool(record, actor) && normalizeUsername(record.parentUsername) === normalizeUsername(parent.username)
    );
    const references = new Set(payments.map(record => String(record.reference || '').toUpperCase()));
    const allRows = [];

    for (const payment of payments) {
      const amount = billingAmount(payment.arrangementAmount) > 0 ? billingAmount(payment.arrangementAmount) : (billingAmount(payment.amountDue) || 0);
      allRows.push({
        date: String(payment.createdAt || '').slice(0, 10) || payment.dueDate,
        type: 'invoice',
        reference: payment.reference,
        description: payment.description || 'School fee invoice',
        debit: amount,
        credit: 0
      });
    }
    for (const event of db.paymentEvents || []) {
      if (!references.has(String(event.reference || '').toUpperCase())) continue;
      if (!['paid', 'refunded'].includes(event.status)) continue;
      allRows.push({
        date: String(event.receivedAt || '').slice(0, 10),
        type: event.status === 'paid' ? 'payment' : 'refund',
        reference: event.reference,
        description: event.status === 'paid' ? 'Payment received' : 'Payment refunded',
        debit: event.status === 'refunded' ? Number(event.amount || 0) : 0,
        credit: event.status === 'paid' ? Number(event.amount || 0) : 0
      });
    }
    for (const adjustment of db.financeAdjustments || []) {
      if (adjustment.schoolId !== accountSchoolId(actor) || !references.has(String(adjustment.reference || '').toUpperCase())) continue;
      if (adjustment.type !== 'credit') continue;
      allRows.push({
        date: String(adjustment.createdAt || '').slice(0, 10),
        type: 'credit',
        reference: adjustment.reference,
        description: adjustment.reason || 'Credit note',
        debit: 0,
        credit: Number(adjustment.amount || 0)
      });
    }

    allRows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.reference).localeCompare(String(b.reference)));
    let running = 0;
    let openingBalance = 0;
    for (const row of allRows) {
      if (row.date < from) openingBalance = cents(openingBalance + Number(row.debit || 0) - Number(row.credit || 0));
    }
    running = openingBalance;
    const rows = allRows.filter(row => row.date >= from && row.date <= to).map(row => {
      running = cents(running + Number(row.debit || 0) - Number(row.credit || 0));
      return { ...row, debit: cents(row.debit), credit: cents(row.credit), balance: running };
    });
    return {
      parent: { username: parent.username, name: parent.name || parent.username },
      period: { from, to },
      openingBalance,
      rows,
      closingBalance: running,
      totalDebits: cents(rows.reduce((sum, row) => sum + row.debit, 0)),
      totalCredits: cents(rows.reduce((sum, row) => sum + row.credit, 0))
    };
  }

  function stableBankLineId(actor, line) {
    const supplied = limitedText(line?.id || line?.bankReference || '', 160);
    if (supplied) return supplied;
    return crypto.createHash('sha256').update([
      accountSchoolId(actor), line?.date || '', line?.amount || '', line?.reference || '', line?.description || ''
    ].join('|')).digest('hex').slice(0, 32);
  }

  function knownSchoolReferences(actor) {
    const refs = [];
    const schoolId = accountSchoolId(actor);
    (db.parentPayments || []).forEach(record => { if (record.schoolId === schoolId && record.reference) refs.push(record.reference); });
    (db.parentSubscriptions || []).forEach(record => { if (record.schoolId === schoolId && record.reference) refs.push(record.reference); });
    (db.storeOrders || []).forEach(record => { if (record.schoolId === schoolId && record.reference) refs.push(record.reference); });
    const billing = db.schoolBilling?.[schoolId];
    (billing?.orders || []).forEach(record => { if (record.reference) refs.push(record.reference); });
    return [...new Set(refs.map(value => String(value).toUpperCase()))].sort((a, b) => b.length - a.length);
  }

  function previewBankLines(actor, rawLines) {
    if (!Array.isArray(rawLines) || !rawLines.length || rawLines.length > 500) {
      return { error: 'Supply between 1 and 500 bank statement lines.' };
    }
    const refs = knownSchoolReferences(actor);
    const results = rawLines.map((line, index) => {
      const amount = billingAmount(line?.amount);
      const description = limitedText(line?.description || '', 500);
      const directReference = limitedText(line?.reference || '', 160);
      const bankReference = limitedText(line?.bankReference || line?.id || '', 160);
      const receivedDate = validDateKey(line?.date) || dateKeyInSouthAfrica();
      const lineId = stableBankLineId(actor, line);
      const eventId = 'auto:' + accountSchoolId(actor) + ':' + lineId;
      if (amount === null || amount <= 0 || description === null || directReference === null || bankReference === null) {
        return { index, lineId, status: 'invalid', reason: 'Invalid amount or oversized bank line field.' };
      }
      if ((db.paymentEvents || []).some(event => event.eventId === eventId)) {
        return { index, lineId, status: 'duplicate', amount, bankReference, date: receivedDate };
      }
      let reference = String(directReference || '').trim().toUpperCase();
      if (!reference) {
        const haystack = String(description || '').toUpperCase();
        reference = refs.find(candidate => haystack.includes(candidate)) || '';
      }
      const target = reference ? findPaymentTarget(reference, actor) : null;
      if (!target) return { index, lineId, status: 'unmatched', amount, bankReference, date: receivedDate, description };
      const remaining = target.type === 'parent_payment'
        ? parentPaymentFinancials(target.record).balance
        : (String(target.record.paymentStatus || '') === 'paid' ? 0 : expectedPaymentAmount(target));
      const amountMatches = target.type === 'parent_payment' ? amount <= remaining && remaining > 0 : amount === remaining && remaining > 0;
      if (!amountMatches) {
        return { index, lineId, status: 'amount_mismatch', reference: target.record.reference, amount, expectedRemaining: remaining, bankReference, date: receivedDate };
      }
      return {
        index, lineId, status: 'matched', confidence: 'exact-reference', reference: target.record.reference,
        targetType: target.type, amount, expectedRemaining: remaining, bankReference, date: receivedDate, description
      };
    });
    return {
      results,
      counts: results.reduce((counts, row) => {
        counts[row.status] = (counts[row.status] || 0) + 1;
        return counts;
      }, {})
    };
  }

  function buildAccountingJournal(actor, from, to) {
    const rows = [];
    const schoolId = accountSchoolId(actor);
    const pushPair = ({ date, reference, memo, sourceType, debitAccount, creditAccount, amount }) => {
      const numeric = cents(amount);
      if (numeric <= 0 || !dateWithin(date, from, to)) return;
      rows.push({ date: String(date).slice(0, 10), reference, memo, sourceType, account: debitAccount, debit: numeric, credit: 0 });
      rows.push({ date: String(date).slice(0, 10), reference, memo, sourceType, account: creditAccount, debit: 0, credit: numeric });
    };

    for (const payment of db.parentPayments || []) {
      if (payment.schoolId !== schoolId) continue;
      const invoiceAmount = billingAmount(payment.arrangementAmount) > 0 ? billingAmount(payment.arrangementAmount) : billingAmount(payment.amountDue);
      pushPair({
        date: payment.createdAt || payment.dueDate, reference: payment.reference, memo: payment.description || 'Parent school fee',
        sourceType: 'parent_invoice', debitAccount: 'Accounts Receivable', creditAccount: 'School Fee Revenue', amount: invoiceAmount
      });
    }
    for (const adjustment of db.financeAdjustments || []) {
      if (adjustment.schoolId !== schoolId || adjustment.type !== 'credit') continue;
      pushPair({
        date: adjustment.createdAt, reference: adjustment.reference, memo: adjustment.reason || 'Credit note',
        sourceType: 'credit_note', debitAccount: 'School Fee Revenue', creditAccount: 'Accounts Receivable', amount: adjustment.amount
      });
    }
    for (const ledger of db.paymentLedger || []) {
      if (ledger.schoolId !== schoolId || !['paid', 'refunded'].includes(ledger.status)) continue;
      const isRefund = ledger.status === 'refunded';
      const creditAccount = ledger.targetType === 'parent_payment' ? 'Accounts Receivable'
        : ledger.targetType === 'subscription' ? 'School Subscription Revenue'
        : ledger.targetType === 'parent_subscription' ? 'Family Subscription Revenue'
        : ledger.targetType === 'store' ? 'School Store Revenue'
        : 'Other Revenue';
      pushPair({
        date: ledger.createdAt, reference: ledger.reference, memo: isRefund ? 'Refund' : 'Payment received',
        sourceType: 'payment', debitAccount: isRefund ? creditAccount : 'Bank Clearing',
        creditAccount: isRefund ? 'Bank Clearing' : creditAccount, amount: ledger.amount
      });
    }
    for (const run of db.payrollRuns || []) {
      if (run.schoolId !== schoolId || run.status !== 'approved') continue;
      if (!dateWithin(run.payDate, from, to)) continue;
      const gross = cents((run.lines || []).reduce((sum, line) => sum + Number(line.gross || 0), 0));
      const deductions = cents((run.lines || []).reduce((sum, line) => sum + Number(line.deductions || 0), 0));
      const net = cents((run.lines || []).reduce((sum, line) => sum + Number(line.net || 0), 0));
      if (gross > 0) rows.push({ date: run.payDate, reference: run.id, memo: 'Payroll run ' + run.periodStart + ' to ' + run.periodEnd, sourceType: 'payroll', account: 'Payroll Expense', debit: gross, credit: 0 });
      if (deductions > 0) rows.push({ date: run.payDate, reference: run.id, memo: 'Payroll deductions payable', sourceType: 'payroll', account: 'Payroll Deductions Payable', debit: 0, credit: deductions });
      if (net > 0) rows.push({ date: run.payDate, reference: run.id, memo: 'Net payroll payable', sourceType: 'payroll', account: 'Payroll Payable', debit: 0, credit: net });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date) || String(a.reference).localeCompare(String(b.reference)));
    return {
      period: { from, to },
      rows,
      totalDebits: cents(rows.reduce((sum, row) => sum + Number(row.debit || 0), 0)),
      totalCredits: cents(rows.reduce((sum, row) => sum + Number(row.credit || 0), 0)),
      note: 'Generic journal export. Review account mappings and statutory treatment with the school’s accountant or payroll provider before import.'
    };
  }

  app.get('/api/finance/automation', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const rules = financeRecords('financeRecurringRules', actor);
    const profiles = financeRecords('payrollProfiles', actor);
    const payrollRuns = financeRecords('payrollRuns', actor);
    const adjustments = financeRecords('financeAdjustments', actor);
    const reconciliationRuns = financeRecords('financeReconciliationRuns', actor);
    res.json({
      rules,
      payrollProfiles: profiles,
      payrollRuns: payrollRuns.slice(0, 24),
      recentAdjustments: adjustments.slice(0, 20),
      recentReconciliationRuns: reconciliationRuns.slice(0, 20),
      counts: {
        recurringRules: rules.length,
        activeRecurringRules: rules.filter(rule => rule.active !== false).length,
        payrollProfiles: profiles.filter(profile => profile.active !== false).length,
        payrollRuns: payrollRuns.length
      }
    });
  });

  app.post('/api/finance/recurring-rules', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const name = limitedText(req.body?.name, 160);
    const description = limitedText(req.body?.description, 240);
    const learnerName = limitedText(req.body?.learnerName || '', 160);
    const amount = billingAmount(req.body?.amount);
    const dueDay = Number(req.body?.dueDay);
    const parentUsername = String(req.body?.parentUsername || '*').trim();
    if (!name || !description || learnerName === null || amount === null || amount <= 0 || !Number.isInteger(dueDay) || dueDay < 1 || dueDay > 28) {
      return res.status(400).json({ message: 'Enter a name, description, positive amount, and due day from 1 to 28.' });
    }
    if (parentUsername !== '*') {
      const parent = findAccountByUsername(parentUsername);
      if (!parent || parent.role !== 'parent' || !isSameSchool(actor, parent)) return res.status(400).json({ message: 'Choose a parent account from this school.' });
    }
    const rule = tagSchoolRecord(actor, {
      id: crypto.randomUUID(), name, description, learnerName, amount, dueDay,
      parentUsername: parentUsername === '*' ? '*' : findAccountByUsername(parentUsername).username,
      cadence: 'monthly', active: req.body?.active !== false,
      createdAt: new Date().toISOString(), createdBy: actor.username, lastRunPeriod: '', lastRunAt: ''
    });
    db.financeRecurringRules.unshift(rule);
    res.status(201).json({ success: true, rule });
  });

  app.post('/api/finance/recurring-rules/:id/toggle', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const rule = financeRecords('financeRecurringRules', actor).find(entry => entry.id === req.params.id);
    if (!rule) return res.status(404).json({ message: 'Recurring invoice rule not found.' });
    rule.active = req.body?.active === undefined ? !rule.active : Boolean(req.body.active);
    rule.updatedAt = new Date().toISOString();
    rule.updatedBy = actor.username;
    res.json({ success: true, rule });
  });

  app.post('/api/finance/recurring-runs', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const result = runRecurringRulesForActor(actor, { force: Boolean(req.body?.force) });
    res.status(result.created.length ? 201 : 200).json({
      success: true, period: result.period,
      created: result.created.map(record => parentPaymentView(record, actor)),
      skipped: result.skipped
    });
  });

  app.get('/api/finance/statements', (req, res) => {
    const actor = getSessionAccount(req);
    if (!actor || !['parent', 'principal', 'admin'].includes(actor.role)) return res.status(403).json({ message: 'Statement access is required.' });
    const parentUsername = actor.role === 'parent' ? actor.username : String(req.query?.parentUsername || '').trim();
    if (!parentUsername) return res.status(400).json({ message: 'Choose a parent account.' });
    const { from, to } = safeDateRange(req);
    const statement = statementFor(actor, parentUsername, from, to);
    if (!statement) return res.status(404).json({ message: 'Parent account not found for this school.' });
    res.json(statement);
  });

  app.post('/api/finance/adjustments', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const payment = (db.parentPayments || []).find(record => record.id === String(req.body?.paymentId || '') && recordInSchool(record, actor));
    const type = String(req.body?.type || '').trim().toLowerCase();
    const amount = billingAmount(req.body?.amount);
    const reason = limitedText(req.body?.reason, 500);
    if (!payment || !['credit', 'refund'].includes(type) || amount === null || amount <= 0 || !reason) {
      return res.status(400).json({ message: 'Choose an invoice, credit/refund type, positive amount, and reason.' });
    }
    const financials = parentPaymentFinancials(payment);
    if (type === 'credit' && amount > financials.balance) return res.status(400).json({ message: 'A credit cannot exceed the current invoice balance.' });
    if (type === 'refund' && amount > financials.paidAmount) return res.status(400).json({ message: 'A refund cannot exceed the net amount paid.' });

    let eventId = '';
    if (type === 'refund') {
      eventId = 'finance-refund:' + accountSchoolId(actor) + ':' + crypto.randomUUID();
      const result = applyPaymentEvent({
        eventId, reference: payment.reference, status: 'refunded', amount,
        providerTransactionId: limitedText(req.body?.bankReference || '', 160) || '',
        source: 'finance-refund', receivedAt: new Date().toISOString()
      }, actor);
      if (result.error) return res.status(400).json({ message: result.error });
    } else {
      db.paymentLedger.unshift(tagSchoolRecord(actor, {
        id: crypto.randomUUID(), eventId: 'credit:' + crypto.randomUUID(), reference: payment.reference,
        targetType: 'parent_payment', amount, status: 'credited', source: 'finance-credit-note',
        createdAt: new Date().toISOString(), recordedBy: actor.username
      }));
    }

    const adjustment = tagSchoolRecord(actor, {
      id: crypto.randomUUID(), type, reference: payment.reference, paymentId: payment.id, amount,
      reason, eventId, createdAt: new Date().toISOString(), createdBy: actor.username
    });
    db.financeAdjustments.unshift(adjustment);
    res.status(201).json({ success: true, adjustment, payment: parentPaymentView(payment, actor) });
  });

  app.post('/api/finance/reconciliation/preview', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const preview = previewBankLines(actor, req.body?.lines);
    if (preview.error) return res.status(400).json({ message: preview.error });
    res.json(preview);
  });

  app.post('/api/finance/reconciliation/apply', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const preview = previewBankLines(actor, req.body?.lines);
    if (preview.error) return res.status(400).json({ message: preview.error });
    const applied = [];
    const failed = [];
    for (const row of preview.results.filter(result => result.status === 'matched')) {
      const result = applyPaymentEvent({
        eventId: 'auto:' + accountSchoolId(actor) + ':' + row.lineId,
        reference: row.reference, status: 'paid', amount: row.amount,
        providerTransactionId: row.bankReference, source: 'auto-bank-reconciliation',
        receivedAt: row.date + 'T12:00:00.000Z'
      }, actor);
      if (result.error) failed.push({ ...row, error: result.error });
      else applied.push({ ...row, duplicate: result.duplicate });
    }
    const run = tagSchoolRecord(actor, {
      id: crypto.randomUUID(), createdAt: new Date().toISOString(), createdBy: actor.username,
      inputCount: preview.results.length, matchedCount: preview.results.filter(row => row.status === 'matched').length,
      appliedCount: applied.filter(row => !row.duplicate).length, duplicateCount: applied.filter(row => row.duplicate).length,
      failedCount: failed.length
    });
    db.financeReconciliationRuns.unshift(run);
    res.status(201).json({ success: true, run, applied, failed, previewCounts: preview.counts });
  });

  app.get('/api/finance/payroll/profiles', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    res.json(financeRecords('payrollProfiles', actor));
  });

  app.put('/api/finance/payroll/profiles/:username', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const account = findAccountByUsername(req.params.username);
    if (!account || !['teacher', 'principal', 'admin'].includes(account.role) || !isSameSchool(actor, account)) {
      return res.status(404).json({ message: 'Staff account not found for this school.' });
    }
    const employeeNumber = limitedText(req.body?.employeeNumber || '', 80);
    const payFrequency = ['monthly', 'weekly'].includes(req.body?.payFrequency) ? req.body.payFrequency : 'monthly';
    const baseGross = billingAmount(req.body?.baseGross);
    const defaultAllowances = billingAmount(req.body?.defaultAllowances || 0);
    const defaultDeductions = billingAmount(req.body?.defaultDeductions || 0);
    if (employeeNumber === null || baseGross === null || defaultAllowances === null || defaultDeductions === null) {
      return res.status(400).json({ message: 'Payroll amounts must be valid non-negative values.' });
    }
    if (defaultDeductions > cents(baseGross + defaultAllowances)) return res.status(400).json({ message: 'Default deductions cannot exceed gross pay plus allowances.' });
    let profile = financeRecords('payrollProfiles', actor).find(entry => normalizeUsername(entry.username) === normalizeUsername(account.username));
    if (!profile) {
      profile = tagSchoolRecord(actor, { id: crypto.randomUUID(), username: account.username, employeeName: account.name || account.username, createdAt: new Date().toISOString(), createdBy: actor.username });
      db.payrollProfiles.unshift(profile);
    }
    Object.assign(profile, {
      employeeName: account.name || account.username, employeeNumber, payFrequency, baseGross,
      defaultAllowances, defaultDeductions, active: req.body?.active !== false,
      updatedAt: new Date().toISOString(), updatedBy: actor.username
    });
    res.json({ success: true, profile });
  });

  app.get('/api/finance/payroll/runs', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    res.json(financeRecords('payrollRuns', actor));
  });

  app.post('/api/finance/payroll/runs', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const periodStart = validDateKey(req.body?.periodStart);
    const periodEnd = validDateKey(req.body?.periodEnd);
    const payDate = validDateKey(req.body?.payDate);
    const note = limitedText(req.body?.note || '', 500);
    if (!periodStart || !periodEnd || !payDate || periodStart > periodEnd || note === null) {
      return res.status(400).json({ message: 'Enter a valid payroll period and pay date.' });
    }
    const requested = Array.isArray(req.body?.usernames) ? new Set(req.body.usernames.map(normalizeUsername)) : null;
    const profiles = financeRecords('payrollProfiles', actor).filter(profile =>
      profile.active !== false && (!requested || requested.has(normalizeUsername(profile.username)))
    );
    if (!profiles.length) return res.status(400).json({ message: 'Create at least one active payroll profile first.' });
    const lines = profiles.map(profile => {
      const gross = cents(Number(profile.baseGross || 0) + Number(profile.defaultAllowances || 0));
      const deductions = cents(profile.defaultDeductions || 0);
      return {
        username: profile.username, employeeName: profile.employeeName, employeeNumber: profile.employeeNumber || '',
        baseGross: cents(profile.baseGross), allowances: cents(profile.defaultAllowances),
        gross, deductions, net: cents(gross - deductions)
      };
    });
    const run = tagSchoolRecord(actor, {
      id: crypto.randomUUID(), periodStart, periodEnd, payDate, note, status: 'draft',
      lines, createdAt: new Date().toISOString(), createdBy: actor.username,
      totals: {
        gross: cents(lines.reduce((sum, line) => sum + line.gross, 0)),
        deductions: cents(lines.reduce((sum, line) => sum + line.deductions, 0)),
        net: cents(lines.reduce((sum, line) => sum + line.net, 0))
      },
      complianceNote: 'Little Feet does not calculate PAYE, UIF, SDL or other statutory payroll obligations. Deductions must be approved and verified through the school’s payroll/accounting process.'
    });
    db.payrollRuns.unshift(run);
    res.status(201).json({ success: true, run });
  });

  app.post('/api/finance/payroll/runs/:id/approve', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const run = financeRecords('payrollRuns', actor).find(entry => entry.id === req.params.id);
    if (!run) return res.status(404).json({ message: 'Payroll run not found.' });
    if (run.status === 'approved') return res.json({ success: true, run, duplicate: true });
    run.status = 'approved';
    run.approvedAt = new Date().toISOString();
    run.approvedBy = actor.username;
    res.json({ success: true, run });
  });

  app.get('/api/finance/accounting-export', (req, res) => {
    const actor = financeActor(req);
    if (!actor) return res.status(403).json({ message: 'Principal or administrator finance access is required.' });
    const { from, to } = safeDateRange(req);
    res.json(buildAccountingJournal(actor, from, to));
  });

  if (persistenceReady?.then) {
    persistenceReady.then(() => {
      void runDueRecurringRules().catch(error => console.error('Recurring finance automation failed:', error.message));
      const timer = setInterval(() => {
        void runDueRecurringRules().catch(error => console.error('Recurring finance automation failed:', error.message));
      }, 6 * 60 * 60 * 1000);
      timer.unref?.();
    }).catch(() => {});
  }

  return { runDueRecurringRules };
}

module.exports = { registerFinanceAutomation };
