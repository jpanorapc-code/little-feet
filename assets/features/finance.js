// finance workspace handlers. Shared session state is owned by backup.js.
// Classic deferred scripts retain the existing inline-handler/global contracts.

function enforceSchoolSubscriptionUi() {
  const access = currentUser?.schoolSubscriptionAccess;
  if (!access || access.allowed || isFullAccessUser(currentUser)) return false;
  const canRenew = ['admin', 'principal', 'school_accounts'].includes(currentUser?.role);
  window.setTimeout(async () => {
    const statusLabel = String(access.status || 'expired').replaceAll('_', ' ');
    const detail = access.status === 'trial_expired'
      ? `The 14-day Little Feet trial for <strong>${escapeWorkspaceText(currentUser.schoolName || 'this school')}</strong> has ended.`
      : access.status === 'trial_pending'
        ? `The 14-day Little Feet trial for <strong>${escapeWorkspaceText(currentUser.schoolName || 'this school')}</strong> has not been activated yet.`
        : `The Little Feet subscription for <strong>${escapeWorkspaceText(currentUser.schoolName || 'this school')}</strong> is ${escapeWorkspaceText(statusLabel)}.`;
    if (canRenew) {
      const financeButton = [...document.querySelectorAll('.nav-btn')].find(button => String(button.getAttribute('onclick') || '').includes("'financeTab'"));
      if (financeButton) switchTab('financeTab', financeButton);
      await loadSubscriptionBillingOverview();
      openModal('School subscription required', `<p style="line-height:1.6;">${detail}</p><p class="meta">School data remains protected. Renew or activate a plan to restore normal portal access.</p><button type="button" class="submit-btn" onclick="closeModal(); openSubscriptionCheckout();">Choose plan & create payment request</button>`);
    } else {
      openModal('School subscription inactive', `<p style="line-height:1.6;">${detail}</p><p class="meta">Please contact the school principal or administrator to renew Little Feet access.</p>`);
    }
  }, 0);
  return true;
}

async function loadCompanyBilling() {
  const host = document.getElementById('companyBillingContent');
  if (!host || !(isFullAccessUser() || currentUser?.role === 'accounts')) return;
  const session = workspaceSessionKey();
  try {
    const response = await fetch('/api/company/billing'); const data = await response.json();
    if (session !== workspaceSessionKey()) return;
    if (!response.ok) throw new Error(data.message || 'Could not load company invoices.');
    host.replaceChildren();
    if (!data.orders.length) { host.textContent = 'No school subscription invoices recorded yet.'; return; }
    for (const invoice of data.orders) {
      const card = document.createElement('div'); card.className = 'workspace-card';
      const title = document.createElement('h3'); title.textContent = invoice.schoolName;
      const detail = document.createElement('p'); detail.textContent = `${invoice.reference} · R ${Number(invoice.amount || 0).toFixed(2)} · ${invoice.status}`;
      card.append(title,detail);
      if (!/paid/i.test(invoice.status)) {
        const form = document.createElement('form');
        const reference = document.createElement('input'); reference.required = true; reference.maxLength = 160;
        const label = document.createElement('label'); label.textContent = 'Bank payment reference'; label.append(reference);
        const save = document.createElement('button'); save.type = 'submit'; save.className = 'action-btn'; save.textContent = 'Record confirmed payment';
        const status = document.createElement('p'); status.setAttribute('role','status');
        const eventId = crypto.randomUUID();
        form.append(label,save,status); form.addEventListener('submit', async event => {
          event.preventDefault(); if (!confirm('Have you verified this payment against the bank record?')) return;
          save.disabled = true;
          try {
            const result = await fetch('/api/company/billing/reconcile', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({reference:invoice.reference,amount:invoice.amount,bankReference:reference.value,eventId})});
            const payload = await result.json(); if (session !== workspaceSessionKey()) return;
            if (!result.ok) throw new Error(payload.message || 'Could not record payment.'); await loadCompanyBilling();
          } catch (error) { if (session === workspaceSessionKey()) status.textContent = error.message; }
          finally { save.disabled = false; }
        }); card.append(form);
      }
      host.append(card);
    }
  } catch (error) { if (session === workspaceSessionKey()) host.textContent = error.message; }
}

function paymentDestinationMarkup(payment, linkLabel = 'Pay securely now') {
  const effectiveLabel = payment?.provider === 'payfast' ? 'Pay securely with PayFast' : linkLabel;
  const primary = payment.paymentLink
    ? `<a class="submit-btn" style="display:inline-block;text-decoration:none;text-align:center;" href="${escapeWorkspaceText(payment.paymentLink)}" target="_blank" rel="noopener">${escapeWorkspaceText(effectiveLabel)}</a>${payment?.automaticConfirmation ? '<p class="meta" style="margin:8px 0 0;">Payment is confirmed automatically by PayFast. Little Feet activates the subscription only after the verified payment notification is received.</p>' : ''}`
    : `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><strong>${escapeWorkspaceText(payment.bankName)}</strong><br>Account name: ${escapeWorkspaceText(payment.accountName)}<br>Account number: ${escapeWorkspaceText(payment.accountNumber)}${payment.branchCode ? `<br>Branch code: ${escapeWorkspaceText(payment.branchCode)}` : ''}</div>`;
  const capitec = payment.capitecPayMePayload
    ? `<div style="margin-top:12px;padding:12px;border:1px solid #2dd4bf;border-radius:8px;text-align:center;background:rgba(45,212,191,.08);"><strong>Pay with the Capitec app</strong><div id="capitecPayMeQr" style="width:190px;min-height:190px;margin:10px auto;background:#fff;padding:5px;"></div><span class="meta">Capitec customers can scan this Pay Me code. Other banks can use the EFT details above.</span></div>`
    : '';
  return `${primary}${capitec}`;
}

