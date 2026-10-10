// Domain helpers retain the original live application dependencies.
function createHelpers(context) {
const logStructured = (severity, event, fields = {}) => context.structuredLogger.emit(severity, event, fields);

const cleanReleaseVersion = value => /^\d+\.\d+(?:\.\d+)?$/.test(String(value || '').trim()) ? String(value).trim() : '1.0';

const readBuiltRenderDeployReleaseNote = () => {
  if (!context.renderDeployAvailable) return null;
  try {
    const built = JSON.parse(context.fs.readFileSync(context.RENDER_DEPLOY_METADATA_FILE, 'utf8'));
    const fullCommitSha = String(built?.fullCommitSha || '').trim().toLowerCase();
    if (fullCommitSha !== context.RENDER_DEPLOY_SHA) return null;
    const updateLineCount = Math.max(1, Number(built?.updateLineCount) || 1);
    return {
      id: `render-${context.RENDER_DEPLOY_SHA}`,
      version: context.cleanReleaseVersion(built?.version),
      title: context.boundedText(built?.title || `Deploy ${context.RENDER_DEPLOY_SHA.slice(0, 7)}`, 240),
      summary: context.boundedText(built?.summary || 'The latest Little Feet improvements are now live.', 600),
      publishedAt: Number.isNaN(Date.parse(built?.publishedAt || '')) ? new Date().toISOString() : built.publishedAt,
      source: 'Render',
      commitSha: context.RENDER_DEPLOY_SHA.slice(0, 7),
      updateLineCount,
      changeLines: null,
      releaseType: context.boundedText(built?.releaseType || 'update', 40)
    };
  } catch {
    return null;
  }
};

const renderDeployFallbackNote = () => context.renderDeployAvailable ? {
  id: `render-${context.RENDER_DEPLOY_SHA}`,
  version: '1.0',
  title: 'Production foundation',
  summary: 'The latest Little Feet improvements are now live.',
  publishedAt: new Date().toISOString(),
  source: 'Render',
  commitSha: context.RENDER_DEPLOY_SHA.slice(0, 7),
  updateLineCount: null,
  changeLines: null,
  releaseType: 'live'
} : null;

const resolveRenderDeployReleaseNote = async () => {
  if (!context.renderDeployAvailable) return null;
  if (context.renderDeployReleaseNote) return context.renderDeployReleaseNote;
  const builtReleaseNote = context.readBuiltRenderDeployReleaseNote();
  if (builtReleaseNote) {
    context.renderDeployReleaseNote = builtReleaseNote;
    return context.renderDeployReleaseNote;
  }
  if (!context.renderRepoSlugAvailable) return context.renderDeployFallbackNote();
  if (context.renderDeployReleasePromise) return context.renderDeployReleasePromise;
  context.renderDeployReleasePromise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(`https://api.github.com/repos/${context.RENDER_REPO_SLUG}/commits/${context.RENDER_DEPLOY_SHA}`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LittleFeetReleaseFeed/1.0' },
        signal: controller.signal
      });
      if (!response.ok) throw new Error(`GitHub commit lookup returned ${response.status}`);
      const commit = await response.json();
      const messageLines = String(commit?.commit?.message || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const title = String(messageLines[0] || `Deploy ${context.RENDER_DEPLOY_SHA.slice(0, 7)}`).slice(0, 240);
      const updateLineCount = Math.max(1, messageLines.length);
      const changeLines = Math.max(0, Number(commit?.stats?.total) || 0);
      const releaseType = updateLineCount <= 8 ? 'patch' : 'update';
      context.renderDeployReleaseNote = {
        id: `render-${context.RENDER_DEPLOY_SHA}`,
        version: '1.0',
        title,
        summary: messageLines.slice(1, 4).join(' · ') || 'The latest Little Feet improvements are now live.',
        publishedAt: commit?.commit?.committer?.date || commit?.commit?.author?.date || new Date().toISOString(),
        source: 'Render',
        commitSha: context.RENDER_DEPLOY_SHA.slice(0, 7),
        updateLineCount,
        changeLines,
        releaseType
      };
      return context.renderDeployReleaseNote;
    } catch (error) {
      context.logStructured('warn', 'deploy.metadata_lookup_failed', { category: 'deployment', message: error.message });
      return context.renderDeployFallbackNote();
    } finally {
      clearTimeout(timeout);
      context.renderDeployReleasePromise = null;
    }
  })();
  return context.renderDeployReleasePromise;
};