function renderCapitecPayMeQr(payment) {
  const holder = document.getElementById('capitecPayMeQr');
  if (!holder || !payment?.capitecPayMePayload || !window.QRCode) return;
  new window.QRCode(holder, { text: payment.capitecPayMePayload, width: 180, height: 180, correctLevel: window.QRCode.CorrectLevel.M });
}

async function openDonationModal() {
  let status;
  try {
    const response = await fetch('/api/donations/payment');
    status = await response.json();
    if (!response.ok) throw new Error(status.message || 'Unable to open donations.');
  } catch (error) { return alert(safeUserFacingError(error, 'Unable to open donations.')); }
  if (!status.configured) {
    if (isFullAccessUser()) {
      return openModal('Set up donations', `<p style="font-size:.9rem;line-height:1.6;">No donation payment destination has been saved yet. Add a secure payment link or bank-transfer account once, then the Donate button will accept real donation requests.</p><button type="button" class="submit-btn" onclick="closeModal(); openSubscriptionBillingAdmin();">Add payment destination</button>`);
    }
    return openModal('Donations temporarily unavailable', `<p style="font-size:.9rem;line-height:1.6;">Little Feet has not published its secure donation destination yet. Please check back soon.</p>`);
  }
  openModal('Donate to Little Feet', `<form onsubmit="createDonationIntent(event)" style="display:grid;gap:12px;font-size:.9rem;"><p style="margin:0;color:var(--text-muted);line-height:1.55;">Your contribution supports accessible tools and continued improvements for early-learning communities.</p><label>Donation amount (R)<input name="amount" type="number" min="1" step="0.01" required placeholder="e.g. 50"></label><label>Your name <span style="color:var(--text-muted);">(optional)</span><input name="donorName" maxlength="120" autocomplete="name"></label><label>Email for acknowledgement <span style="color:var(--text-muted);">(optional)</span><input name="donorEmail" type="email" maxlength="160" autocomplete="email"></label><button class="submit-btn">Continue to donate</button></form>`);
}

async function createDonationIntent(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/donations/intents', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ amount: form.elements.amount.value, donorName: form.elements.donorName.value, donorEmail: form.elements.donorEmail.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to prepare the donation.');
    const payment = result.payment;    const destination = paymentDestinationMarkup(payment, 'Continue to secure payment');
    openModal('Donation ready', `<p style="margin:0 0 10px;">Thank you for supporting Little Feet.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>Donation: ${formatSubscriptionMoney(result.donation.amount)}</strong><br>Reference: <strong>${escapeWorkspaceText(result.donation.reference)}</strong></div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the contribution can be matched correctly.</p>`);
    renderCapitecPayMeQr(payment);
  } catch (error) { alert(safeUserFacingError(error, 'Unable to prepare the donation.')); }
}

function formatSubscriptionMoney(value) {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 2 }).format(Number(value || 0));
}

async function loadSubscriptionBillingOverview() {
  const container = document.getElementById('subscriptionBillingOverview');
  if (!container || !(isFullAccessUser() || currentUser?.role === 'principal')) return;
  try {
    const response = await fetch('/api/subscription-billing');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription information.');
    const isAdmin = isFullAccessUser();
    const bundles = data.pricing.bundles || [];
    const awaiting = (data.orders || []).filter(order => ['awaiting_payment', 'awaiting payment'].includes(String(order.paymentStatus || order.status || '').toLowerCase()));
    const requestedMonthly = awaiting.reduce((total, order) => total + Number(order.monthlyTotal || 0), 0);
    const potentialMargin = awaiting.reduce((total, order) => total + Number(order.profitMargin || 0), 0);
    const rows = bundles.map(bundle => {
      const margin = Number(bundle.sellingPrice || 0) - Number(bundle.costPrice || 0);
      return `<tr><td style="padding:9px 10px;"><strong>+${bundle.capacity} children</strong></td>${isAdmin ? `<td style="padding:9px 10px;">${formatSubscriptionMoney(bundle.costPrice)}</td>` : ''}<td style="padding:9px 10px;">${formatSubscriptionMoney(bundle.sellingPrice)}</td>${isAdmin ? `<td style="padding:9px 10px;color:#2dd4bf;font-weight:700;">${formatSubscriptionMoney(margin)}</td>` : ''}</tr>`;
    }).join('');
    const orders = (data.orders || []).slice(0, 6).map(order => {
      const paymentStatus = String(order.paymentStatus || order.status || '').replaceAll('_', ' ');
      const reconcile = isAdmin && !['paid', 'refunded'].includes(String(order.paymentStatus || order.status || '').toLowerCase())
        ? `<button type="button" class="action-btn btn-green" style="margin-left:8px;" onclick="openSubscriptionPaymentReconcile('${encodeInlineIdentifier(order.reference)}',${Number(order.monthlyTotal || 0)})">Record payment</button>`
        : '';
      return `<li><strong>${escapeWorkspaceText(order.reference)}</strong> · ${escapeWorkspaceText(order.schoolName)} · ${formatSubscriptionMoney(order.monthlyTotal)}/month · ${escapeWorkspaceText(paymentStatus)}${reconcile}</li>`;
    }).join('') || '<li>No payment requests yet.</li>';
    const accessState = String(data.subscription?.status || 'trial');
    const trialEndLabel = accessState === 'trial' && data.subscription?.trialEndsAt ? ` UNTIL ${escapeWorkspaceText(new Date(data.subscription.trialEndsAt).toLocaleDateString('en-ZA'))}` : '';
    const access = data.subscription?.active ? `ACTIVE${data.subscription.activeUntil ? ` UNTIL ${escapeWorkspaceText(data.subscription.activeUntil)}` : ''}` : `${escapeWorkspaceText(accessState.replaceAll('_', ' ').toUpperCase())}${trialEndLabel}`;
    container.innerHTML = `<div class="card-header-bar"><h3>${isAdmin ? 'Subscription pricing & operating overview' : 'Your school subscription'}</h3><span class="badge-tag ${data.subscription?.active ? 'info' : ''}">${access}</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0;"><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Base school subscription</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${formatSubscriptionMoney(data.pricing.baseMonthly)} / month</strong></div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Late-payment term</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${data.pricing.lateFeeEnabled ? formatSubscriptionMoney(data.pricing.lateFee) : 'Not enabled'}</strong></div><div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Awaiting requests</span><strong style="display:block;margin-top:3px;font-size:1.1rem;">${formatSubscriptionMoney(requestedMonthly)}</strong></div>${isAdmin ? `<div style="padding:12px;border:1px solid var(--border-color);border-radius:8px;background:var(--input-bg);"><span class="meta">Potential add-on margin</span><strong style="display:block;margin-top:3px;font-size:1.1rem;color:#2dd4bf;">${formatSubscriptionMoney(potentialMargin)}</strong></div>` : ''}</div><div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;"><table style="width:100%;min-width:460px;border-collapse:collapse;text-align:left;"><thead><tr><th style="padding:9px 10px;">Learner add-on</th>${isAdmin ? '<th style="padding:9px 10px;">Your cost</th>' : ''}<th style="padding:9px 10px;">School price</th>${isAdmin ? '<th style="padding:9px 10px;">Your profit</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div><div style="margin-top:14px;"><h4 style="margin:0 0 7px;">Recent payment requests</h4><ul style="margin:0;padding-left:19px;display:grid;gap:5px;font-size:.84rem;">${orders}</ul></div><button type="button" class="action-btn btn-blue" style="margin-top:14px;" onclick="${isAdmin ? 'openSubscriptionBillingAdmin()' : 'openSubscriptionCheckout()'}">${isAdmin ? 'Edit prices & payment destination' : 'Choose plan & create payment request'}</button>`;
  } catch (error) {
    container.innerHTML = `<p style="margin:0;color:#fca5a5;">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load subscription information.'))}</p><button type="button" class="action-btn btn-blue" style="margin-top:10px;" onclick="loadSubscriptionBillingOverview()">Try again</button>`;
  }
}

async function openSubscriptionBillingAdmin() {
  if (!isFinanceUser()) return alert('Only an administrator or Accounts user can manage subscription pricing and payment details.');
  let data;
  try {
    const response = await fetch('/api/subscription-billing');
    data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription billing.');
  } catch (error) { return alert(safeUserFacingError(error, 'Unable to load subscription billing.')); }
  const bundle = (capacity, field) => data.pricing.bundles.find(item => item.capacity === capacity)?.[field] || 0;
  const payment = data.payment || {};
  const orders = (data.orders || []).slice(0, 8).map(order => {
    const reconcile = !['paid', 'refunded'].includes(String(order.paymentStatus || order.status || '').toLowerCase())
      ? `<button type="button" class="action-btn btn-green" style="margin-left:8px;" onclick="openSubscriptionPaymentReconcile('${encodeInlineIdentifier(order.reference)}',${Number(order.monthlyTotal || 0)})">Record payment</button>`
      : '';
    return `<li><strong>${escapeWorkspaceText(order.reference)}</strong> · ${escapeWorkspaceText(order.schoolName)} · ${formatSubscriptionMoney(order.monthlyTotal)}/month · ${escapeWorkspaceText(String(order.paymentStatus || order.status || '').replaceAll('_', ' '))}${reconcile}</li>`;
  }).join('') || '<li>No subscription payment requests yet.</li>';
  openModal('Subscription pricing & payment account', `
    <form id="subscriptionBillingForm" onsubmit="saveSubscriptionBillingConfig(event)" style="display:grid;gap:14px;">
      <p style="margin:0;color:var(--text-muted);">Set what schools pay and your underlying cost. The portal calculates the margin on each learner add-on privately for administrators.</p>
      <div class="workspace-grid"><label>Base monthly school price<input name="baseMonthly" type="number" min="0" step="0.01" value="${data.pricing.baseMonthly}"></label><label>Late-payment fee<input name="lateFee" type="number" min="0" step="0.01" value="${data.pricing.lateFee}"></label></div>
      <label style="display:flex;align-items:center;gap:8px;"><input name="lateFeeEnabled" type="checkbox" ${data.pricing.lateFeeEnabled ? 'checked' : ''}> Apply the late-payment fee only when the school accepts this term.</label>
      <div style="overflow-x:auto;border:1px solid var(--border-color);border-radius:8px;"><table style="width:100%;min-width:540px;border-collapse:collapse;text-align:left;"><thead><tr><th style="padding:9px;">Extra learners</th><th style="padding:9px;">Your cost</th><th style="padding:9px;">School price</th><th style="padding:9px;">Your margin</th></tr></thead><tbody>${[5,20,100].map(capacity => `<tr><td style="padding:9px;"><strong>+${capacity} children</strong></td><td style="padding:9px;"><input name="cost${capacity}" type="number" min="0" step="0.01" value="${bundle(capacity,'costPrice')}"></td><td style="padding:9px;"><input name="price${capacity}" type="number" min="0" step="0.01" value="${bundle(capacity,'sellingPrice')}"></td><td style="padding:9px;color:#2dd4bf;">Calculated after saving</td></tr>`).join('')}</tbody></table></div>
      <fieldset style="border:1px solid var(--border-color);border-radius:8px;padding:12px;"><legend style="padding:0 5px;font-weight:700;">Where schools pay</legend><label>Payment method<select name="paymentMethod" onchange="toggleSubscriptionPaymentFields(this.value)">${data.payfastAvailable ? `<option value="payfast" ${payment.method === 'payfast' ? 'selected' : ''}>PayFast · automatic confirmation</option>` : ''}<option value="payment_link" ${payment.method === 'payment_link' ? 'selected' : ''}>Secure payment link</option><option value="bank_transfer" ${payment.method === 'bank_transfer' ? 'selected' : ''}>Bank transfer</option></select></label>${data.payfastAvailable ? '<p class="meta" style="margin:8px 0 0;">PayFast uses the live server credentials and verified ITN notifications. Merchant secrets never enter the browser.</p>' : '<p class="meta" style="margin:8px 0 0;">PayFast automatic confirmation becomes available after the live merchant credentials are configured on the server.</p>'}<div id="subscriptionPaymentLinkFields" style="margin-top:10px;"><label>HTTPS payment link<input name="paymentLink" type="url" placeholder="https://..." value="${escapeWorkspaceText(payment.paymentLink || '')}"></label></div><div id="subscriptionBankFields" style="display:none;margin-top:10px;" class="workspace-grid"><label>Account name<input name="accountName" value="${escapeWorkspaceText(payment.accountName || '')}"></label><label>Bank name<input name="bankName" value="${escapeWorkspaceText(payment.bankName || '')}"></label><label>Account number<input name="accountNumber" inputmode="numeric" value="${escapeWorkspaceText(payment.accountNumber || '')}"></label><label>Branch code<input name="branchCode" inputmode="numeric" value="${escapeWorkspaceText(payment.branchCode || '')}"></label></div><label style="margin-top:10px;display:block;">Capitec Pay Me QR text <span class="meta">(optional)</span><input name="capitecPayMePayload" maxlength="512" placeholder="${payment.capitecPayMeConfigured ? 'Pay Me code is saved — leave blank to keep it' : 'Paste the decoded Capitec Pay Me QR text'}"></label><label style="margin-top:10px;display:block;">Payment reference prefix<input name="referencePrefix" maxlength="16" value="${escapeWorkspaceText(payment.referencePrefix || 'LF')}"></label></fieldset>
      <button class="submit-btn">Save subscription billing</button>
    </form>
    <section style="margin-top:18px;border-top:1px solid var(--border-color);padding-top:12px;"><h3 style="margin:0 0 8px;">Recent payment requests</h3><ul style="margin:0;padding-left:20px;display:grid;gap:5px;font-size:.84rem;">${orders}</ul></section>`);
  toggleSubscriptionPaymentFields(payment.method || 'payment_link');
}