const normalizeComparableText = (value) => String(value || '').trim().toLocaleLowerCase('en-US');

const normaliseModerationText = (value) => String(value || '')
  .toLocaleLowerCase('en-US')
  .replace(/[@4]/g, 'a').replace(/[3]/g, 'e').replace(/[1!]/g, 'i')
  .replace(/[0]/g, 'o').replace(/[$5]/g, 's').replace(/[7]/g, 't');

const containsBlockedLanguage = (value) => {
  const normalised = context.normaliseModerationText(value);
  const compact = normalised.replace(/[^a-z]+/g, '');
  return context.blockedTerms.some(term => new RegExp(`(^|[^a-z])${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z])`, 'i').test(normalised)
    || (term.length >= 4 && compact.includes(term)));
};

const requestContainsBlockedLanguage = (value, fieldName = '') => {
  if (context.MODERATION_EXEMPT_FIELDS.has(String(fieldName || '').toLocaleLowerCase('en-US'))) return false;
  if (typeof value === 'string') return context.containsBlockedLanguage(value);
  if (Array.isArray(value)) return value.some(item => requestContainsBlockedLanguage(item, fieldName));
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => requestContainsBlockedLanguage(item, key));
};

const requestPayloadTooComplex = (root, { maxDepth = 64, maxNodes = 5000 } = {}) => {
  const stack = [{ value: root, depth: 0 }];
  let visited = 0;
  while (stack.length) {
    const { value, depth } = stack.pop();
    visited += 1;
    if (visited > maxNodes || depth > maxDepth) return true;
    if (!value || typeof value !== 'object') continue;
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: depth + 1 });
      continue;
    }
    for (const item of Object.values(value)) stack.push({ value: item, depth: depth + 1 });
  }
  return false;
};

const safeTextColor = (value) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value) : '#2dd4bf';

const boundedText = (value, max = 500) => String(value ?? '').trim().slice(0, max);

const limitedText = (value, max = 500) => {
  const text = String(value ?? '').trim();
  return text.length <= max ? text : null;
};

const educationStageForSelection = value => {
  const selection = context.boundedText(value, 80);
  if (/^ECD · Baby/i.test(selection) || /^ECD · Infant/i.test(selection)) return 'Day care / ECD · Baby / infant';
  if (/^ECD · 1-year/i.test(selection)) return 'Day care / ECD · 1-year-olds';
  if (/^ECD · 2-year/i.test(selection) || /^ECD · Toddler/i.test(selection)) return 'Day care / ECD · 2-year-olds / toddler';
  if (/^ECD · 3-year/i.test(selection)) return 'Day care / ECD · 3-year-olds';
  if (/^ECD · 4-year/i.test(selection) || /^ECD · Preschool/i.test(selection)) return 'Day care / ECD · 4-year-olds / preschool';
  if (/^ECD · 5-year/i.test(selection)) return 'Day care / ECD · 5-year-olds / transition';
  if (/^Grade R/i.test(selection)) return 'Foundation Phase · Grade R';
  const match = /^Grade (\d{1,2})$/.exec(selection);
  const grade = Number(match?.[1] || 0);
  if (grade >= 1 && grade <= 3) return 'Foundation Phase · Grades 1–3';
  if (grade >= 4 && grade <= 6) return 'Intermediate Phase · Grades 4–6';
  if (grade >= 7 && grade <= 9) return 'Senior Phase · Grades 7–9';
  if (grade >= 10 && grade <= 12) return 'FET Phase · Grades 10–12';
  return 'Other / school-defined';
};

const enforcePublicRateLimit = (req, res, key, limit, windowMs) => {
  const now = Date.now();
  const id = `${key}:${req.ip}`;
  let entry = context.publicRateLimits.get(id);
  if (!entry || now - entry.startedAt >= windowMs) entry = { count: 0, startedAt: now };
  entry.count += 1;
  context.publicRateLimits.set(id, entry);
  if (context.publicRateLimits.size > 10000) {
    for (const [candidate, value] of context.publicRateLimits) {
      if (now - value.startedAt >= windowMs) context.publicRateLimits.delete(candidate);
      if (context.publicRateLimits.size <= 8000) break;
    }
    // A distributed spray can leave every entry "active". Keep the limiter
    // itself bounded rather than letting hostile source churn exhaust memory.
    while (context.publicRateLimits.size > 10000) {
      context.publicRateLimits.delete(context.publicRateLimits.keys().next().value);
    }
  }
  if (entry.count <= limit) return true;
  res.setHeader('Retry-After', String(Math.max(1, Math.ceil((windowMs - (now - entry.startedAt)) / 1000))));
  res.status(429).json({ message: 'Too many requests. Please wait and try again.' });
  return false;
};