function toggleSubscriptionPaymentFields(method) {
  const link = document.getElementById('subscriptionPaymentLinkFields');
  const bank = document.getElementById('subscriptionBankFields');
  if (link) link.style.display = method === 'payment_link' ? 'block' : 'none';
  if (bank) bank.style.display = method === 'bank_transfer' ? 'grid' : 'none';
}

async function saveSubscriptionBillingConfig(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const value = name => form.elements[name]?.value || '';
  const payload = { baseMonthly: value('baseMonthly'), lateFee: value('lateFee'), lateFeeEnabled: form.elements.lateFeeEnabled.checked, bundles: {}, payment: { method: value('paymentMethod'), paymentLink: value('paymentLink'), accountName: value('accountName'), bankName: value('bankName'), accountNumber: value('accountNumber'), branchCode: value('branchCode'), referencePrefix: value('referencePrefix') } };
  if (value('capitecPayMePayload').trim()) payload.payment.capitecPayMePayload = value('capitecPayMePayload').trim();
  [5,20,100].forEach(capacity => { payload.bundles[capacity] = { costPrice: value(`cost${capacity}`), sellingPrice: value(`price${capacity}`) }; });
  try {
    const response = await fetch('/api/subscription-billing', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to save subscription billing.');
    alert('Subscription pricing and payment details saved.');
    loadSubscriptionBillingOverview();
    openSubscriptionBillingAdmin();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to save subscription billing.')); }
}

async function openSubscriptionCheckout() {
  if (!(isFullAccessUser() || currentUser?.role === 'principal')) return alert('Only a principal or administrator can create a subscription payment request.');
  let data;
  try {
    const response = await fetch('/api/subscription-billing');
    data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription pricing.');
  } catch (error) { return alert(safeUserFacingError(error, 'Unable to load subscription pricing.')); }
  if (!data.paymentConfigured) return alert('An administrator still needs to configure the payment destination.');
  const plans = Array.isArray(data.plans) ? data.plans : [];
  if (!plans.length) return alert('The published school plans are temporarily unavailable.');
  const options = plans.map(plan => {
    const overage = Number(plan.overagePerLearner || 0) > 0 ? ` · +${formatSubscriptionMoney(plan.overagePerLearner)} per learner above ${Number(plan.maxLearners).toLocaleString('en-ZA')}` : '';
    const hardMax = Number(plan.hardMaxLearners || plan.maxLearners);
    return `<option value="${escapeWorkspaceText(plan.code)}">${escapeWorkspaceText(plan.name)} — ${Number(plan.maxLearners).toLocaleString('en-ZA')} included · max ${hardMax.toLocaleString('en-ZA')} — ${formatSubscriptionMoney(plan.monthlyPrice)}/month${overage}</option>`;
  }).join('');
  openModal('Choose subscription & pay', `<form onsubmit="createSubscriptionOrder(event)" style="display:grid;gap:14px;"><p style="margin:0;color:var(--text-muted);">Choose the published plan that matches your school size. Little Feet will create a unique Capitec payment reference.</p><label>School plan<select name="planCode">${options}</select></label>${data.pricing.lateFeeEnabled ? `<label style="display:flex;align-items:flex-start;gap:8px;"><input type="checkbox" name="lateFeeAccepted"> I accept the late-payment fee of ${formatSubscriptionMoney(data.pricing.lateFee)} if this invoice becomes overdue.</label>` : ''}<button class="submit-btn">Create payment request</button></form>`);
}

async function createSubscriptionOrder(event) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/subscription-billing/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ planCode: form.elements.planCode?.value || '', bundleCapacity: form.elements.bundleCapacity?.value || 0, lateFeeAccepted: Boolean(form.elements.lateFeeAccepted?.checked) }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create payment request.');
    const payment = result.payment;
    const destination = paymentDestinationMarkup(payment);
    const overageLine = Number(result.order.overageLearners || 0) > 0 ? `<br><span style="color:var(--text-muted);">${Number(result.order.learnerCount).toLocaleString('en-ZA')} learners · ${Number(result.order.overageLearners).toLocaleString('en-ZA')} over included capacity × ${formatSubscriptionMoney(result.order.overageRate)}</span>` : '';
    openModal('Payment request ready', `<p style="margin:0 0 10px;">Your payment request is awaiting payment.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>Monthly total: ${formatSubscriptionMoney(result.order.monthlyTotal)}</strong>${overageLine}<br>Payment reference: <strong>${escapeWorkspaceText(result.order.reference)}</strong>${result.order.lateFee ? `<br><span style="color:var(--text-muted);">Late-payment fee if overdue: ${formatSubscriptionMoney(result.order.lateFee)}</span>` : ''}</div>${destination}<p style="margin:12px 0 0;color:var(--text-muted);font-size:.82rem;">Use the reference exactly as shown so the payment can be matched to your school.</p>`);
    renderCapitecPayMeQr(payment);
  } catch (error) { alert(safeUserFacingError(error, 'Unable to create payment request.')); }
}

function openSubscriptionPaymentReconcile(encodedReference, expectedAmount) {
  if (!isFinanceUser()) return alert('Only an administrator or Accounts user can reconcile a subscription payment.');
  const reference = decodeURIComponent(encodedReference);
  openModal('Record subscription payment', `<form onsubmit="reconcileSubscriptionPayment(event,'${encodeInlineIdentifier(reference)}')" style="display:grid;gap:12px;"><p style="margin:0;">Payment reference: <strong>${escapeWorkspaceText(reference)}</strong></p><p class="meta" style="margin:0;">Confirm the bank or provider transaction only after the funds have cleared. The school subscription activates immediately after this record is accepted.</p><label>Amount received (R)<input name="amount" type="number" min="0.01" step="0.01" value="${Number(expectedAmount || 0).toFixed(2)}" required></label><label>Bank/provider reference<input name="bankReference" maxlength="160" required></label><button class="submit-btn">Confirm cleared payment</button></form>`);
}

async function reconcileSubscriptionPayment(event, encodedReference) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/payments/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: `subscription-${Date.now()}-${Math.random().toString(16).slice(2)}`, reference: decodeURIComponent(encodedReference), status: 'paid', amount: form.elements.amount.value, bankReference: form.elements.bankReference.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record the subscription payment.');
    closeModal();
    await loadSubscriptionBillingOverview();
    alert('Payment recorded. The school subscription is active.');
  } catch (error) { alert(safeUserFacingError(error, 'Unable to record the subscription payment.')); }
}

async function loadParentSubscription() {
  const panel = document.getElementById('parentSubscriptionPanel');
  if (!panel || currentUser?.role !== 'parent') return;
  try {
    const response = await fetch('/api/parent-subscription');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load subscription access.');
    if (data.active) await refreshCurrentUserAccess();
    const status = data.active ? '<span class="badge-tag info">ACTIVE</span>' : '<span class="badge-tag urgent">BASIC ACCESS</span>';
    const latest = data.latest
      ? `<p class="meta">Latest request: <strong>${escapeWorkspaceText(data.latest.reference)}</strong> · ${escapeWorkspaceText(String(data.latest.status || '').replaceAll('_', ' '))}</p>`
      : '<p class="meta">No subscription payment request has been created yet.</p>';
    panel.innerHTML = `<div class="card-header-bar"><h2>LittleSteps Plus</h2>${status}</div><p>Unlock Progress Insights for your linked learners. The plan is R${Number(data.pricePerChild || 29).toFixed(0)} per child for 30 days and activates automatically when payment is confirmed.</p>${latest}<button type="button" class="action-btn btn-green" onclick="openParentSubscriptionCheckout()" ${data.paymentConfigured ? '' : 'disabled'}>${data.active ? 'Renew Plus access' : 'Get Plus access'}</button>${data.paymentConfigured ? '' : '<p class="meta">The payment destination has not been configured yet.</p>'}`;
  } catch (error) {
    panel.innerHTML = `<div class="card-header-bar"><h2>LittleSteps Plus</h2><span class="badge-tag urgent">UNAVAILABLE</span></div><p class="meta">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load subscription access.'))}</p><button type="button" class="action-btn btn-blue" onclick="loadParentSubscription()">Try again</button>`;
  }
}