const encryptField = (value) => { const iv = context.crypto.randomBytes(12); const cipher = context.crypto.createCipheriv('aes-256-gcm', context.fieldKey, iv); const content = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]); return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${content.toString('base64')}`; };

const decryptField = (value) => { try { const [iv, tag, content] = String(value || '').split('.').map(part => Buffer.from(part, 'base64')); const decipher = context.crypto.createDecipheriv('aes-256-gcm', context.fieldKey, iv); decipher.setAuthTag(tag); return Buffer.concat([decipher.update(content), decipher.final()]).toString('utf8'); } catch { return ''; } };

const looksEncryptedField = (value) => {
  const parts = String(value || '').split('.');
  return parts.length === 3 && parts.every(part => /^[A-Za-z0-9+/=_-]*$/.test(part));
};

const decryptStoredField = (value) => context.looksEncryptedField(value) ? context.decryptField(value) : String(value || '');

const encryptStoredField = (value) => context.looksEncryptedField(value) ? String(value) : context.encryptField(value);

const decodeImageDataUrl = (value, allowedMimeTypes = Object.keys(context.MEDIA_SIGNATURES), maxBytes = context.MAX_MEDIA_BYTES) => {
  if (typeof value !== 'string') return null;
  const match = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match || !allowedMimeTypes.includes(match[1]) || match[2].length % 4 !== 0) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > maxBytes || !context.MEDIA_SIGNATURES[match[1]](bytes)) return null;
  return { mimeType: match[1], bytes };
};

const validPostMediaData = value => Boolean(context.decodeImageDataUrl(value, ['image/png', 'image/jpeg', 'image/webp']));

const validWorksheetMediaData = value => Boolean(context.decodeImageDataUrl(value));

const safeStoredMedia = (value, validator = context.validWorksheetMediaData) => value == null ? value : (validator(value) ? value : null);

const reportReviewView = (report) => ({
  ...report,
  teacherSignature: report.teacherSignature ? context.decryptStoredField(report.teacherSignature) : null,
  parentSignature: report.parentSignature ? context.decryptStoredField(report.parentSignature) : null
});

const safeHttpsUrl = value => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '';
  } catch {
    return '';
  }
};

const activeAttempt = (map, key) => {
  const entry = map.get(key);
  if (!entry || Date.now() >= context.loginAttemptExpiry(entry)) { map.delete(key); return null; }
  return entry;
};

const vendorSha256 = buffer => `sha256-${context.crypto.createHash('sha256').update(buffer).digest('base64')}`;

const duplicatePostIsHandledByRoute = requestPath =>
  context.DUPLICATE_POST_EXEMPT_PATHS.has(requestPath)
  || /^\/api\/finance\/payroll\/runs\/[^/]+\/approve$/.test(requestPath);

const persistenceHash = value => context.crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

const persistenceRecordKey = (record, index) => {
  const candidate = record?.id || record?.username || record?.reference || record?.learnerKey || record?.version;
  return candidate ? String(candidate) : `legacy-${context.persistenceHash(record)}-${index}`;
};

const flattenPersistentState = () => {
  const records = new Map();
  const metadata = new Map();
  const addRecords = (collection, values) => (Array.isArray(values) ? values : []).forEach((record, index) => {
    const recordKey = context.persistenceRecordKey(record, index);
    records.set(`${collection}\u0000${recordKey}`, { collection, recordKey, schoolId: String(record?.schoolId || ''), payload: record });
  });
  Object.entries(context.db).forEach(([key, value]) => {
    if (Array.isArray(value)) return addRecords(`array:${key}`, value);
    if (key === 'moduleRecords') return Object.entries(value || {}).forEach(([moduleName, values]) => addRecords(`module:${moduleName}`, values));
    if (key === 'groupMessages') return Object.entries(value || {}).forEach(([groupId, values]) => addRecords(`group:${groupId}`, values));
    if (key === 'schoolBilling') return Object.entries(value || {}).forEach(([schoolId, billing]) => metadata.set(`schoolBilling:${schoolId}`, billing));
    if (key === 'schoolTerms') return Object.entries(value || {}).forEach(([schoolId, term]) => metadata.set(`schoolTerms:${schoolId}`, term));
    metadata.set(key, value);
  });
  return { records, metadata };
};

const errorSourceLocation = error => {
  const stack = String(error?.stack || '').split('\n').slice(1);
  for (const frame of stack) {
    const match = frame.match(/(?:\(|\s)([^()\s]+\.js):(\d+):(\d+)\)?/);
    if (!match) continue;
    const absolute = match[1].startsWith('file://') ? match[1].slice(7) : match[1];
    const relative = context.path.relative(context.__dirname, absolute);
    if (relative.startsWith('..') || context.path.isAbsolute(relative)) continue;
    return { source: relative.replaceAll('\\', '/'), line: Number(match[2]), column: Number(match[3]) };
  }
  return { source: '', line: null, column: null };
};

const structuredLogVisibleTo = (entry, actor) =>
  Boolean(actor && (context.hasPlatformAccess(actor) || !entry.schoolId || entry.schoolId === context.accountSchoolId(actor)));

const structuredStatusMatches = (status, filter) => {
  if (!filter) return true;
  if (/^[1-5]xx$/i.test(filter)) return Math.floor(Number(status || 0) / 100) === Number(filter[0]);
  return Number(status) === Number(filter);
};

const sourceFinding = (severity, category, check, issue, why, source = '', line = null, column = null, recommendation = '') => ({
  id: context.crypto.randomUUID(), severity, category, check, issue, why, source, line, column, recommendation
});

const sourceLineNumber = (content, offset) => content.slice(0, Math.max(0, offset)).split('\n').length;

const scanSourceMatches = (sourceName, content, rules) => {
  const findings = [];
  for (const rule of rules) {
    const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
    const regex = new RegExp(rule.pattern.source, flags);
    let match;
    while ((match = regex.exec(content))) {
      findings.push(context.sourceFinding(rule.severity, rule.category, rule.check, rule.issue, rule.why, sourceName, context.sourceLineNumber(content, match.index), null, rule.recommendation));
      if (!match[0].length) regex.lastIndex += 1;
      if (findings.length >= 100) return findings;
    }
  }
  return findings;
};

const ipv4ToInt = ip => {
  const parts = String(ip || '').replace(/^::ffff:/, '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
};

const ipv4InCidr = (ip, cidr) => {
  const [network, bitsText] = cidr.split('/');
  const bits = Number(bitsText);
  const address = context.ipv4ToInt(ip), networkAddress = context.ipv4ToInt(network);
  if (address === null || networkAddress === null || !Number.isInteger(bits) || bits < 0 || bits > 32) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (address & mask) === (networkAddress & mask);
};

const htmlAttributeEscape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));

const dateKeyInSouthAfrica = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const validDateKey = value => {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T12:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === text ? text : '';
};

const storeProductForOrder = order => (context.db.storeProducts || []).find(product =>
  product.id === order?.productId && (!order?.schoolId || product.schoolId === order.schoolId)
) || null;

const storeAvailableQuantity = product => Math.max(0, (Number(product?.stockQuantity) || 0) - (Number(product?.reservedQuantity) || 0));

const updateStoreRoomRecord = (order, status, details) => {
  const records = Array.isArray(context.db.moduleRecords?.stock) ? context.db.moduleRecords.stock : [];
  const reference = String(order?.reference || '').toUpperCase();
  const record = records.find(entry =>
    entry.orderId === order?.id
    || String(entry.reference || '').toUpperCase() === reference
    || (reference && String(entry.details || '').toUpperCase().includes(`REF ${reference}`))
  );
  if (!record) return;
  record.status = status;
  if (details) record.details = details;
  record.updatedAt = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
};

const releaseStoreReservation = (order, timestamp, reason = 'failed') => {
  const quantity = Math.max(0, Number.parseInt(order?.quantity, 10) || 0);
  const product = context.storeProductForOrder(order);
  if (order?.stockAccountingVersion === 2) {
    if (order.stockReservationStatus === 'reserved') {
      if (product) product.reservedQuantity = Math.max(0, (Number(product.reservedQuantity) || 0) - quantity);
      order.stockReservationStatus = reason === 'expired' ? 'expired' : 'released';
      order.stockReleasedAt = timestamp;
    }
  } else if (!order?.legacyStockRestoredAt) {
    // Legacy store orders reduced stock at checkout. Restore it once when a payment fails or is refunded.
    if (product) product.stockQuantity = Math.max(0, (Number(product.stockQuantity) || 0) + quantity);
    order.legacyStockRestoredAt = timestamp;
    order.stockReservationStatus = 'returned_legacy';
  }
  if (reason === 'expired') {
    order.status = 'payment expired - stock released';
    order.fulfilmentStatus = 'payment_expired';
    context.updateStoreRoomRecord(order, 'Payment expired · stock released', `Store payment expired · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else if (reason === 'cancelled') {
    order.status = 'cancelled - stock released';
    order.fulfilmentStatus = 'cancelled';
    order.cancelledAt = timestamp;
    context.updateStoreRoomRecord(order, 'Cancelled · stock released', `Store order cancelled · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else if (reason === 'refunded') {
    order.status = 'refunded - stock returned';
    order.fulfilmentStatus = 'refunded';
    context.updateStoreRoomRecord(order, 'Refunded · stock returned', `Store refund confirmed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  } else {
    order.status = 'payment failed - stock released';
    order.fulfilmentStatus = 'payment_failed';
    context.updateStoreRoomRecord(order, 'Payment failed · stock released', `Store payment failed · ${order.productName} × ${quantity} · ${order.parentName} · Ref ${order.reference}`);
  }
};