async function openParentSubscriptionCheckout() {
  if (currentUser?.role !== 'parent') return alert('Parent subscription access is available to parent accounts.');
  try {
    const response = await fetch('/api/parent-subscription/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create the subscription payment request.');
    const destination = paymentDestinationMarkup(result.payment);
    openModal('Activate LittleSteps Plus', `<p style="margin:0 0 10px;">Your access activates automatically after the payment is confirmed.</p><div style="padding:12px;border-left:4px solid #2dd4bf;background:rgba(45,212,191,.1);margin-bottom:12px;"><strong>Total: ${formatSubscriptionMoney(result.order.amount)}</strong><br>Payment reference: <strong>${escapeWorkspaceText(result.order.reference)}</strong><br><span class="meta">30 days of Plus access</span></div>${destination}<p class="meta">Use this exact reference so the payment can be matched to your account.</p>`);
    renderCapitecPayMeQr(result.payment);
    await loadParentSubscription();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to create the subscription payment request.')); }
}

function parentPaymentStatusLabel(payment) {
  if (payment.status === 'paid') return '<span class="badge-tag info">PAID</span>';
  if (payment.status === 'in_arrears') return '<span class="badge-tag urgent">IN ARREARS</span>';
  if (payment.status === 'partially_paid') return '<span class="badge-tag urgent">PARTLY PAID</span>';
  return '<span class="badge-tag">AWAITING PAYMENT</span>';
}

async function loadParentPayments() {
  const summaryBox = document.getElementById('parentPaymentsSummary');
  const list = document.getElementById('parentPaymentsList');
  if (!summaryBox || !list || !currentUser || !(isFinanceUser() || ['parent', 'principal'].includes(currentUser.role))) return;
  try {
    const response = await fetch('/api/parent-payments');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || 'Unable to load parent payments.');
    parentPaymentData = data;
    const summary = data.summary || {};
    const ageing = data.ageing || {};
    const ageingMarkup = (isFinanceUser() || currentUser.role === 'principal')
      ? `<div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border-color);"><span class="meta" style="display:block;margin-bottom:7px;">Debtor ageing · open balance by days overdue</span><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;"><div><span class="meta">Current</span><strong style="display:block;">${formatSubscriptionMoney(ageing.current)}</strong></div><div><span class="meta">1–30 days</span><strong style="display:block;">${formatSubscriptionMoney(ageing.days1to30)}</strong></div><div><span class="meta">31–60 days</span><strong style="display:block;">${formatSubscriptionMoney(ageing.days31to60)}</strong></div><div><span class="meta">61–90 days</span><strong style="display:block;">${formatSubscriptionMoney(ageing.days61to90)}</strong></div><div><span class="meta">90+ days</span><strong style="display:block;color:${Number(ageing.days90plus || 0) > 0 ? '#fca5a5' : 'inherit'};">${formatSubscriptionMoney(ageing.days90plus)}</strong></div></div></div>`
      : '';
    summaryBox.innerHTML = `<div class="card-header-bar"><h3>${currentUser.role === 'parent' ? 'Your live account balance' : 'School parent-payment overview'}</h3><span class="badge-tag ${Number(summary.arrears || 0) > 0 ? 'urgent' : 'info'}">${Number(summary.arrears || 0) > 0 ? 'ACTION NEEDED' : 'UP TO DATE'}</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;"><div><span class="meta">Current arrears</span><strong style="display:block;font-size:1.15rem;color:${Number(summary.arrears || 0) > 0 ? '#fca5a5' : '#2dd4bf'};">${formatSubscriptionMoney(summary.arrears)}</strong></div><div><span class="meta">Open balance</span><strong style="display:block;font-size:1.15rem;">${formatSubscriptionMoney(summary.balance)}</strong></div><div><span class="meta">Invoices</span><strong style="display:block;font-size:1.15rem;">${Number(summary.count || 0)}</strong></div><div><span class="meta">Recalculated</span><strong style="display:block;font-size:.86rem;">${data.recalculatedAt ? new Date(data.recalculatedAt).toLocaleString() : 'now'}</strong></div></div>${ageingMarkup}`;
    const admin = isFinanceUser() || currentUser.role === 'principal';
    list.innerHTML = data.payments?.length ? data.payments.map(payment => {
      const arrangement = payment.arrangementActive ? `<p style="margin:4px 0;color:#99f6e4;">Approved arrangement: ${formatSubscriptionMoney(payment.arrangementAmount)} due ${escapeWorkspaceText(payment.effectiveDueDate)}${payment.arrangementNote ? ` · ${escapeWorkspaceText(payment.arrangementNote)}` : ''}</p>` : '';
      const destination = payment.payment?.paymentLink ? `<a class="action-btn btn-green" style="display:inline-block;text-decoration:none;" target="_blank" rel="noopener" href="${escapeWorkspaceText(payment.payment.paymentLink)}">Pay securely</a>` : payment.payment?.accountNumber ? `<span class="meta">Pay by bank transfer to ${escapeWorkspaceText(payment.payment.bankName)} · ${escapeWorkspaceText(payment.payment.accountNumber)} · Ref ${escapeWorkspaceText(payment.reference)}</span>` : '<span class="meta">Payment destination not configured.</span>';
      const actions = admin && payment.balance > 0 ? `<button type="button" class="action-btn btn-blue" onclick="openParentPaymentReconcile('${encodeInlineIdentifier(payment.id)}')">Record payment</button>` : '';
      return `<div class="item-row"><div><strong>${escapeWorkspaceText(payment.parentName || '')}${payment.learnerName ? ` · ${escapeWorkspaceText(payment.learnerName)}` : ''}</strong> ${parentPaymentStatusLabel(payment)}<p style="margin:4px 0;">${escapeWorkspaceText(payment.description)} · Due ${escapeWorkspaceText(payment.effectiveDueDate)} · Ref <strong>${escapeWorkspaceText(payment.reference)}</strong></p>${arrangement}<p class="meta">Due ${formatSubscriptionMoney(payment.amountDue)}${Number(payment.creditTotal || 0) > 0 ? ` · Credits ${formatSubscriptionMoney(payment.creditTotal)}` : ''} · Paid ${formatSubscriptionMoney(payment.paidAmount)} · Balance ${formatSubscriptionMoney(payment.balance)}${payment.arrears > 0 ? ` · Arrears ${formatSubscriptionMoney(payment.arrears)}` : ''}</p></div><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">${destination}${actions}${currentUser.role === 'parent' && !payment.parentSignature ? `<button type="button" class="action-btn btn-blue" onclick="signParentPayment('${encodeInlineIdentifier(payment.id)}')">Confirm account</button>` : ''}</div></div>`;
    }).join('') : '<p class="meta">No parent payment requests have been created.</p>';
  } catch (error) {
    summaryBox.innerHTML = `<p style="margin:0;color:#fca5a5;">${escapeWorkspaceText(safeUserFacingError(error, 'Unable to load parent payments.'))}</p>`;
    list.innerHTML = '';
  }
}

async function openParentPaymentAdmin() {
  if (!(isFinanceUser() || currentUser?.role === 'principal')) return alert('Only a principal, administrator, or Accounts user can create parent payment requests.');
  let parents;
  try {
    const response = await fetch('/api/parent-payments/parents');
    parents = await response.json();
    if (!response.ok) throw new Error(parents.message || 'Unable to load parent accounts.');
  } catch (error) { return alert(safeUserFacingError(error, 'Unable to load parent accounts.')); }
  if (!parents.length) return alert('Create or approve a parent account first.');
  const options = parents.map(parent => `<option value="${escapeWorkspaceText(parent.username)}">${escapeWorkspaceText(parent.name)} · ${escapeWorkspaceText(parent.username)}</option>`).join('');
  const today = new Date().toISOString().slice(0, 10);
  openModal('Create parent school payment', `<form onsubmit="createParentPayment(event)" style="display:grid;gap:12px;"><p class="meta" style="margin:0;">Record the original amount and due date. If the school approves a later date or a different amount, add it below; arrears will use the approved arrangement automatically.</p><label>Parent account<select name="parentUsername" required>${options}</select></label><div class="workspace-grid"><label>Learner (optional)<input name="learnerName" maxlength="160" placeholder="e.g. Sam Smith"></label><label>Amount due (R)<input name="amountDue" type="number" min="0.01" step="0.01" required></label></div><label>Description<input name="description" maxlength="240" required placeholder="e.g. September school fees"></label><div class="workspace-grid"><label>Original due date<input name="dueDate" type="date" value="${today}" required></label><label>Approved later date (optional)<input name="arrangementDueDate" type="date"></label></div><div class="workspace-grid"><label>Approved arrangement amount (optional)<input name="arrangementAmount" type="number" min="0.01" step="0.01" placeholder="Leave blank to keep original"></label><label>Agreement note (optional)<input name="arrangementNote" maxlength="500" placeholder="e.g. Principal approved payment on 30 Sep"></label></div><button class="submit-btn">Save parent payment</button></form>`);
}

async function createParentPayment(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  try {
    const response = await fetch('/api/parent-payments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to create parent payment.');
    closeModal();
    await loadParentPayments();
    alert(`Parent payment created. Reference: ${result.payment.reference}`);
  } catch (error) { alert(safeUserFacingError(error, 'Unable to create parent payment.')); }
}

function openParentPaymentReconcile(encodedId) {
  const payment = parentPaymentData?.payments?.find(item => item.id === decodeURIComponent(encodedId));
  if (!payment) return;
  openModal('Record parent payment', `<form onsubmit="reconcileParentPayment(event,'${encodeInlineIdentifier(payment.reference)}')" style="display:grid;gap:12px;"><p style="margin:0;">${escapeWorkspaceText(payment.parentName)} · ${escapeWorkspaceText(payment.description)}</p><p class="meta" style="margin:0;">Remaining balance: ${formatSubscriptionMoney(payment.balance)}. Part-payments are accepted and the arrears label will recalculate immediately.</p><label>Amount received (R)<input name="amount" type="number" min="0.01" max="${payment.balance}" step="0.01" required></label><label>Bank/provider reference<input name="bankReference" maxlength="160"></label><button class="submit-btn">Record payment</button></form>`);
}

async function reconcileParentPayment(event, encodedReference) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/payments/reconcile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ eventId: `parent-${Date.now()}-${Math.random().toString(16).slice(2)}`, reference: decodeURIComponent(encodedReference), status: 'paid', amount: form.elements.amount.value, bankReference: form.elements.bankReference.value }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record payment.');
    closeModal();
    await loadParentPayments();
  } catch (error) { alert(safeUserFacingError(error, 'Unable to record payment.')); }
}

function openParentPaymentReport() {
  if (!parentPaymentData) return loadParentPayments();
  const summary = parentPaymentData.summary || {};
  const ageing = parentPaymentData.ageing || {};
  const rows = (parentPaymentData.payments || []).map(payment => `<tr><td style="padding:8px;">${escapeWorkspaceText(payment.parentName || '')}${payment.learnerName ? `<br><span class="meta">${escapeWorkspaceText(payment.learnerName)}</span>` : ''}</td><td style="padding:8px;">${escapeWorkspaceText(payment.description)}</td><td style="padding:8px;">${escapeWorkspaceText(payment.effectiveDueDate)}${payment.daysPastDue ? `<br><span style="color:#fca5a5;">${Number(payment.daysPastDue)} days overdue</span>` : '<br><span class="meta">Current</span>'}${payment.arrangementActive ? `<br><span class="meta">${escapeWorkspaceText(payment.arrangementNote || 'Approved arrangement')}</span>` : ''}</td><td style="padding:8px;">${formatSubscriptionMoney(payment.amountDue)}${Number(payment.creditTotal || 0) > 0 ? `<br><span class="meta">Credits ${formatSubscriptionMoney(payment.creditTotal)}</span>` : ''}</td><td style="padding:8px;">${formatSubscriptionMoney(payment.paidAmount)}${payment.paymentHistory?.length ? `<br><span class="meta">${payment.paymentHistory.map(item => `${formatSubscriptionMoney(item.amount)} ${escapeWorkspaceText(item.status)} · ${new Date(item.receivedAt).toLocaleDateString()}`).join('<br>')}</span>` : ''}</td><td style="padding:8px;">${formatSubscriptionMoney(payment.balance)}${payment.arrears ? `<br><span style="color:#fca5a5;">Arrears ${formatSubscriptionMoney(payment.arrears)}</span>` : ''}</td></tr>`).join('');
  const ageingSummary = (isFullAccessUser() || currentUser?.role === 'principal')
    ? `<div class="workspace-card" style="margin-top:10px;"><strong>Debtor ageing</strong><p class="meta" style="margin:6px 0 0;">Current ${formatSubscriptionMoney(ageing.current)} · 1–30 ${formatSubscriptionMoney(ageing.days1to30)} · 31–60 ${formatSubscriptionMoney(ageing.days31to60)} · 61–90 ${formatSubscriptionMoney(ageing.days61to90)} · 90+ ${formatSubscriptionMoney(ageing.days90plus)}</p></div>`
    : '';
  openModal('Full parent payment report', `<p class="meta">Generated ${parentPaymentData.recalculatedAt ? new Date(parentPaymentData.recalculatedAt).toLocaleString() : 'now'}. Paid history, approved arrangements and live ageing are calculated from the current ledger.</p><div class="workspace-card" style="display:flex;gap:18px;flex-wrap:wrap;"><strong>Due: ${formatSubscriptionMoney(summary.amountDue)}</strong><strong>Paid: ${formatSubscriptionMoney(summary.paidAmount)}</strong><strong>Open: ${formatSubscriptionMoney(summary.balance)}</strong><strong>Arrears: ${formatSubscriptionMoney(summary.arrears)}</strong></div>${ageingSummary}<div style="overflow:auto;margin-top:12px;"><table style="width:100%;min-width:760px;border-collapse:collapse;text-align:left;"><thead><tr><th style="padding:8px;">Account</th><th style="padding:8px;">Description</th><th style="padding:8px;">Due / ageing</th><th style="padding:8px;">Due</th><th style="padding:8px;">Paid / history</th><th style="padding:8px;">Balance</th></tr></thead><tbody>${rows || '<tr><td colspan="6" style="padding:12px;">No payment records.</td></tr>'}</tbody></table></div>`);
}