const releaseExpiredStoreReservations = (schoolId = '') => {
  const now = Date.now();
  (context.db.storeOrders || []).forEach(order => {
    if (order.stockAccountingVersion !== 2 || order.stockReservationStatus !== 'reserved') return;
    if (schoolId && order.schoolId !== schoolId) return;
    const reservedAt = Date.parse(order.stockReservedAt || order.createdAt || '');
    if (!Number.isFinite(reservedAt) || now - reservedAt < context.STORE_RESERVATION_TTL_MS) return;
    const hasPaidEvent = (context.db.paymentEvents || []).some(event =>
      event.status === 'paid' && event.targetType === 'store' && event.schoolId === order.schoolId
      && String(event.reference || '').toUpperCase() === String(order.reference || '').toUpperCase()
    );
    if (!hasPaidEvent) context.releaseStoreReservation(order, new Date().toISOString(), 'expired');
  });
};

const admissionApplicationVisibleTo = (application, actor) => Boolean(application && actor && (
  context.hasPlatformAccess(actor)
  || (['principal','admin','staff'].includes(actor.role) && application.schoolId===context.accountSchoolId(actor))
  || (actor.role==='parent' && context.normalizeUsername(application.createdBy)===context.normalizeUsername(actor.username))
));

const admissionApplicationView = application => ({
  ...application,
  contactPhone:context.decryptStoredField(application.contactPhone),
  contactEmail:context.decryptStoredField(application.contactEmail),
  dateOfBirth:context.decryptStoredField(application.dateOfBirth),
  homeArea:context.decryptStoredField(application.homeArea),
  notes:context.decryptStoredField(application.notes)
});