function exportParentPaymentReport() {
  if (typeof XLSX === 'undefined') return alert('The spreadsheet tool is still loading.');
  const rows = (parentPaymentData?.payments || []).map(payment => ({ Parent: payment.parentName, 'Parent Username': payment.parentUsername, Learner: payment.learnerName, Description: payment.description, 'Original Due Date': payment.dueDate, 'Effective Due Date': payment.effectiveDueDate, 'Days Past Due': payment.daysPastDue || 0, 'Approved Arrangement Amount': payment.arrangementAmount || '', 'Approved Arrangement Note': payment.arrangementNote || '', 'Amount Due': payment.amountDue, 'Credit Total': payment.creditTotal || 0, 'Paid Amount': payment.paidAmount, 'Payment History': (payment.paymentHistory || []).map(item => `${item.amount} ${item.status} ${item.receivedAt}`).join(' | '), Balance: payment.balance, Arrears: payment.arrears, Status: payment.status, Reference: payment.reference }));
  const ageing = parentPaymentData?.ageing || {};
  const ageingRows = [
    { 'Ageing Bucket': 'Current', Amount: ageing.current || 0 },
    { 'Ageing Bucket': '1–30 days', Amount: ageing.days1to30 || 0 },
    { 'Ageing Bucket': '31–60 days', Amount: ageing.days31to60 || 0 },
    { 'Ageing Bucket': '61–90 days', Amount: ageing.days61to90 || 0 },
    { 'Ageing Bucket': '90+ days', Amount: ageing.days90plus || 0 },
    { 'Ageing Bucket': 'Total open', Amount: ageing.totalOpen || 0 }
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), 'Payment report');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(ageingRows), 'Debtor ageing');
  XLSX.writeFile(workbook, `LittleFeet_Parent_Payment_Report_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function signParentPayment(encodedId) {
  const payment = parentPaymentData?.payments?.find(item => item.id === decodeURIComponent(encodedId));
  if (!payment) return;
  openModal('Confirm parent payment account', `<form onsubmit="submitParentPaymentSignature(event,'${encodeInlineIdentifier(payment.id)}')" style="display:grid;gap:12px;"><p class="meta">Type your name to confirm that you have received and reviewed this payment request.</p><label>Your signature<input name="signature" required maxlength="160" autocomplete="name" value="${escapeWorkspaceText(currentUser.name || '')}"></label><button class="submit-btn">Confirm</button></form>`);
}

async function submitParentPaymentSignature(event, encodedId) {
  event.preventDefault();
  const signature = event.currentTarget.elements.signature.value;
  try { const response = await fetch(`/api/parent-payments/${encodeURIComponent(decodeURIComponent(encodedId))}/acknowledge`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ signature }) }); const result = await response.json(); if (!response.ok) throw new Error(result.message || 'Unable to save confirmation.'); closeModal(); await loadParentPayments(); } catch (error) { alert(safeUserFacingError(error, 'Unable to save confirmation.')); }
}

function recordStorePayment(orderId, reference, amount) {
  if (!isFinanceUser()) return alert('Only an administrator or Accounts user can record a cleared store payment.');
  openModal('Record cleared store payment', `<form onsubmit="submitStorePayment(event,'${encodeInlineIdentifier(orderId)}','${encodeInlineIdentifier(reference)}',${Number(amount || 0)})" style="display:grid;gap:12px;"><p style="margin:0;">Reference: <strong>${escapeWorkspaceText(reference)}</strong></p><p class="meta" style="margin:0;">Use this only after the money has actually cleared.</p><label>Amount received (R)<input name="amount" type="number" min="0.01" step="0.01" value="${Number(amount || 0).toFixed(2)}" required></label><label>Bank/provider reference<input name="bankReference" maxlength="160" required></label><button class="submit-btn">Confirm cleared payment</button></form>`);
}

async function submitStorePayment(event, encodedOrderId, encodedReference, expectedAmount) {
  event.preventDefault();
  const form = event.currentTarget;
  try {
    const response = await fetch('/api/payments/reconcile', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({
      eventId: `store-paid-${decodeURIComponent(encodedOrderId)}-${Date.now()}`,
      reference: decodeURIComponent(encodedReference), status:'paid', amount: form.elements.amount.value,
      bankReference: form.elements.bankReference.value
    }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Unable to record the store payment.');
    closeModal();
    await loadStoreItems();
    alert('Payment confirmed. The order is ready for the stock room.');
  } catch (error) { alert(safeUserFacingError(error, 'Unable to record the store payment.')); }
}