const admissionDocumentState=application=>{
  const files=(context.db.fileRecords||[]).filter(file=>file.entityType==='admission_application'&&file.recordId===application.id&&file.accessState==='active');
  const byPurpose=new Map();
  files.forEach(file=>{const list=byPurpose.get(file.purpose)||[];list.push(file);byPurpose.set(file.purpose,list);});
  const checklist=(application.checklist||[]).map(item=>{
    const documents=byPurpose.get(item.key)||[];
    const verified=documents.some(file=>file.verificationStatus==='Verified');
    const rejected=documents.length>0&&!verified&&documents.every(file=>file.verificationStatus==='Rejected');
    return {...item,status:verified?'verified':rejected?'rejected':documents.length?'pending':'missing',documentCount:documents.length};
  });
  const missingRequired=checklist.filter(item=>item.required&&item.status!=='verified').map(item=>item.key);
  return {files:files.map(context.publicFileMetadata),checklist,missingRequired,complete:missingRequired.length===0};
};

const admissionApiView=application=>({...context.admissionApplicationView(application),documents:context.admissionDocumentState(application)});

const notifyAdmissionParent=async(application,title,message)=>{
  const parent=(context.db.users||[]).find(account=>account.role==='parent'&&context.normalizeUsername(account.username)===context.normalizeUsername(application.createdBy));
  if(parent&&typeof context.addEmailInboxItem==='function')context.addEmailInboxItem(parent,{type:'Notification',title,message,sourceId:application.id,sourceTab:'homeTab',sender:application.schoolName||'Admissions'});
  const email=context.decryptStoredField(application.contactEmail);
  if(context.looksLikeEmailAddress(email)&&(context.smtpEmailConfigured()||context.apiEmailConfigured()))await context.sendLittleFeetEmail({to:email,subject:title,text:message,html:'<p>'+String(message).replace(/[&<>]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[ch])).replace(/\n/g,'<br>')+'</p>'}).catch(()=>false);
};

const validIsoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) && !Number.isNaN(Date.parse(String(value) + 'T00:00:00Z'));

const qualificationStatus = item => {
  if (!item.expiryDate) return 'No expiry';
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const expiry = new Date(item.expiryDate + 'T00:00:00Z');
  const days = Math.ceil((expiry - today) / 86400000);
  return days < 0 ? 'Expired' : days <= 30 ? 'Expiring soon' : 'Valid';
};

const normalizeEnvelopeAddress = value => {
  const clean = String(value || '').trim().toLowerCase();
  const bracket = /<([^<>\s]+@[^<>\s]+)>/.exec(clean);
  return (bracket?.[1] || clean).replace(/^mailto:/, '');
};

const monthKey = value => /^\d{4}-\d{2}$/.test(String(value || '')) ? String(value) : new Date().toISOString().slice(0, 7);

const monthlyTaskKpi = (actor, username, month) => {
  const key = context.monthKey(month);
  const tasks = context.tenantRecords(context.db.staffTasks, actor).filter(item => context.normalizeUsername(item.assignedTo) === context.normalizeUsername(username) && String(item.createdAt || '').slice(0, 7) === key);
  const completed = tasks.filter(item => item.status === 'Completed').length;
  const total = tasks.length;
  const completionRate = total ? Math.round((completed / total) * 100) : 0;
  const band = completionRate < 50 ? 'Below average' : completionRate < 80 ? 'Average' : 'Above average';
  return { month: key, total, completed, outstanding: total - completed, completionRate, band };
};

const admissionChecklistDefaults = () => [
  { key:'birth_certificate', label:'Birth certificate', required:true },
  { key:'guardian_id', label:'Parent / guardian identity document', required:true },
  { key:'proof_of_address', label:'Proof of address', required:false },
  { key:'immunisation_record', label:'Immunisation record', required:false },
  { key:'previous_report', label:'Previous school report', required:false },
  { key:'transfer_card', label:'Transfer card', required:false }
].map(item=>({...item,status:'missing',verifiedAt:'',verifiedBy:''}));
return { logStructured, cleanReleaseVersion, readBuiltRenderDeployReleaseNote, renderDeployFallbackNote, resolveRenderDeployReleaseNote, normalizeComparableText, normaliseModerationText, containsBlockedLanguage, requestContainsBlockedLanguage, requestPayloadTooComplex, safeTextColor, boundedText, limitedText, educationStageForSelection, enforcePublicRateLimit, encryptField, decryptField, looksEncryptedField, decryptStoredField, encryptStoredField, decodeImageDataUrl, validPostMediaData, validWorksheetMediaData, safeStoredMedia, reportReviewView, safeHttpsUrl, activeAttempt, vendorSha256, duplicatePostIsHandledByRoute, persistenceHash, persistenceRecordKey, flattenPersistentState, errorSourceLocation, structuredLogVisibleTo, structuredStatusMatches, sourceFinding, sourceLineNumber, scanSourceMatches, ipv4ToInt, ipv4InCidr, htmlAttributeEscape, dateKeyInSouthAfrica, validDateKey, storeProductForOrder, storeAvailableQuantity, updateStoreRoomRecord, releaseStoreReservation, releaseExpiredStoreReservations, admissionApplicationVisibleTo, admissionApplicationView, admissionDocumentState, admissionApiView, notifyAdmissionParent, validIsoDate, qualificationStatus, normalizeEnvelopeAddress, monthKey, monthlyTaskKpi, admissionChecklistDefaults };
}
module.exports = { createHelpers };
