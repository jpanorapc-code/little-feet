const authRoutes = require('./lib/routes/auth');
const healthRoutes = require('./lib/routes/health');
const diagnosticsRoutes = require('./lib/routes/diagnostics');
const companyRoutes = require('./lib/routes/company');
const billingRoutes = require('./lib/routes/billing');
const paymentsRoutes = require('./lib/routes/payments');
const accountsRoutes = require('./lib/routes/accounts');
const booksRoutes = require('./lib/routes/books');
const schoolsRoutes = require('./lib/routes/schools');
const filesRoutes = require('./lib/routes/files');
const admissionsRoutes = require('./lib/routes/admissions');
const academicsRoutes = require('./lib/routes/academics');
const staffRoutes = require('./lib/routes/staff');
const mailRoutes = require('./lib/routes/mail');
const operationsRoutes = require('./lib/routes/operations');
const executiveRoutes = require('./lib/routes/executive');
const attendanceRoutes = require('./lib/routes/attendance');
const deletionRoutes = require('./lib/routes/deletion');
const ticketsRoutes = require('./lib/routes/tickets');
const chatRoutes = require('./lib/routes/chat');
const safetyRoutes = require('./lib/routes/safety');
const storeRoutes = require('./lib/routes/store');
const recordsRoutes = require('./lib/routes/records');
const reportsRoutes = require('./lib/routes/reports');
const learnersRoutes = require('./lib/routes/learners');
const oauthRoutes = require('./lib/routes/oauth');
const express = require('express');
const compression = require('compression');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const tls = require('tls');
const dns = require('node:dns').promises;
const Database = require('better-sqlite3');
const { Pool } = require('pg');
const session = require('express-session');
const { hashPin, matchesPin, pinHashNeedsUpgrade, hashPinAsync, matchesPinAsync } = require('./auth-crypto');
const { createLoginVerificationQueue } = require('./lib/auth/login-verification');
const withLoginVerification = createLoginVerificationQueue();
const { registerFinanceAutomation } = require('./finance-automation-server');
let registerSchoolCoreUpgrades = null;
let registerAdvancedSchoolOperations = null;
try {
  ({ registerSchoolCoreUpgrades } = require('./school-core-upgrades-server'));
  ({ registerAdvancedSchoolOperations } = require('./advanced-school-operations-server'));
} catch (error) {
  const missingOwnModule = error?.code === 'MODULE_NOT_FOUND'
    && (String(error.message || '').includes('school-core-upgrades-server') || String(error.message || '').includes('advanced-school-operations-server'));
  if (!missingOwnModule || process.env.NODE_ENV !== 'test') throw error;
}
const { createObjectStorage, objectKeyFor } = require('./lib/storage/object-storage');
const { stripHtml, verifyResendWebhook, fetchResendReceivedEmail } = require('./lib/mailbox-integration');
const { oauthCallbackUrl, resolveOAuthAccount, publicOrigin } = require('./lib/oauth-identity');
const { createStructuredLogger, redactSensitiveLogText } = require('./lib/structured-logger');
const { PROVIDERS: MAILBOX_PROVIDERS, PROVIDER_LABELS: MAILBOX_PROVIDER_LABELS, createAuthorization: createMailboxAuthorization, exchangeCode: exchangeMailboxCode, refreshAccessToken: refreshMailboxAccessToken, fetchMailbox, sendMailboxMessage, revokeMailboxAccess } = require('./lib/mailbox-oauth');
const { resolveFailoverMode } = require('./failover-mode');

const app = express();
// Getters retain live state across persistence refreshes; registration order stays unchanged.
const routeContext = {
  get ACCOUNT_ROLES() { return ACCOUNT_ROLES; },
  get ADMISSION_STATUSES() { return ADMISSION_STATUSES; },
  get APPLICATION_STAGE_SELECTIONS() { return APPLICATION_STAGE_SELECTIONS; },
  get ATTENDANCE_STATUSES() { return ATTENDANCE_STATUSES; },
  get CHAT_ROLES() { return CHAT_ROLES; },
  get COVER_STATUSES() { return COVER_STATUSES; },
  get DUPLICATE_POST_EXEMPT_PATHS() { return DUPLICATE_POST_EXEMPT_PATHS; },
  get FILE_ENTITY_TYPES() { return FILE_ENTITY_TYPES; },
  get FILE_TYPE_RULES() { return FILE_TYPE_RULES; },
  get FULL_PLATFORM_ROLES() { return FULL_PLATFORM_ROLES; },
  get KPI_RATINGS() { return KPI_RATINGS; },
  get LEAVE_STATUSES() { return LEAVE_STATUSES; },
  get LITTLE_FEET_PRIVACY_VERSION() { return LITTLE_FEET_PRIVACY_VERSION; },
  get LITTLE_FEET_TERMS_VERSION() { return LITTLE_FEET_TERMS_VERSION; },
  get LOGIN_ATTEMPT_WINDOW_MS() { return LOGIN_ATTEMPT_WINDOW_MS; },
  get LOGIN_COOLDOWN_MS() { return LOGIN_COOLDOWN_MS; },
  get LOGIN_HUMAN_CHECK_TTL_MS() { return LOGIN_HUMAN_CHECK_TTL_MS; },
  get LOGIN_HUMAN_CHECK_USED_MAX() { return LOGIN_HUMAN_CHECK_USED_MAX; },
  get MAILBOX_PROVIDERS() { return MAILBOX_PROVIDERS; },
  get MAILBOX_PROVIDER_LABELS() { return MAILBOX_PROVIDER_LABELS; },
  get MAINTENANCE_STATUSES() { return MAINTENANCE_STATUSES; },
  get MAX_DISTRIBUTED_LOGIN_ATTEMPTS() { return MAX_DISTRIBUTED_LOGIN_ATTEMPTS; },
  get MAX_LOGIN_ATTEMPTS() { return MAX_LOGIN_ATTEMPTS; },
  get MAX_MEDIA_BYTES() { return MAX_MEDIA_BYTES; },
  get MEDIA_SIGNATURES() { return MEDIA_SIGNATURES; },
  get MODERATION_EXEMPT_FIELDS() { return MODERATION_EXEMPT_FIELDS; },
  get PAYFAST_PUBLISHED_CIDRS() { return PAYFAST_PUBLISHED_CIDRS; },
  get PLATFORM_INTERNAL_ROLES() { return PLATFORM_INTERNAL_ROLES; },
  get POST_AUDIENCES() { return POST_AUDIENCES; },
  get RENDER_DEPLOY_METADATA_FILE() { return RENDER_DEPLOY_METADATA_FILE; },
  get RENDER_DEPLOY_SHA() { return RENDER_DEPLOY_SHA; },
  get RENDER_REPO_SLUG() { return RENDER_REPO_SLUG; },
  get SCHOOL_POSITION_CATALOG() { return SCHOOL_POSITION_CATALOG; },
  get SCHOOL_SEARCH_CACHE_MAX_ENTRIES() { return SCHOOL_SEARCH_CACHE_MAX_ENTRIES; },
  get SCHOOL_SEARCH_CACHE_TTL_MS() { return SCHOOL_SEARCH_CACHE_TTL_MS; },
  get SCHOOL_SECTORS() { return SCHOOL_SECTORS; },
  get SERVER_BUSY_THRESHOLD() { return SERVER_BUSY_THRESHOLD; },
  get STORE_RESERVATION_TTL_MS() { return STORE_RESERVATION_TTL_MS; },
  get WORK_TASK_STATUSES() { return WORK_TASK_STATUSES; },
  get __dirname() { return __dirname; },
  get accessCodeInUse() { return accessCodeInUse; },
  get accountMatchesUsername() { return accountMatchesUsername; },
  get accountSchoolId() { return accountSchoolId; },
  get accountSecurityEmail() { return accountSecurityEmail; },
  get activeAttempt() { return activeAttempt; },
  get activeLoginAttempt() { return activeLoginAttempt; },
  get activeRequestCount() { return activeRequestCount; },
  set activeRequestCount(value) { activeRequestCount = value; },
  get activeUsernameAttempt() { return activeUsernameAttempt; },
  get addEmailInboxItem() { return addEmailInboxItem; },
  get admissionApiView() { return admissionApiView; },
  get admissionApplicationView() { return admissionApplicationView; },
  get admissionApplicationVisibleTo() { return admissionApplicationVisibleTo; },
  get admissionChecklistDefaults() { return admissionChecklistDefaults; },
  get admissionDocumentState() { return admissionDocumentState; },
  get admissionForActor() { return admissionForActor; },
  get admissionsManagementActor() { return admissionsManagementActor; },
  get allowedParentPaymentRoles() { return allowedParentPaymentRoles; },
  get apiEmailConfigured() { return apiEmailConfigured; },
  get applicationSha() { return applicationSha; },
  get applyPaymentEvent() { return applyPaymentEvent; },
  get applyStorePaymentState() { return applyStorePaymentState; },
  get billingAmount() { return billingAmount; },
  get billingBundleSizes() { return billingBundleSizes; },
  get billingDefaults() { return billingDefaults; },
  get billingPaymentConfigured() { return billingPaymentConfigured; },
  get blockedTerms() { return blockedTerms; },
  get bookRecordView() { return bookRecordView; },
  get bookRecordVisibleTo() { return bookRecordVisibleTo; },
  get bookRecordsForSchool() { return bookRecordsForSchool; },
  get boundedText() { return boundedText; },
  get browserVendorSources() { return browserVendorSources; },
  get buildEmailInbox() { return buildEmailInbox; },
  get canManageAccount() { return canManageAccount; },
  get canManageFile() { return canManageFile; },
  get canUseDirectChat() { return canUseDirectChat; },
  get canonicalPaymentStatus() { return canonicalPaymentStatus; },
  get cents() { return cents; },
  get cleanReleaseVersion() { return cleanReleaseVersion; },
  get clearLoginLockoutForAccount() { return clearLoginLockoutForAccount; },
  get clientLearnerLinkError() { return clientLearnerLinkError; },
  get completeMailboxOAuth() { return completeMailboxOAuth; },
  get configuredPlatformOwnerUsername() { return configuredPlatformOwnerUsername; },
  get containsBlockedLanguage() { return containsBlockedLanguage; },
  get createBookRecordFromImport() { return createBookRecordFromImport; },
  get createMailboxAuthorization() { return createMailboxAuthorization; },
  get createParentPaymentRecord() { return createParentPaymentRecord; },
  get createSchoolId() { return createSchoolId; },
  get createStoredFile() { return createStoredFile; },
  get createUniqueLearnerAccessCode() { return createUniqueLearnerAccessCode; },
  get crypto() { return crypto; },
  get dateKeyInSouthAfrica() { return dateKeyInSouthAfrica; },
  get db() { return db; },
  get decodeImageDataUrl() { return decodeImageDataUrl; },
  get decodeSupportedFileDataUrl() { return decodeSupportedFileDataUrl; },
  get decryptField() { return decryptField; },
  get decryptStoredField() { return decryptStoredField; },
  get dismissEmailSource() { return dismissEmailSource; },
  get dns() { return dns; },
  get donationBillingState() { return donationBillingState; },
  get educationStageForSelection() { return educationStageForSelection; },
  get emailActor() { return emailActor; },
  get emailDeliveryProvider() { return emailDeliveryProvider; },
  get emailHeaderText() { return emailHeaderText; },
  get emailHtmlText() { return emailHtmlText; },
  get emailInboxPreferenceDefaults() { return emailInboxPreferenceDefaults; },
  get emailInboxPreferenceKeys() { return emailInboxPreferenceKeys; },
  get emailInboxPreferencesFor() { return emailInboxPreferencesFor; },
  get emailInboxTypeEnabled() { return emailInboxTypeEnabled; },
  get emailInboxTypeKey() { return emailInboxTypeKey; },
  get emailInboxVisibleTo() { return emailInboxVisibleTo; },
  get emailSourceKey() { return emailSourceKey; },
  get emailVerificationTokens() { return emailVerificationTokens; },
  get encryptField() { return encryptField; },
  get enforcePublicRateLimit() { return enforcePublicRateLimit; },
  get ensureForwardingAddress() { return ensureForwardingAddress; },
  get ensureLearnerAccessCode() { return ensureLearnerAccessCode; },
  get ensureSchool() { return ensureSchool; },
  get ensureSchoolTrialStarted() { return ensureSchoolTrialStarted; },
  get errorSourceLocation() { return errorSourceLocation; },
  get establishAuthenticatedSession() { return establishAuthenticatedSession; },
  get exchangeMailboxCode() { return exchangeMailboxCode; },
  get expectedPaymentAmount() { return expectedPaymentAmount; },
  get extendSubscriptionDate() { return extendSubscriptionDate; },
  get fetchMailbox() { return fetchMailbox; },
  get fetchResendReceivedEmail() { return fetchResendReceivedEmail; },
  get fieldEncryptionConfigured() { return fieldEncryptionConfigured; },
  get fieldKey() { return fieldKey; },
  get fileContentPath() { return fileContentPath; },
  get findAccountByUsername() { return findAccountByUsername; },
  get findLearnerAccessCodeActor() { return findLearnerAccessCodeActor; },
  get findPaymentTarget() { return findPaymentTarget; },
  get forwardingActorForRecipients() { return forwardingActorForRecipients; },
  get forwardingAddressFor() { return forwardingAddressFor; },
  get fs() { return fs; },
  get generateLearnerAccessCode() { return generateLearnerAccessCode; },
  get getSessionAccount() { return getSessionAccount; },
  get googleSignInConfigured() { return googleSignInConfigured; },
  get hasPlatformAccess() { return hasPlatformAccess; },
  get hashPin() { return hashPin; },
  get hashPinAsync() { return hashPinAsync; },
  get htmlAttributeEscape() { return htmlAttributeEscape; },
  get inboundEmailApiKey() { return inboundEmailApiKey; },
  get inboundEmailConfigured() { return inboundEmailConfigured; },
  get inboundEmailDomain() { return inboundEmailDomain; },
  get inboundWebhookSecret() { return inboundWebhookSecret; },
  get ipv4InCidr() { return ipv4InCidr; },
  get ipv4ToInt() { return ipv4ToInt; },
  get isAdminLike() { return isAdminLike; },
  get isAwaitingAccountVerification() { return isAwaitingAccountVerification; },
  get isCompanyStaffRole() { return isCompanyStaffRole; },
  get isConfiguredPlatformOwner() { return isConfiguredPlatformOwner; },
  get isParentLinkedToLearner() { return isParentLinkedToLearner; },
  get isProduction() { return isProduction; },
  get isSameSchool() { return isSameSchool; },
  get issueLoginHumanCheck() { return issueLoginHumanCheck; },
  get learnerAccessCodeView() { return learnerAccessCodeView; },
  get learnerRecordKey() { return learnerRecordKey; },
  get learnerRecordsVisibleTo() { return learnerRecordsVisibleTo; },
  get limitedText() { return limitedText; },
  get logStructured() { return logStructured; },
  get loginAttemptExpiry() { return loginAttemptExpiry; },
  get loginAttemptKey() { return loginAttemptKey; },
  get loginAttempts() { return loginAttempts; },
  get loginHumanCheckClientHash() { return loginHumanCheckClientHash; },
  get loginHumanCheckKey() { return loginHumanCheckKey; },
  get loginHumanCheckRequired() { return loginHumanCheckRequired; },
  get loginHumanCheckSignature() { return loginHumanCheckSignature; },
  get loginLockoutRemainingSeconds() { return loginLockoutRemainingSeconds; },
  get loginSecurityRequestSummary() { return loginSecurityRequestSummary; },
  get loginUsernameAttempts() { return loginUsernameAttempts; },
  get looksEncryptedField() { return looksEncryptedField; },
  get looksLikeEmailAddress() { return looksLikeEmailAddress; },
  get mailboxAccessToken() { return mailboxAccessToken; },
  get mailboxConnectionStatus() { return mailboxConnectionStatus; },
  get mailboxSyncLimit() { return mailboxSyncLimit; },
  get matchesPin() { return matchesPin; },
  get matchesPinAsync() { return matchesPinAsync; },
  get microsoftCallbackUrl() { return microsoftCallbackUrl; },
  get microsoftSignInConfigured() { return microsoftSignInConfigured; },
  get migrateAccountReferences() { return migrateAccountReferences; },
  get moduleRecordCollection() { return moduleRecordCollection; },
  get monthKey() { return monthKey; },
  get monthlyTaskKpi() { return monthlyTaskKpi; },
  get normaliseAccessCode() { return normaliseAccessCode; },
  get normaliseAssignedClasses() { return normaliseAssignedClasses; },
  get normaliseLearnerLinks() { return normaliseLearnerLinks; },
  get normaliseModerationText() { return normaliseModerationText; },
  get normalizeComparableText() { return normalizeComparableText; },
  get normalizeEnvelopeAddress() { return normalizeEnvelopeAddress; },
  get normalizeUsername() { return normalizeUsername; },
  get notifyAdmissionParent() { return notifyAdmissionParent; },
  get objectKeyFor() { return objectKeyFor; },
  get objectStorage() { return objectStorage; },
  get parentPaymentAgeing() { return parentPaymentAgeing; },
  get parentPaymentAmount() { return parentPaymentAmount; },
  get parentPaymentDueDate() { return parentPaymentDueDate; },
  get parentPaymentFinancials() { return parentPaymentFinancials; },
  get parentPaymentParentForSchool() { return parentPaymentParentForSchool; },
  get parentPaymentSummary() { return parentPaymentSummary; },
  get parentPaymentView() { return parentPaymentView; },
  get parentSubscriptionActive() { return parentSubscriptionActive; },
  get passport() { return passport; },
  get path() { return path; },
  get payFastConfigured() { return payFastConfigured; },
  get payFastHost() { return payFastHost; },
  get payFastMode() { return payFastMode; },
  get payFastParamString() { return payFastParamString; },
  get payFastProcessUrl() { return payFastProcessUrl; },
  get payFastRawEntries() { return payFastRawEntries; },
  get payFastResolvedIps() { return payFastResolvedIps; },
  set payFastResolvedIps(value) { payFastResolvedIps = value; },
  get payFastServerValidates() { return payFastServerValidates; },
  get payFastSignature() { return payFastSignature; },
  get payFastSourceIsValid() { return payFastSourceIsValid; },
  get payFastUrlEncode() { return payFastUrlEncode; },
  get payFastValidationUrl() { return payFastValidationUrl; },
  get paymentInstructions() { return paymentInstructions; },
  get paymentStatuses() { return paymentStatuses; },
  get persistenceHash() { return persistenceHash; },
  get persistenceRecordKey() { return persistenceRecordKey; },
  get pinHashNeedsUpgrade() { return pinHashNeedsUpgrade; },
  get planPriceForLearners() { return planPriceForLearners; },
  get postgresPool() { return postgresPool; },
  set postgresPool(value) { postgresPool = value; },
  get pruneLoginAttempts() { return pruneLoginAttempts; },
  get pruneUsedLoginHumanChecks() { return pruneUsedLoginHumanChecks; },
  get publicBillingPricing() { return publicBillingPricing; },
  get publicFileMetadata() { return publicFileMetadata; },
  get publicForwardingStatus() { return publicForwardingStatus; },
  get publicOrigin() { return publicOrigin; },
  get publicRateLimits() { return publicRateLimits; },
  get purgeSchoolData() { return purgeSchoolData; },
  get qualificationStatus() { return qualificationStatus; },
  get queueStorageCleanup() { return queueStorageCleanup; },
  get readBuiltRenderDeployReleaseNote() { return readBuiltRenderDeployReleaseNote; },
  get readOnlySnapshotMode() { return readOnlySnapshotMode; },
  get readSchoolSearchCache() { return readSchoolSearchCache; },
  get receivedEmailSourceId() { return receivedEmailSourceId; },
  get recordInSchool() { return recordInSchool; },
  get recordSystemError() { return recordSystemError; },
  get redactSensitiveLogText() { return redactSensitiveLogText; },
  get refreshMailboxAccessToken() { return refreshMailboxAccessToken; },
  get registeredSchools() { return registeredSchools; },
  get registryRecordView() { return registryRecordView; },
  get relatedRecordForFile() { return relatedRecordForFile; },
  get releaseExpiredStoreReservations() { return releaseExpiredStoreReservations; },
  get releaseStoreReservation() { return releaseStoreReservation; },
  get renderDeployAvailable() { return renderDeployAvailable; },
  get renderDeployFallbackNote() { return renderDeployFallbackNote; },
  get renderDeployReleaseNote() { return renderDeployReleaseNote; },
  set renderDeployReleaseNote(value) { renderDeployReleaseNote = value; },
  get renderDeployReleasePromise() { return renderDeployReleasePromise; },
  set renderDeployReleasePromise(value) { renderDeployReleasePromise = value; },
  get renderRepoSlugAvailable() { return renderRepoSlugAvailable; },
  get replicaCapturedAt() { return replicaCapturedAt; },
  set replicaCapturedAt(value) { replicaCapturedAt = value; },
  get replicaMode() { return replicaMode; },
  get replicaSourceSha() { return replicaSourceSha; },
  set replicaSourceSha(value) { replicaSourceSha = value; },
  get replicaTransport() { return replicaTransport; },
  set replicaTransport(value) { replicaTransport = value; },
  get reportReviewView() { return reportReviewView; },
  get requireFromRoot() { return require; },
  get requireAccountManager() { return requireAccountManager; },
  get requireAdmin() { return requireAdmin; },
  get requireSafetyStaff() { return requireSafetyStaff; },
  get requireSchoolStaff() { return requireSchoolStaff; },
  get resolveManagedAccountScope() { return resolveManagedAccountScope; },
  get resolveOAuthAccount() { return resolveOAuthAccount; },
  get resolveRenderDeployReleaseNote() { return resolveRenderDeployReleaseNote; },
  get revokeMailboxAccess() { return revokeMailboxAccess; },
  get rollbackStoredFile() { return rollbackStoredFile; },
  get runAdminSelfTest() { return runAdminSelfTest; },
  get runStorageCleanupJob() { return runStorageCleanupJob; },
  get runtimeReadiness() { return runtimeReadiness; },
  get safeAccount() { return safeAccount; },
  get safeHttpsUrl() { return safeHttpsUrl; },
  get safeOriginalFilename() { return safeOriginalFilename; },
  get safeStoredMedia() { return safeStoredMedia; },
  get safeTextColor() { return safeTextColor; },
  get saveDatabaseState() { return saveDatabaseState; },
  get scanSourceMatches() { return scanSourceMatches; },
  get scheduleReplicaSnapshot() { return scheduleReplicaSnapshot; },
  get schoolKey() { return schoolKey; },
  get schoolLearnerCount() { return schoolLearnerCount; },
  get schoolLearnerLimitState() { return schoolLearnerLimitState; },
  get schoolPlanForCode() { return schoolPlanForCode; },
  get schoolSearchCache() { return schoolSearchCache; },
  get schoolSubscriptionAccessState() { return schoolSubscriptionAccessState; },
  get schoolSubscriptionPlans() { return schoolSubscriptionPlans; },
  get sendLittleFeetEmail() { return sendLittleFeetEmail; },
  get sendLoginLockoutEmail() { return sendLoginLockoutEmail; },
  get sendMailboxMessage() { return sendMailboxMessage; },
  get sendSuccessfulLoginEmail() { return sendSuccessfulLoginEmail; },
  get sessionSecretConfigured() { return sessionSecretConfigured; },
  get sharedDatabaseFailover() { return sharedDatabaseFailover; },
  get smtpConfig() { return smtpConfig; },
  get smtpEmailConfigured() { return smtpEmailConfigured; },
  get smtpSend() { return smtpSend; },
  get sourceFinding() { return sourceFinding; },
  get sourceLineNumber() { return sourceLineNumber; },
  get staffAccountInSchool() { return staffAccountInSchool; },
  get stateDatabase() { return stateDatabase; },
  set stateDatabase(value) { stateDatabase = value; },
  get storeAvailableQuantity() { return storeAvailableQuantity; },
  get storeProductForOrder() { return storeProductForOrder; },
  get structuredLogVisibleTo() { return structuredLogVisibleTo; },
  get structuredLogger() { return structuredLogger; },
  get structuredStatusMatches() { return structuredStatusMatches; },
  get studentSensitiveView() { return studentSensitiveView; },
  get subscriptionBillingState() { return subscriptionBillingState; },
  get syncConnectedMailbox() { return syncConnectedMailbox; },
  get systemErrorVisibleTo() { return systemErrorVisibleTo; },
  get tagEmploymentRecord() { return tagEmploymentRecord; },
  get tagSchoolRecord() { return tagSchoolRecord; },
  get tenantRecords() { return tenantRecords; },
  get tls() { return tls; },
  get updateStoreRoomRecord() { return updateStoreRoomRecord; },
  get usedLoginHumanChecks() { return usedLoginHumanChecks; },
  get validDateKey() { return validDateKey; },
  get validForwardingAlias() { return validForwardingAlias; },
  get validIsoDate() { return validIsoDate; },
  get validPostMediaData() { return validPostMediaData; },
  get validSecretLength() { return validSecretLength; },
  get validSignatureData() { return validSignatureData; },
  get validWorksheetMediaData() { return validWorksheetMediaData; },
  get validateLearnerLinks() { return validateLearnerLinks; },
  get validateSchoolPosition() { return validateSchoolPosition; },
  get verifyLoginHumanCheck() { return verifyLoginHumanCheck; },
  get verifyResendWebhook() { return verifyResendWebhook; },
  get withLoginVerification() { return withLoginVerification; },
  get writeReplicaSnapshot() { return writeReplicaSnapshot; },
  get writeSchoolSearchCache() { return writeSchoolSearchCache; },
  get yahooCallbackUrl() { return yahooCallbackUrl; },
  get yahooSignInConfigured() { return yahooSignInConfigured; },
};
const validationHelpers = require('./lib/helpers/validation').createHelpers(routeContext);
const accountsHelpers = require('./lib/helpers/accounts').createHelpers(routeContext);
const learnersHelpers = require('./lib/helpers/learners').createHelpers(routeContext);
const tenancyHelpers = require('./lib/helpers/tenancy').createHelpers(routeContext);
const billingHelpers = require('./lib/helpers/billing').createHelpers(routeContext);
const filesHelpers = require('./lib/helpers/files').createHelpers(routeContext);
const recordsHelpers = require('./lib/helpers/records').createHelpers(routeContext);
const mailHelpers = require('./lib/helpers/mail').createHelpers(routeContext);
const diagnosticsHelpers = require('./lib/helpers/diagnostics').createHelpers(routeContext);
const paymentsHelpers = require('./lib/helpers/payments').createHelpers(routeContext);
const booksHelpers = require('./lib/helpers/books').createHelpers(routeContext);


const PORT = Number(process.env.PORT) || 10000;
const isProduction = process.env.NODE_ENV === 'production';
const failoverMode = resolveFailoverMode(process.env);
const replicaMode = failoverMode.replica;
const sharedDatabaseFailover = failoverMode.sharedDatabase;
const readOnlySnapshotMode = failoverMode.readOnlySnapshot;
const schoolSearchCache = new Map();
const loginAttempts = new Map();
const loginUsernameAttempts = new Map();
const LOGIN_COOLDOWN_MS = 10 * 60 * 1000;
const LOGIN_ATTEMPT_WINDOW_MS = LOGIN_COOLDOWN_MS;
const MAX_LOGIN_ATTEMPTS = 3;
const MAX_DISTRIBUTED_LOGIN_ATTEMPTS = 3;
const SCHOOL_SEARCH_CACHE_TTL_MS = 30 * 60 * 1000;
const SCHOOL_SEARCH_CACHE_MAX_ENTRIES = 250;
const MAX_API_BODY_MB = Math.max(1, Math.min(10, Number(process.env.LF_MAX_API_BODY_MB) || 8));
const STANDARD_IMPORT_MAX_BODY_BYTES = 5 * 1024 * 1024;
const DUPLICATE_POST_WINDOW_MS = 5 * 1000;
const recentPostFingerprints = new Map();
const structuredLogger = createStructuredLogger({
  maxEntries: Number(process.env.LF_STRUCTURED_LOG_MAX_ENTRIES) || 5000,
  slowRequestMs: Number(process.env.LF_SLOW_REQUEST_MS) || 1500
});
const logStructured = validationHelpers.logStructured;
const applicationSha = (() => {
  const fromEnvironment = String(process.env.RENDER_GIT_COMMIT || process.env.GITHUB_SHA || '').trim();
  if (fromEnvironment) return fromEnvironment;
  try {
    const release = JSON.parse(fs.readFileSync(path.join(__dirname, '.render-deploy-release.json'), 'utf8'));
    return String(release.fullCommitSha || '').trim();
  } catch { return ''; }
})();
const SERVER_BUSY_THRESHOLD = Math.max(8, Math.min(100, Number(process.env.LF_SERVER_BUSY_THRESHOLD) || 12));
const DEFAULT_BLOCKED_TERMS = Object.freeze(['asshole', 'bastard', 'bitch', 'cunt', 'dick', 'fok', 'fokken', 'fuck', 'kak', 'poes', 'shit']);
const blockedTerms = Object.freeze((process.env.LF_BLOCKED_TERMS || DEFAULT_BLOCKED_TERMS.join(','))
  .split(',').map(term => term.trim().toLocaleLowerCase('en-US')).filter(Boolean));
let activeRequestCount = 0;
let activeSharedDatabaseMutations = 0;
let persistenceReady = Promise.resolve();
const fieldEncryptionConfigured = Boolean(process.env.LF_FIELD_ENCRYPTION_KEY);
const sessionSecretConfigured = Boolean(process.env.SESSION_SECRET);
const productionConfigurationErrors = [];
if (isProduction && !readOnlySnapshotMode && !process.env.DATABASE_URL) productionConfigurationErrors.push('DATABASE_URL');
if (isProduction && !fieldEncryptionConfigured) productionConfigurationErrors.push('LF_FIELD_ENCRYPTION_KEY');
if (isProduction && !sessionSecretConfigured) productionConfigurationErrors.push('SESSION_SECRET');
if (productionConfigurationErrors.length) {
  throw new Error(`Production configuration is missing required secure settings: ${productionConfigurationErrors.join(', ')}`);
}
const fieldKey = crypto.createHash('sha256').update(process.env.LF_FIELD_ENCRYPTION_KEY || 'LittleFeet-development-key-change-before-production').digest();
const LITTLE_FEET_PRIVACY_VERSION = 'POPIA-2026-09-v6';
const LITTLE_FEET_TERMS_VERSION = 'TOS-ZA-2026-09-v5';
const RENDER_DEPLOY_SHA = String(process.env.RENDER_GIT_COMMIT || '').trim().toLowerCase();
const RENDER_REPO_SLUG = String(process.env.RENDER_GIT_REPO_SLUG || '').trim();
const renderDeployAvailable = process.env.RENDER === 'true' && /^[0-9a-f]{40}$/.test(RENDER_DEPLOY_SHA);
const renderRepoSlugAvailable = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(RENDER_REPO_SLUG);
const RENDER_DEPLOY_METADATA_FILE = path.join(__dirname, '.render-deploy-release.json');
let renderDeployReleaseNote = null;
let renderDeployReleasePromise = null;
const cleanReleaseVersion = validationHelpers.cleanReleaseVersion;
const readBuiltRenderDeployReleaseNote = validationHelpers.readBuiltRenderDeployReleaseNote;
const renderDeployFallbackNote = validationHelpers.renderDeployFallbackNote;
const resolveRenderDeployReleaseNote = validationHelpers.resolveRenderDeployReleaseNote;
const CURRENT_RELEASE_NOTES = Object.freeze([
  Object.freeze({
    id: 'little-feet-1.0-baseline', version: '1.0', title: 'Production foundation',
    summary: 'Secure accounts, automatic subscription activation, private file storage, reliable imports, and performance improvements are now live.',
    publishedAt: '2026-09-27T15:00:00.000+02:00'
  })
]);
if (!fieldEncryptionConfigured) logStructured('warn', 'config.development_field_key', { category: 'configuration', message: 'Using a development field-encryption key. Set LF_FIELD_ENCRYPTION_KEY before production.' });
if (!sessionSecretConfigured) logStructured('warn', 'config.development_session_secret', { category: 'configuration', message: 'Using a development session secret. Set SESSION_SECRET before production.' });
// Usernames and email addresses are identifiers, not secrets. Store their display
// casing, but compare a trimmed, case-insensitive value at every authentication boundary.
const normalizeUsername = accountsHelpers.normalizeUsername;
const accountMatchesUsername = accountsHelpers.accountMatchesUsername;
const findAccountByUsername = accountsHelpers.findAccountByUsername;
const normalizeComparableText = validationHelpers.normalizeComparableText;
const learnerRecordKey = learnersHelpers.learnerRecordKey;
const normaliseAccessCode = accountsHelpers.normaliseAccessCode;
const normaliseModerationText = validationHelpers.normaliseModerationText;
const containsBlockedLanguage = validationHelpers.containsBlockedLanguage;
const MODERATION_EXEMPT_FIELDS = new Set([
  'pin', 'password', 'passcode', 'verificationcode', 'accesscode',
  'signature', 'signaturedata', 'mediaurl', 'photourl',
  'accountnumber', 'reference', 'transactionid', 'bankreference'
]);
const requestContainsBlockedLanguage = validationHelpers.requestContainsBlockedLanguage;
const requestPayloadTooComplex = validationHelpers.requestPayloadTooComplex;
const safeTextColor = validationHelpers.safeTextColor;
const boundedText = validationHelpers.boundedText;
const limitedText = validationHelpers.limitedText;
const validSecretLength = accountsHelpers.validSecretLength;
const POST_AUDIENCES = new Set(['All', 'Infants', 'Toddlers', 'Preschool', 'GradeR', 'Foundation', 'Intermediate', 'Senior', 'Primary', 'FET', 'HighSchool']);
const PLATFORM_INTERNAL_ROLES = new Set(['staff', 'crm', 'accounts', 'support']);
const FULL_PLATFORM_ROLES = new Set(); // Company jobs never confer owner privileges.
const ACCOUNT_ROLES = new Set(['parent', 'teacher', 'principal', 'district', 'admin', 'school_accounts', 'school_staff', 'school_hr', 'staff', 'crm', 'accounts', 'support']);
const CHAT_ROLES = new Set(['parent', 'teacher', 'principal', 'admin', 'school_accounts', 'school_staff', 'staff', 'crm', 'accounts', 'support']);
const SCHOOL_POSITION_CATALOG = {
 parent: ['Parent / Guardian'], teacher: ['Teacher / Educator','Baby Care Practitioner','ECD Practitioner','Preschool Educator','Grade R Educator','Primary School Educator','High School Educator','Special Needs Educator','Teaching Assistant','Head of Department'],
 principal: ['Principal / Head of School','Deputy Principal','ECD Centre Manager'], district: ['District / Circuit Official'], admin: ['School Administrator'], school_accounts: ['Bursar / School Accounts','Finance Officer'],
 school_hr:['HR Officer'], school_staff: ['Reception / School Office','Admissions Officer','School Nurse','Learning Support Practitioner','Aftercare Practitioner','Transport / Driver','Kitchen / Catering','Maintenance / Grounds','Security','Cleaning / Housekeeping','Library / Resources','Sports / Activities']
};
const SCHOOL_SECTORS = ['All School Sectors','Baby Care','Toddler / ECD','Preschool','Grade R','Primary School','High School','Combined School','Special Needs School'];
const validateSchoolPosition = tenancyHelpers.validateSchoolPosition;
const isAwaitingAccountVerification = accountsHelpers.isAwaitingAccountVerification;
const configuredPlatformOwnerUsername = accountsHelpers.configuredPlatformOwnerUsername;
const isConfiguredPlatformOwner = accountsHelpers.isConfiguredPlatformOwner;
const hasPlatformAccess = accountsHelpers.hasPlatformAccess;
const isAdminLike = accountsHelpers.isAdminLike;
const isCompanyStaffRole = accountsHelpers.isCompanyStaffRole;
const ATTENDANCE_STATUSES = new Set(['Checked In', 'Present', 'Absent', 'Late', 'Excused', 'Checked Out']);
const APPLICATION_STAGE_SELECTIONS = new Set([
  'ECD · Baby (Birth–11 months)',
  'ECD · 1-year-olds (12–23 months)',
  'ECD · 2-year-olds (24–35 months)',
  'ECD · 3-year-olds (36–47 months)',
  'ECD · 4-year-olds (48–59 months)',
  'ECD · 5-year-olds (60–71 months)',
  // Legacy values remain accepted so old clients and saved drafts do not break.
  'ECD · Infant care (Birth–12 months)',
  'ECD · Toddler (Approx. 1–3 years)',
  'ECD · Preschool (Approx. 3–4 years)',
  'Grade R · Reception',
  'Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'
]);
const educationStageForSelection = validationHelpers.educationStageForSelection;
const publicRateLimits = new Map();
const enforcePublicRateLimit = validationHelpers.enforcePublicRateLimit;
const generateLearnerAccessCode = learnersHelpers.generateLearnerAccessCode;
const normaliseLearnerLinks = learnersHelpers.normaliseLearnerLinks;
const validateLearnerLinks = learnersHelpers.validateLearnerLinks;
const isParentLinkedToLearner = learnersHelpers.isParentLinkedToLearner;
const normaliseAssignedClasses = learnersHelpers.normaliseAssignedClasses;
const schoolKey = tenancyHelpers.schoolKey;
const createSchoolId = tenancyHelpers.createSchoolId;
const ensureSchool = tenancyHelpers.ensureSchool;
const accountSchoolId = tenancyHelpers.accountSchoolId;
// A tenancy record can exist before a school signs up or approves any users.
// Count actual registrations, not those placeholder/legacy records.
const registeredSchools = tenancyHelpers.registeredSchools;
const ensureSchoolTrialStarted = billingHelpers.ensureSchoolTrialStarted;
const isSameSchool = tenancyHelpers.isSameSchool;
const recordInSchool = tenancyHelpers.recordInSchool;
const tagSchoolRecord = tenancyHelpers.tagSchoolRecord;
const tenantRecords = tenancyHelpers.tenantRecords;
const canUseDirectChat = accountsHelpers.canUseDirectChat;
const encryptField = validationHelpers.encryptField;
const decryptField = validationHelpers.decryptField;
const looksEncryptedField = validationHelpers.looksEncryptedField;
const decryptStoredField = validationHelpers.decryptStoredField;
const encryptStoredField = validationHelpers.encryptStoredField;
const MAX_MEDIA_BYTES = 5 * 1024 * 1024;
const MEDIA_SIGNATURES = Object.freeze({
  'image/png': bytes => bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': bytes => bytes.length >= 3 && bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])),
  'image/gif': bytes => bytes.length >= 6 && (bytes.subarray(0, 6).toString('ascii') === 'GIF87a' || bytes.subarray(0, 6).toString('ascii') === 'GIF89a'),
  'image/webp': bytes => bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP'
});
const decodeImageDataUrl = validationHelpers.decodeImageDataUrl;
const FILE_TYPE_RULES = Object.freeze({
  'image/png': { extension: 'png', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/png'] },
  'image/jpeg': { extension: 'jpg', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/jpeg'] },
  'image/gif': { extension: 'gif', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/gif'] },
  'image/webp': { extension: 'webp', maxBytes: MAX_MEDIA_BYTES, validate: MEDIA_SIGNATURES['image/webp'] },
  'application/pdf': { extension: 'pdf', maxBytes: MAX_MEDIA_BYTES, validate: bytes => bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-' },
  'text/plain': { extension: 'txt', maxBytes: 2 * 1024 * 1024, validate: bytes => !bytes.includes(0) },
  'text/csv': { extension: 'csv', maxBytes: 2 * 1024 * 1024, validate: bytes => !bytes.includes(0) }
});
const safeOriginalFilename = filesHelpers.safeOriginalFilename;
const decodeSupportedFileDataUrl = filesHelpers.decodeSupportedFileDataUrl;
const validPostMediaData = validationHelpers.validPostMediaData;
const validWorksheetMediaData = validationHelpers.validWorksheetMediaData;
const validSignatureData = filesHelpers.validSignatureData;
const safeStoredMedia = validationHelpers.safeStoredMedia;
const studentSensitiveView = learnersHelpers.studentSensitiveView;
const registryRecordView = recordsHelpers.registryRecordView;
const reportReviewView = validationHelpers.reportReviewView;
const accessCodeInUse = accountsHelpers.accessCodeInUse;
const createUniqueLearnerAccessCode = learnersHelpers.createUniqueLearnerAccessCode;
const ensureLearnerAccessCode = learnersHelpers.ensureLearnerAccessCode;
const ensureAllLearnersHaveAccessCodes = learnersHelpers.ensureAllLearnersHaveAccessCodes;
const safeHttpsUrl = validationHelpers.safeHttpsUrl;
const loginAttemptKey = accountsHelpers.loginAttemptKey;
const loginAttemptExpiry = accountsHelpers.loginAttemptExpiry;
const activeAttempt = validationHelpers.activeAttempt;
const activeLoginAttempt = accountsHelpers.activeLoginAttempt;
const activeUsernameAttempt = accountsHelpers.activeUsernameAttempt;
const loginLockoutRemainingSeconds = accountsHelpers.loginLockoutRemainingSeconds;
const clearLoginLockoutForAccount = accountsHelpers.clearLoginLockoutForAccount;
const looksLikeEmailAddress = mailHelpers.looksLikeEmailAddress;
const accountSecurityEmail = mailHelpers.accountSecurityEmail;
const sendLoginLockoutEmail = mailHelpers.sendLoginLockoutEmail;

const loginSecurityRequestSummary = accountsHelpers.loginSecurityRequestSummary;

const sendSuccessfulLoginEmail = mailHelpers.sendSuccessfulLoginEmail;

const pruneLoginAttempts = accountsHelpers.pruneLoginAttempts;
const loginAttemptCleanupTimer = setInterval(pruneLoginAttempts, 5 * 60 * 1000);
loginAttemptCleanupTimer.unref?.();

const readSchoolSearchCache = tenancyHelpers.readSchoolSearchCache;
const writeSchoolSearchCache = tenancyHelpers.writeSchoolSearchCache;

// Middleware for parsing JSON & URL-encoded bodies (supports Base64 media files)
app.disable('x-powered-by');
app.use(compression({ threshold: 1024 }));
const STRUCTURED_LOG_QUIET_READ_ROUTES = new Set([
  '/api/health',
  '/api/ready',
  '/api/keepalive',
  '/api/system-status',
  '/api/system-diagnostics',
  '/api/system-errors',
  '/api/system-logs',
  '/api/auth/session'
]);
app.use((req, res, next) => {
  req.requestId = String(req.get('x-request-id') || crypto.randomUUID()).slice(0, 100);
  req.structuredLogStartedAt = process.hrtime.bigint();
  res.setHeader('X-Request-Id', req.requestId);

  let requestLogWritten = false;
  const writeRequestLog = (closedEarly = false) => {
    if (requestLogWritten || !req.path.startsWith('/api/')) return;
    requestLogWritten = true;
    const route = String(req.originalUrl || req.path || '').split('?')[0].slice(0, 240);
    if (req.method === 'GET' && STRUCTURED_LOG_QUIET_READ_ROUTES.has(route)) return;

    const durationMs = Number(process.hrtime.bigint() - req.structuredLogStartedAt) / 1e6;
    let actor = null;
    try { actor = getSessionAccount(req); } catch { actor = null; }
    const status = closedEarly && !res.writableEnded ? 499 : Number(res.statusCode || 200);
    const securityStatus = [401, 403, 429].includes(status);
    const severity = status >= 500 ? 'error'
      : securityStatus || [409, 413, 415, 422].includes(status) || durationMs >= structuredLogger.slowRequestMs ? 'warn'
      : 'info';
    const result = closedEarly && !res.writableEnded ? 'client_closed'
      : status >= 500 ? 'server_error'
      : status >= 400 ? 'client_error'
      : 'success';

    logStructured(severity, 'http.request', {
      category: securityStatus ? 'security' : 'request',
      requestId: req.requestId,
      user: actor?.username || '',
      role: actor?.role || '',
      schoolId: actor ? accountSchoolId(actor) : '',
      schoolName: actor?.schoolName || '',
      method: req.method,
      route,
      status,
      durationMs,
      result,
      details: durationMs >= structuredLogger.slowRequestMs ? 'Slow request threshold exceeded.' : ''
    });
  };
  res.on('finish', () => writeRequestLog(false));
  res.on('close', () => writeRequestLog(true));
  next();
});
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'));
  if (!hasBody) return next();
  if (req.is('application/json') || req.is('application/*+json') || req.is('application/x-www-form-urlencoded')) return next();
  return res.status(415).json({ message: 'Unsupported request body type. Use JSON or URL-encoded form data.' });
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-DNS-Prefetch-Control', 'off');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=(self), payment=(), usb=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
    "form-action 'self' https://www.payfast.co.za https://sandbox.payfast.co.za",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://unpkg.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https:",
    "media-src 'self' blob:",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "upgrade-insecure-requests",
    "block-all-mixed-content"
  ].join('; '));
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.path.startsWith('/api/') && !['/api/health', '/api/ready', '/api/nearby-schools'].includes(req.path)) {
    res.setHeader('Cache-Control', 'no-store, private');
  }
  next();
});
app.use(express.json({
  limit: `${MAX_API_BODY_MB}mb`,
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));
app.use(express.urlencoded({
  extended: true,
  limit: `${MAX_API_BODY_MB}mb`,
  verify: (req, _res, buffer) => { req.rawBody = Buffer.from(buffer); }
}));
const STANDARD_IMPORT_API_PATHS = new Set([
  '/api/schedules/import',
  '/api/attendance/import',
  '/api/book-register/import'
]);
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const requestPath = String(req.originalUrl || '').split('?')[0];
  if (!STANDARD_IMPORT_API_PATHS.has(requestPath)) return next();
  const requestBytes = Buffer.isBuffer(req.rawBody)
    ? req.rawBody.length
    : Buffer.byteLength(JSON.stringify(req.body || {}), 'utf8');
  if (requestBytes <= STANDARD_IMPORT_MAX_BODY_BYTES) return next();
  return res.status(413).json({
    message: 'This import is too large. Use a spreadsheet up to 5 MB. Large school-register imports must use School Integration.'
  });
});
app.use('/api', (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) return next();
  if (['/api/email/inbound/resend', '/api/payments/payfast/itn'].includes(String(req.originalUrl || '').split('?')[0])) return next();
  if (requestPayloadTooComplex(req.body)) return res.status(400).json({ message: 'Request structure is too deeply nested or complex.' });
  if (!requestContainsBlockedLanguage(req.body)) return next();
  return res.status(422).json({ message: 'Please remove prohibited language before submitting this form.' });
});
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/signup' && !enforcePublicRateLimit(req, res, 'signup', 20, 60 * 60 * 1000)) return;
  if (req.method === 'GET' && req.path === '/api/nearby-schools' && !enforcePublicRateLimit(req, res, 'nearby-schools', 60, 10 * 60 * 1000)) return;
  if (req.method === 'GET' && req.path === '/api/schools/search' && !enforcePublicRateLimit(req, res, 'school-name-search', 90, 10 * 60 * 1000)) return;
  if (req.method === 'POST' && req.path === '/api/schools/enrich' && !enforcePublicRateLimit(req, res, 'school-enrich', 60, 10 * 60 * 1000)) return;
  if (req.method === 'POST' && req.path === '/api/donations/intents' && !enforcePublicRateLimit(req, res, 'donation-intent', 30, 60 * 60 * 1000)) return;
  next();
});
app.set('trust proxy', 1);
app.use('/api', (req, res, next) => {
  const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  const limit = isMutation
    ? Math.max(60, Math.min(600, Number(process.env.LF_API_MUTATION_RATE_LIMIT) || 240))
    : Math.max(300, Math.min(3000, Number(process.env.LF_API_READ_RATE_LIMIT) || 1200));
  if (!enforcePublicRateLimit(req, res, isMutation ? 'api-mutation' : 'api-read', limit, 60 * 1000)) return;
  next();
});
app.use((req, res, next) => {
  const allowReplicaWritesForTests = process.env.NODE_ENV === 'test' && process.env.LF_TEST_ALLOW_REPLICA_WRITES === '1';
  if (!readOnlySnapshotMode || allowReplicaWritesForTests || !req.path.startsWith('/api/') || ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  // Standby replicas are deliberately read-only. Authentication is allowed so
  // users can inspect the latest snapshot during failover, but business-data
  // writes must never return success when there is no durable write path.
  if (req.method === 'POST' && ['/api/login', '/api/auth/logout', '/api/system/client-log', '/api/system-self-test'].includes(req.path)) return next();
  res.setHeader('Retry-After', '30');
  return res.status(503).json({
    message: 'Backup server is read-only. Your change was not saved; reconnect to the primary service and retry.',
    requestId: req.requestId
  });
});
let persistentMutationQueue = Promise.resolve();
async function withPersistentMutation(task) {
  const previous = persistentMutationQueue;
  let releaseTurn;
  persistentMutationQueue = new Promise(resolve => { releaseTurn = resolve; });
  await previous;
  let lockClient;
  activeSharedDatabaseMutations += 1;
  try {
    if (postgresPool) {
      // Wait locally before borrowing a connection. Waiting requests must not
      // consume every pool slot needed by the lock holder to load or save.
      lockClient = await postgresPool.connect();
      await lockClient.query('SELECT pg_advisory_lock(12801337)');
      await loadDatabaseState();
    }
    return await task();
  } finally {
    if (lockClient) {
      await lockClient.query('SELECT pg_advisory_unlock(12801337)').catch(() => {});
      lockClient.release();
    }
    activeSharedDatabaseMutations = Math.max(0, activeSharedDatabaseMutations - 1);
    releaseTurn();
  }
}
app.use((req, res, next) => {
  persistenceReady.then(async () => {
    activeRequestCount += 1;
    let requestReleased = false;
    const releaseRequest = () => {
      if (requestReleased) return;
      requestReleased = true;
      activeRequestCount = Math.max(0, activeRequestCount - 1);
    };
    res.on('finish', releaseRequest);
    res.on('close', releaseRequest);
    if (!req.method || req.method === 'GET' || readOnlySnapshotMode) return next();
    await withPersistentMutation(() => new Promise(resolve => {
      if (res.destroyed) return resolve();
      let persistenceTask = null;
      const finishMutation = () => {
        if (persistenceTask) void persistenceTask.then(resolve, resolve);
        else resolve();
      };
      res.once('finish', finishMutation);
      res.once('close', () => { if (res.writableEnded) finishMutation(); });
      // A disconnected browser does not cancel an in-flight storage operation.
      // Keep the mutation turn until its handler ends the response or commits.
      const originalEnd = res.end.bind(res);
      res.end = (...args) => {
        const result = originalEnd(...args);
        finishMutation();
        return result;
      };
      const originalJson = res.json.bind(res);
      let persistenceResponsePending = false;
      res.json = body => {
        if (res.statusCode >= 400 || req.persistenceCommitted || persistenceResponsePending) return originalJson(body);
        persistenceResponsePending = true;
        persistenceTask = saveDatabaseState().then(() => {
          req.persistenceCommitted = true;
          scheduleReplicaSnapshot();
          if (!res.destroyed) originalJson(body);
          else finishMutation();
        }).catch(async error => {
          logStructured('error', 'persistence.mutation_commit_failed', { category: 'persistence', requestId: req.requestId, method: req.method, route: String(req.originalUrl || '').split('?')[0], status: 503, result: 'not_persisted', message: error.message });
          await loadDatabaseState().catch(() => {});
          if (!res.headersSent && !res.destroyed) {
            res.status(503);
            originalJson({ message: 'Your change could not be committed to durable storage. Nothing has been confirmed; please retry after the database recovers.', requestId: req.requestId });
          }
          if (res.destroyed) finishMutation();
        });
        return res;
      };
      next();
    }));
  }).catch(next);
});
// Serve only explicit public assets. Serving the repository root would also
// expose backend source, configuration manifests, and local database files.
const staticFileOptions = {
  setHeaders: (res, filePath) => {
    if (/\.html$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache');
    else if (/\.(?:js|css)$/i.test(filePath)) res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    else if (/\.(?:png|jpe?g|webp|gif|svg|ico|mp3|wav|woff2?)$/i.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    else res.setHeader('Cache-Control', 'public, max-age=86400');
  }
};
app.use('/assets', express.static(path.join(__dirname, 'assets'), staticFileOptions));
app.get('/runtime-config.js', (_req, res) => {
  const configured = replicaMode ? '' : String(process.env.LITTLE_FEET_BACKUP_URL || '').trim();
  let backupUrl = '';
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password && parsed.origin !== publicOrigin()) backupUrl = parsed.origin;
  } catch {}
  res.set('Cache-Control', 'no-store');
  res.type('application/javascript').send(`window.LITTLE_FEET_BACKUP_URL = ${JSON.stringify(backupUrl)};`);
});
const publicOutputDocuments = Object.freeze(new Map([
  ['LittleFeet_Presentation_2026_Updated.pdf', 'LittleFeet_Presentation_2026_Updated.pdf'],
  ['LittleFeet_User_Manual_2026_Updated.pdf', 'LittleFeet_User_Manual_2026_Updated.pdf'],
  ['LittleSteps_Platform_Presentation_2026.pdf', 'LittleSteps_Platform_Presentation_2026.pdf'],
  ['LittleSteps_User_Manual_2026.pdf', 'LittleSteps_User_Manual_2026.pdf']
]));
app.get('/output/pdf/:document', (req, res) => {
  const document = publicOutputDocuments.get(String(req.params.document || ''));
  if (!document) return res.sendStatus(404);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('application/pdf');
  res.sendFile(document, { root: path.join(__dirname, 'output', 'pdf') });
});
const sendPublicRootFile = filesHelpers.sendPublicRootFile;
app.get('/backup.js', sendPublicRootFile);
app.get('/paia.html', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.type('html');
  res.sendFile('paia.html', { root: __dirname });
});
app.get(['/little-feet-mascot.jfif', '/logo.png', '/logo-transparent.png'], sendPublicRootFile);
app.get('/manifest.webmanifest', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/manifest+json');
  res.sendFile('manifest.webmanifest', { root: __dirname });
});
app.get('/service-worker.js', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript');
  res.sendFile('service-worker.js', { root: __dirname });
});
app.get('/robots.txt', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain');
  res.sendFile('robots.txt', { root: __dirname });
});
app.get('/sitemap.xml', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml');
  res.sendFile('sitemap.xml', { root: __dirname });
});
app.get('/favicon.ico', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('image/png');
  res.sendFile('logo.png', { root: __dirname });
});

const browserVendorSources = Object.freeze({
  'xlsx.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js',
    sha256: 'sha256-yVBhl8r4CaB1tt7h2g02+xnacVj/6KiOewyWxdhiPJk='
  }),
  'qrcode.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js',
    sha256: 'sha256-xUHvBjJ4hahBW8qN9gceFBibSFUzbe9PNttUvehITzY='
  }),
  'leaflet.js': Object.freeze({
    url: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
    sha256: 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
  }),
  'leaflet-markercluster.js': Object.freeze({
    url: 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js',
    sha256: 'sha256-Hk4dIpcqOSb0hZjgyvFOP+cEmDXUKKNE/tT542ZbNQg='
  }),
  'three.module.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.module.js',
    sha256: 'sha256-kFIELWdssP3B3f7+GTBT80t6wFE6YW/axFNdSZh4Euo='
  }),
  'three.core.js': Object.freeze({
    url: 'https://cdn.jsdelivr.net/npm/three@0.186.0/build/three.core.js',
    sha256: 'sha256-nt3gArBmqaBWdqYSf2dzW2K685m96lKfL34xZX2naeY='
  })
});
const browserVendorCache = new Map();
const vendorSha256 = validationHelpers.vendorSha256;
app.get('/vendor/:asset', async (req, res, next) => {
  const source = browserVendorSources[req.params.asset];
  if (!source) return res.status(404).end();
  try {
    let script = browserVendorCache.get(req.params.asset);
    if (!script) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(source.url, { signal: controller.signal, redirect: 'follow' });
        if (!response.ok) throw new Error(`Vendor download failed with HTTP ${response.status}`);
        const downloaded = Buffer.from(await response.arrayBuffer());
        const actualHash = vendorSha256(downloaded);
        if (actualHash !== source.sha256) {
          throw new Error(`Vendor integrity check failed for ${req.params.asset}`);
        }
        script = downloaded.toString('utf8');
      } finally {
        clearTimeout(timeout);
      }
      script = script
        .replace(/\n?\/\/# sourceMappingURL=.*$/gm, '')
        .replace(/\/\*# sourceMappingURL=[\s\S]*?\*\//g, '');
      browserVendorCache.set(req.params.asset, script);
    }
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(script);
  } catch (error) {
    error.status = 502;
    next(error);
  }
});

// In-Memory Database Store
const db = {
  term: "Academic Term 3: Active Session | Campus Hours: 07:00 - 17:30 SAST",
  users: [],
  schools: [],
  posts: [],
  schedules: [],
  worksheets: [],
  badges: [],
  tickets: [],
  attendance: [],
  staffTasks: [],
  staffLeave: [],
  teacherCover: [],
  performanceReviews: [],
  staffQualifications: [],
  staffDevelopmentPlans: [],
  emailInbox: [],
  emailDismissals: [],
  accountMigrations: {},
  diagnosticMigrations: {},
  staffNotices: [],
  meetingMinutes: [],
  maintenanceOrders: [],
  resourceBookings: [],
  purchaseRequests: [],
  broadcasts: [],
  campusVisitors: [],
  visitorMeetings: [],
  registry: [],
  moduleRecords: { finance: [], operations: [], care: [], engagement: [], dailyCare: [], portfolio: [], curriculum: [], supplies: [], stock: [], reports: [], safeguarding: [], absences: [], handovers: [], stickyNotes: [] },
  consentRecords: [],
  pickupLogs: [],
  reportReviews: [],
  releaseNotes: CURRENT_RELEASE_NOTES.map(note => ({ ...note })),
  chatGroups: [],
  groupMessages: {},
  directMessages: [],
  importAudit: [],
  importJobs: [],
  fileRecords: [],
  storageCleanupJobs: [],
  students: [],
  learnerAccessCodes: [],
  donations: [],
  storeProducts: [],
  storeOrders: [],
  parentPayments: [],
  parentSubscriptions: [],
  bookRegister: [],
  paymentEvents: [],
  paymentLedger: [],
  financeRecurringRules: [],
  financeAdjustments: [],
  financeReconciliationRuns: [],
  payrollProfiles: [],
  payrollRuns: [],
  subjectMarks: [],
  markHistory: [],
  reportCards: [],
  disciplineRecords: [],
  disciplineSettings: [],
  assetRegister: [],
  gradeRSkillAssessments: [],
  dsdIncidents: [],
  communicationCampaigns: [],
  attendanceAutomationSettings: [],
  eldaSkillCatalogue: [],
  eldaAssessments: [],
  aftercareSettings: [],
  aftercarePlans: [],
  aftercareSessions: [],
  staffClockSessions: [],
  staffRatioSettings: [],
  dayCareBookings: [],
  dayCareCapacitySettings: [],
  mealPlans: [],
  dietaryProfiles: [],
  learnerGroups: [],
  learnerSubjectAssignments: [],
  pickupPasses: [],
  academicAnalyticsSettings: [],
  schoolGroups: [],
  communicationTemplates: [],
  admissionsApplications: [],
  admissionsStatusHistory: [],
  documentAudit: [],
  systemErrors: [],
  schoolBilling: {},
  schoolTerms: {},
  subscriptionBilling: {
    pricing: { baseMonthly: 0, bundles: { 5: { costPrice: 0, sellingPrice: 0 }, 20: { costPrice: 0, sellingPrice: 0 }, 100: { costPrice: 0, sellingPrice: 0 } }, lateFeeEnabled: false, lateFee: 0 },
    payment: { method: 'payment_link', paymentLink: '', accountName: '', bankName: '', accountNumberEncrypted: '', branchCode: '', referencePrefix: 'LF' },
    orders: []
  }
};

// PostgreSQL is used whenever DATABASE_URL is configured (the production path).
// SQLite remains a local-development fallback; the JSON replica is a portable
// standby snapshot for the backup service.
const databaseFile = path.join(__dirname, 'littlefeet.db');
const replicaFile = path.join(__dirname, 'littlefeet-replica.json');
let replicaTimer = null;
let replicaRemoteTimer = null;
let replicaSnapshotTimer = null;
let stateDatabase = null;
let postgresPool = null;
let postgresSaveChain = Promise.resolve();
let postgresPersistenceSnapshot = new Map();
let replicaSnapshotVersion = '';
const objectStorage = createObjectStorage({ rootDir: __dirname });
let replicaTransportLoadError = null;
let replicaTransport;
try {
  const { createReplicaTransport } = require('./lib/operations/replica-transport');
  replicaTransport = createReplicaTransport();
} catch (error) {
  replicaTransportLoadError = error;
  replicaTransport = { configured: false, missing: ['replica transport module unavailable'], async load() { return null; }, async publish() { throw error; } };
}
if (replicaTransportLoadError) logStructured('error', 'replica.transport_module_unavailable', { category: 'replica', message: replicaTransportLoadError.message });
let replicaCapturedAt = '';
let replicaSourceSha = '';
let replicaPublishChain = Promise.resolve();
let replicaRemotePollInProgress = false;

class PostgresSessionStore extends session.Store {
  constructor() {
    super();
    this.cleanupTimer = setInterval(() => {
      if (postgresPool) postgresPool.query('DELETE FROM little_feet_sessions WHERE expires_at <= NOW()').catch(error => {
        logStructured('error', 'session.cleanup_failed', { category: 'session', message: error.message });
      });
    }, 15 * 60 * 1000);
    this.cleanupTimer.unref?.();
  }

  get(sessionId, callback) {
    postgresPool.query(
      'SELECT sess FROM little_feet_sessions WHERE sid = $1 AND expires_at > NOW()',
      [sessionId]
    ).then(result => callback(null, result.rows[0]?.sess || null)).catch(callback);
  }

  set(sessionId, sessionData, callback = () => {}) {
    const expiresAt = sessionData?.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 60 * 60 * 1000);
    postgresPool.query(`
      INSERT INTO little_feet_sessions (sid, sess, expires_at)
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT (sid) DO UPDATE SET sess = EXCLUDED.sess, expires_at = EXCLUDED.expires_at
    `, [sessionId, JSON.stringify(sessionData), expiresAt]).then(() => callback()).catch(callback);
  }

  destroy(sessionId, callback = () => {}) {
    postgresPool.query('DELETE FROM little_feet_sessions WHERE sid = $1', [sessionId])
      .then(() => callback()).catch(callback);
  }

  touch(sessionId, sessionData, callback = () => {}) {
    const expiresAt = sessionData?.cookie?.expires
      ? new Date(sessionData.cookie.expires)
      : new Date(Date.now() + 60 * 60 * 1000);
    postgresPool.query('UPDATE little_feet_sessions SET expires_at = $2 WHERE sid = $1', [sessionId, expiresAt])
      .then(() => callback()).catch(callback);
  }
}

const LOGIN_HUMAN_CHECK_TTL_MS = 5 * 60 * 1000;
const LOGIN_HUMAN_CHECK_USED_MAX = 10000;
const usedLoginHumanChecks = new Map();
const loginHumanCheckRequired = accountsHelpers.loginHumanCheckRequired;
const loginHumanCheckKey = crypto.createHash('sha256')
  .update(`${process.env.SESSION_SECRET || 'little-feet-session-secret'}\nlogin-human-check-v2`)
  .digest();
const loginHumanCheckClientHash = accountsHelpers.loginHumanCheckClientHash;
const loginHumanCheckSignature = filesHelpers.loginHumanCheckSignature;

const pruneUsedLoginHumanChecks = accountsHelpers.pruneUsedLoginHumanChecks;

const issueLoginHumanCheck = accountsHelpers.issueLoginHumanCheck;

const verifyLoginHumanCheck = accountsHelpers.verifyLoginHumanCheck;

// Serve this before express-session so the login page does not wait for the
// database-backed session store just to display the human-verification prompt.
authRoutes.registerAuthHumanCheckRoutes(app, routeContext);

app.use(session({
  store: process.env.DATABASE_URL ? new PostgresSessionStore() : undefined,
  secret: process.env.SESSION_SECRET || 'little-feet-session-secret',
  name: 'littlefeet.sid',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: isProduction,
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60 * 60 * 1000
  }
}));
app.use((req, res, next) => {
  const enforceOriginCheck = isProduction || process.env.LF_TEST_ENFORCE_ORIGIN === '1';
  if (!enforceOriginCheck || !req.session?.littleFeetUser || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return res.status(403).json({ message: 'A same-origin browser request is required.' });
  try {
    const sourceUrl = new URL(source);
    const configuredOrigins = String(process.env.LF_ALLOWED_BROWSER_ORIGINS || '').split(',').map(value => {
      try { return new URL(value.trim()).origin; } catch { return ''; }
    }).filter(Boolean);
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const canonicalOriginAllowed = sourceUrl.protocol === 'https:' && configuredOrigins.includes(sourceUrl.origin);
    if ((sourceUrl.origin !== requestOrigin && !canonicalOriginAllowed) || sourceUrl.protocol !== `${req.protocol}:`) {
      return res.status(403).json({ message: 'Cross-origin state changes are not allowed.' });
    }
  } catch {
    return res.status(403).json({ message: 'Invalid request origin.' });
  }
  next();
});

const DUPLICATE_POST_EXEMPT_PATHS = new Set([
  '/api/login',
  '/api/auth/logout',
  '/api/email/inbound/resend',
  '/api/email/mailbox/sync',
  '/api/payments/webhook',
  '/api/payments/payfast/itn',
  '/api/payments/reconcile',
  '/api/company/billing/reconcile',
  '/api/finance/recurring-runs',
  '/api/finance/reconciliation/apply',
  '/api/students/import',
  '/api/learner-access-codes/generate-batch',
  '/api/attendance/toggle'
]);
const duplicatePostIsHandledByRoute = validationHelpers.duplicatePostIsHandledByRoute;
app.use('/api', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const requestPath = String(req.originalUrl || '').split('?')[0];
  if (duplicatePostIsHandledByRoute(requestPath)) return next();

  const actorKey = normalizeUsername(req.session?.littleFeetUser?.username || '') || String(req.ip || 'anonymous');
  const bodyHash = crypto.createHash('sha256').update(JSON.stringify(req.body || {})).digest('hex');
  const fingerprint = crypto.createHash('sha256')
    .update(`${actorKey}\n${requestPath}\n${bodyHash}`)
    .digest('hex');
  const now = Date.now();
  const previous = recentPostFingerprints.get(fingerprint);
  const duplicateStillActive = previous && !previous.completedAt && now - previous.startedAt < 60 * 1000;
  const duplicateRecentlyCompleted = previous?.completedAt && now - previous.completedAt < DUPLICATE_POST_WINDOW_MS;
  if (duplicateStillActive || duplicateRecentlyCompleted) {
    res.setHeader('Retry-After', '2');
    return res.status(409).json({
      message: 'This action is already being processed. Please wait a moment before trying again.',
      requestId: req.requestId
    });
  }

  const entry = { startedAt: now, completedAt: null };
  recentPostFingerprints.set(fingerprint, entry);
  res.on('finish', () => {
    if (recentPostFingerprints.get(fingerprint) !== entry) return;
    if (res.statusCode >= 400) recentPostFingerprints.delete(fingerprint);
    else entry.completedAt = Date.now();
  });

  for (const [key, value] of recentPostFingerprints) {
    const staleActive = !value.completedAt && now - value.startedAt >= 60 * 1000;
    const staleCompleted = value.completedAt && now - value.completedAt >= DUPLICATE_POST_WINDOW_MS;
    if (staleActive || staleCompleted) recentPostFingerprints.delete(key);
    if (recentPostFingerprints.size <= 5000) break;
  }
  while (recentPostFingerprints.size > 5000) {
    recentPostFingerprints.delete(recentPostFingerprints.keys().next().value);
  }
  next();
});

const persistenceHash = validationHelpers.persistenceHash;
const persistenceRecordKey = validationHelpers.persistenceRecordKey;
const flattenPersistentState = validationHelpers.flattenPersistentState;

function openStateDatabase() {
  if (readOnlySnapshotMode) return;
  stateDatabase = new Database(databaseFile);
  stateDatabase.pragma('journal_mode = WAL');
  stateDatabase.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      state_key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

async function openPostgresDatabase() {
  const connectionUrl = new URL(process.env.DATABASE_URL);
  const explicitSslMode = process.env.PGSSLMODE || connectionUrl.searchParams.get('sslmode');
  const defaultSslMode = String(process.env.RENDER || '').toLowerCase() === 'true' ? 'require' : 'verify-full';
  const sslMode = String(explicitSslMode || defaultSslMode).toLowerCase();
  const tlsFile = name => {
    const filename = connectionUrl.searchParams.get(name);
    return filename ? fs.readFileSync(filename, 'utf8') : undefined;
  };
  const configuredCa = process.env.LF_POSTGRES_CA_CERT
    ? String(process.env.LF_POSTGRES_CA_CERT).replace(/\\n/g, '\n')
    : connectionUrl.searchParams.has('sslrootcert')
      ? tlsFile('sslrootcert')
      : undefined;
  const ssl = sslMode === 'disable' || connectionUrl.searchParams.get('ssl') === 'false' ? false : {
    // PostgreSQL sslmode=require guarantees encryption but does not require
    // certificate verification. Render's private Postgres endpoints use
    // self-signed certificates and explicitly support sslmode=require.
    // Keep verification enabled for every stricter/default mode and whenever
    // a CA has been supplied.
    rejectUnauthorized: Boolean(configuredCa) || sslMode !== 'require',
    ...(configuredCa ? { ca: configuredCa } : {}),
    ...(connectionUrl.searchParams.has('sslcert') ? { cert: tlsFile('sslcert') } : {}),
    ...(connectionUrl.searchParams.has('sslkey') ? { key: tlsFile('sslkey') } : {})
  };
  // URL SSL parameters otherwise replace pg's explicit TLS options. Resolve
  // them above so sslmode=require cannot silently remove verification or a CA.
  ['sslmode', 'ssl', 'sslrootcert', 'sslcert', 'sslkey'].forEach(name => connectionUrl.searchParams.delete(name));
  postgresPool = new Pool({
    connectionString: connectionUrl.toString(),
    ssl,
    // Keep enough database headroom for Render's rolling deploy overlap and
    // the isolated recovery job. The production session pool allows 15
    // clients, so two briefly concurrent web instances must stay below it.
    max: Math.max(2, Math.min(6, Number(process.env.PG_POOL_MAX) || 5)),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    allowExitOnIdle: false
  });
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS little_feet_app_state (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await postgresPool.query(`
    CREATE TABLE IF NOT EXISTS little_feet_records (
      collection TEXT NOT NULL,
      record_key TEXT NOT NULL,
      school_id TEXT NOT NULL DEFAULT '',
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (collection, record_key)
    );
    CREATE INDEX IF NOT EXISTS little_feet_records_school_collection_idx
      ON little_feet_records (school_id, collection);
    CREATE TABLE IF NOT EXISTS little_feet_metadata (
      state_key TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS little_feet_sessions (
      sid TEXT PRIMARY KEY,
      sess JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS little_feet_sessions_expiry_idx
      ON little_feet_sessions (expires_at)
  `);
}

function applySavedState(saved) {
  if (!saved || typeof saved !== 'object') return false;
  const moduleDefaults = db.moduleRecords;
  Object.keys(db).forEach(key => {
    if (key !== 'moduleRecords' && Object.hasOwn(saved, key)) db[key] = saved[key];
  });
  if (Object.hasOwn(saved, 'moduleRecords')) db.moduleRecords = { ...moduleDefaults, ...(saved.moduleRecords || {}) };
  syncCurrentReleaseNotes();
  removeLegacyDemoRecords();
  migrateSchoolTenancy();
  migrateSchoolSubscriptionTrials();
  migrateSensitiveStoredFields();
  return true;
}

function syncCurrentReleaseNotes() {
  db.releaseNotes = CURRENT_RELEASE_NOTES.map(note => ({ ...note })).sort((first, second) => {
    const dateDifference = Date.parse(second.publishedAt || '') - Date.parse(first.publishedAt || '');
    return Number.isFinite(dateDifference) && dateDifference !== 0
      ? dateDifference
      : String(second.version || '').localeCompare(String(first.version || ''), undefined, { numeric: true });
  });
}

function migrateSchoolTenancy() {
  if (!Array.isArray(db.schools)) db.schools = [];
  // These indexes live only for this migration pass, so reloads and renames
  // cannot leave behind a stale cross-request tenancy cache.
  const schoolsById = new Map();
  const schoolsByName = new Map();
  const rememberSchool = school => {
    if (!schoolsById.has(school.id)) schoolsById.set(school.id, school);
    const key = schoolKey(school.name);
    if (!schoolsByName.has(key)) schoolsByName.set(key, school);
  };
  db.schools.forEach(rememberSchool);
  const resolveMigrationSchool = name => {
    const key = schoolKey(String(name || '').trim() || 'Your School');
    let school = schoolsByName.get(key);
    if (!school) { school = ensureSchool(name); rememberSchool(school); }
    return school;
  };
  db.users.forEach(account => {
    if (PLATFORM_INTERNAL_ROLES.has(account.role) && !String(account.schoolName || '').trim() && !String(account.schoolId || '').trim()) {
      account.schoolId = '';
      account.schoolName = '';
      return;
    }
    const school = schoolsById.get(account.schoolId) || resolveMigrationSchool(account.schoolName);
    account.schoolId = account.schoolId || school.id;
    account.schoolName = school.name;
  });
  const defaultSchoolId = db.users.find(account => account.role === 'admin')?.schoolId || db.users[0]?.schoolId || resolveMigrationSchool('Your School').id;
  const collections = ['posts', 'schedules', 'worksheets', 'badges', 'tickets', 'attendance', 'staffTasks', 'staffLeave', 'teacherCover', 'performanceReviews', 'staffQualifications', 'staffDevelopmentPlans', 'emailInbox', 'emailDismissals', 'staffNotices', 'meetingMinutes', 'maintenanceOrders', 'resourceBookings', 'purchaseRequests', 'broadcasts', 'campusVisitors', 'visitorMeetings', 'registry', 'consentRecords', 'pickupLogs', 'reportReviews', 'learnerAccessCodes', 'storeProducts', 'storeOrders', 'parentPayments', 'parentSubscriptions', 'bookRegister', 'paymentEvents', 'paymentLedger', 'financeRecurringRules', 'financeAdjustments', 'financeReconciliationRuns', 'payrollProfiles', 'payrollRuns', 'subjectMarks', 'markHistory', 'reportCards', 'disciplineRecords', 'disciplineSettings', 'assetRegister', 'gradeRSkillAssessments', 'dsdIncidents', 'communicationCampaigns', 'attendanceAutomationSettings', 'eldaSkillCatalogue', 'eldaAssessments', 'aftercareSettings', 'aftercarePlans', 'aftercareSessions', 'staffClockSessions', 'staffRatioSettings', 'dayCareBookings', 'dayCareCapacitySettings', 'mealPlans', 'dietaryProfiles', 'learnerGroups', 'learnerSubjectAssignments', 'pickupPasses', 'academicAnalyticsSettings', 'communicationTemplates', 'admissionsApplications', 'admissionsStatusHistory', 'documentAudit', 'systemErrors', 'importAudit', 'importJobs', 'fileRecords', 'storageCleanupJobs', 'chatGroups', 'directMessages'];
  collections.forEach(collection => {
    if (!Array.isArray(db[collection])) db[collection] = [];
    db[collection].forEach(record => {
      if (!record.schoolId && record.companyScope !== true) record.schoolId = record.schoolName ? resolveMigrationSchool(record.schoolName).id : defaultSchoolId;
    });
  });
  Object.values(db.moduleRecords || {}).forEach(records => (records || []).forEach(record => {
    if (!record.schoolId && record.companyScope !== true) record.schoolId = record.schoolName ? resolveMigrationSchool(record.schoolName).id : defaultSchoolId;
  }));
  db.students.forEach(record => { if (!record.schoolId) record.schoolId = defaultSchoolId; });
  if (!db.schoolTerms || typeof db.schoolTerms !== 'object') db.schoolTerms = {};
  if (!db.schoolTerms[defaultSchoolId]) db.schoolTerms[defaultSchoolId] = db.term;
  if (!db.schoolBilling || typeof db.schoolBilling !== 'object') db.schoolBilling = {};
  if (!db.schoolBilling[defaultSchoolId] && db.subscriptionBilling) db.schoolBilling[defaultSchoolId] = db.subscriptionBilling;
}

function migrateSchoolSubscriptionTrials() {
  if (!Array.isArray(db.schools)) db.schools = [];
  const now = Date.now();
  const trialMs = 14 * 24 * 60 * 60 * 1000;
  db.schools.forEach(school => {
    if (!school || typeof school !== 'object') return;
    if (school.subscriptionStatus === 'trial_pending') return;
    if (!school.subscriptionStatus) school.subscriptionStatus = 'trial';
    if (school.trialStartedAt && Number.isFinite(Date.parse(school.trialEndsAt || ''))) return;
    const createdAtMs = Date.parse(school.createdAt || '');
    const startMs = Number.isFinite(createdAtMs) && createdAtMs >= now - trialMs ? createdAtMs : now;
    school.trialStartedAt = new Date(startMs).toISOString();
    school.trialEndsAt = new Date(startMs + trialMs).toISOString();
  });
}

function migrateSensitiveStoredFields() {
  const registryFields = ['dateOfBirth', 'guardianPhone', 'guardianEmail', 'address', 'emergencyContact', 'medicalNotes'];
  (db.registry || []).forEach(record => {
    registryFields.forEach(field => {
      if (record[field] !== undefined && record[field] !== null && record[field] !== '') record[field] = encryptStoredField(record[field]);
    });
  });
  (db.reportReviews || []).forEach(report => {
    if (report.teacherSignature) report.teacherSignature = encryptStoredField(report.teacherSignature);
    if (report.parentSignature) report.parentSignature = encryptStoredField(report.parentSignature);
  });
}

function removeLegacyDemoRecords() {
  const demoUsernames = new Set(['admin@gmail.com', 'teacher@gmail.com', 'parent@gmail.com', 'principle@gmail.com', 'district@gmail.com']);
  db.users = db.users.filter(account => !demoUsernames.has(normalizeUsername(account.username)));
  db.students = db.students.filter(student => !(
    (student.studentName === 'Liam Smith' && normalizeUsername(student.contactEmail) === 'parent@gmail.com')
    || (student.studentName === 'Emma Watson' && normalizeUsername(student.contactEmail) === 'teacher@gmail.com')
  ));
  db.posts = db.posts.filter(post => post.caption !== 'Welcome to our updated Little Feet ECD & High School Learning Portal!');
  db.chatGroups = db.chatGroups.filter(group => !['general', 'toddlers'].includes(group.id));
  delete db.groupMessages.general;
  delete db.groupMessages.toddlers;
  db.directMessages = db.directMessages.filter(message => !demoUsernames.has(normalizeUsername(message.sender)) && !demoUsernames.has(normalizeUsername(message.recipient)));
  const obsoleteStickyErrorTickets = new Set(db.tickets.filter(ticket =>
    ticket.subject === 'Automatic error report: WEB_RUNTIME_ERROR'
    && /saveStickyNote is not defined/i.test(String(ticket.message || ticket.feedback || ''))
  ).map(ticket => ticket.id));
  if (obsoleteStickyErrorTickets.size) {
    db.tickets = db.tickets.filter(ticket => !obsoleteStickyErrorTickets.has(ticket.id));
    db.emailInbox = (db.emailInbox || []).filter(item => !(item.type === 'Ticket' && obsoleteStickyErrorTickets.has(item.sourceId)));
  }
}

async function loadDatabaseState() {
  if (postgresPool) {
    try {
      const normalizedCount = await postgresPool.query('SELECT COUNT(*)::int AS count FROM little_feet_records');
      const metadataCount = await postgresPool.query('SELECT COUNT(*)::int AS count FROM little_feet_metadata');
      if (normalizedCount.rows[0].count || metadataCount.rows[0].count) {
        const [recordResult, metadataResult] = await Promise.all([
          postgresPool.query('SELECT collection, record_key, school_id, payload FROM little_feet_records ORDER BY collection, record_key'),
          postgresPool.query('SELECT state_key, payload FROM little_feet_metadata ORDER BY state_key')
        ]);
        const saved = {};
        postgresPersistenceSnapshot = new Map();
        recordResult.rows.forEach(row => {
          const [kind, name] = row.collection.split(':', 2);
          if (kind === 'array') (saved[name] ||= []).push(row.payload);
          else if (kind === 'module') ((saved.moduleRecords ||= {})[name] ||= []).push(row.payload);
          else if (kind === 'group') ((saved.groupMessages ||= {})[name] ||= []).push(row.payload);
          postgresPersistenceSnapshot.set(`record:${row.collection}\u0000${row.record_key}`, persistenceHash(row.payload));
        });
        metadataResult.rows.forEach(row => {
          if (row.state_key.startsWith('schoolBilling:')) (saved.schoolBilling ||= {})[row.state_key.slice(14)] = row.payload;
          else if (row.state_key.startsWith('schoolTerms:')) (saved.schoolTerms ||= {})[row.state_key.slice(12)] = row.payload;
          else saved[row.state_key] = row.payload;
          postgresPersistenceSnapshot.set(`metadata:${row.state_key}`, persistenceHash(row.payload));
        });
        return applySavedState(saved);
      }
      const result = await postgresPool.query('SELECT payload FROM little_feet_app_state WHERE state_key = $1', ['primary']);
      return result.rowCount ? applySavedState(result.rows[0].payload) : false;
    } catch (error) {
      logStructured('error', 'persistence.postgres_load_failed', { category: 'persistence', message: error.message });
      throw error;
    }
  }
  if (!stateDatabase) return false;
  try {
    const row = stateDatabase.prepare('SELECT payload FROM app_state WHERE state_key = ?').get('primary');
    if (!row) return false;
    return applySavedState(JSON.parse(row.payload));
  } catch (error) {
    logStructured('error', 'persistence.sqlite_load_failed', { category: 'persistence', message: error.message });
    return false;
  }
}

async function saveDatabaseState() {
  if (readOnlySnapshotMode) return;
  if (postgresPool) {
    postgresSaveChain = postgresSaveChain.catch(() => {}).then(async () => {
      const { records, metadata } = flattenPersistentState();
      const nextSnapshot = new Map();
      const client = await postgresPool.connect();
      try {
        await client.query('BEGIN');
        for (const [compositeKey, entry] of records) {
          const snapshotKey = `record:${compositeKey}`;
          const hash = persistenceHash(entry.payload);
          nextSnapshot.set(snapshotKey, hash);
          if (postgresPersistenceSnapshot.get(snapshotKey) === hash) continue;
          await client.query(`INSERT INTO little_feet_records (collection, record_key, school_id, payload, updated_at)
            VALUES ($1, $2, $3, $4::jsonb, NOW()) ON CONFLICT (collection, record_key) DO UPDATE SET
            school_id = EXCLUDED.school_id, payload = EXCLUDED.payload, updated_at = NOW()`,
          [entry.collection, entry.recordKey, entry.schoolId, JSON.stringify(entry.payload)]);
        }
        for (const [stateKey, payload] of metadata) {
          const snapshotKey = `metadata:${stateKey}`;
          const hash = persistenceHash(payload);
          nextSnapshot.set(snapshotKey, hash);
          if (postgresPersistenceSnapshot.get(snapshotKey) === hash) continue;
          await client.query(`INSERT INTO little_feet_metadata (state_key, payload, updated_at)
            VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (state_key) DO UPDATE SET payload = EXCLUDED.payload, updated_at = NOW()`,
          [stateKey, JSON.stringify(payload)]);
        }
        for (const snapshotKey of postgresPersistenceSnapshot.keys()) {
          if (nextSnapshot.has(snapshotKey)) continue;
          if (snapshotKey.startsWith('record:')) {
            const [collection, recordKey] = snapshotKey.slice(7).split('\u0000');
            await client.query('DELETE FROM little_feet_records WHERE collection = $1 AND record_key = $2', [collection, recordKey]);
          } else if (snapshotKey.startsWith('metadata:')) {
            await client.query('DELETE FROM little_feet_metadata WHERE state_key = $1', [snapshotKey.slice(9)]);
          }
        }
        await client.query('COMMIT');
        postgresPersistenceSnapshot = nextSnapshot;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        logStructured('error', 'persistence.postgres_save_failed', { category: 'persistence', message: error.message });
        throw error;
      } finally {
        client.release();
      }
    });
    return postgresSaveChain.then(() => { scheduleReplicaSnapshot(); });
  }
  if (!stateDatabase) return;
  try {
    stateDatabase.prepare(`
      INSERT INTO app_state (state_key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(state_key) DO UPDATE SET
        payload = excluded.payload,
        updated_at = excluded.updated_at
    `).run('primary', JSON.stringify(db), new Date().toISOString());
    scheduleReplicaSnapshot();
  } catch (error) {
    logStructured('error', 'persistence.sqlite_save_failed', { category: 'persistence', message: error.message });
    throw error;
  }
}
const queueStorageCleanup = filesHelpers.queueStorageCleanup;
const runStorageCleanupJob = filesHelpers.runStorageCleanupJob;
const retryPendingStorageCleanup = filesHelpers.retryPendingStorageCleanup;
function loadReplicaSnapshot() {
  try {
    if (!fs.existsSync(replicaFile)) return;
    const snapshotStat = fs.statSync(replicaFile);
    const snapshotVersion = `${snapshotStat.mtimeMs}:${snapshotStat.size}`;
    if (snapshotVersion === replicaSnapshotVersion) return;
    const saved = JSON.parse(fs.readFileSync(replicaFile, 'utf8'));
    if (replicaCapturedAt && Number.isFinite(Date.parse(saved.replicatedAt))
      && Date.parse(saved.replicatedAt) < Date.parse(replicaCapturedAt)) return;
    if (applySavedState(saved)) {
      replicaSnapshotVersion = snapshotVersion;
      if (Number.isFinite(Date.parse(saved.replicatedAt))) replicaCapturedAt = new Date(saved.replicatedAt).toISOString();
    }
  } catch (error) {
    logStructured('error', 'replica.snapshot_load_failed', { category: 'replica', message: error.message });
  }
}
async function loadRemoteReplicaSnapshot() {
  if (!replicaMode || !replicaTransport.configured || replicaRemotePollInProgress) return;
  replicaRemotePollInProgress = true;
  try {
    const snapshot = await replicaTransport.load();
    if (!snapshot || snapshot.capturedAt === replicaCapturedAt) return;
    if (replicaCapturedAt && Date.parse(snapshot.capturedAt) < Date.parse(replicaCapturedAt)) return;
    if (!applySavedState({ ...snapshot.state, replicatedAt: snapshot.capturedAt })) throw new Error('Remote replica snapshot could not be applied.');
    replicaCapturedAt = snapshot.capturedAt;
    replicaSourceSha = snapshot.applicationSha;
    logStructured('info', 'replica.remote_snapshot_loaded', {
      category: 'replica', result: 'success', details: `Loaded encrypted snapshot from ${snapshot.applicationSha}; captured ${snapshot.capturedAt}.`
    });
  } catch (error) {
    logStructured('error', 'replica.remote_snapshot_load_failed', { category: 'replica', message: error.message });
  } finally {
    replicaRemotePollInProgress = false;
  }
}
function writeReplicaSnapshot() {
  if (replicaMode) return;
  try {
    const stagingFile = `${replicaFile}.next`;
    fs.writeFileSync(stagingFile, JSON.stringify({ ...db, replicatedAt: new Date().toISOString() }), 'utf8');
    fs.renameSync(stagingFile, replicaFile);
    const snapshot = { ...db, replicatedAt: new Date().toISOString() };
    if (replicaTransport.configured) {
      replicaPublishChain = replicaPublishChain.catch(() => {}).then(() => replicaTransport.publish(snapshot, {
        applicationSha: applicationSha || 'unrecorded'
      })).then(result => {
        replicaCapturedAt = result.capturedAt;
        replicaSourceSha = applicationSha || 'unrecorded';
        logStructured('info', 'replica.remote_snapshot_published', {
          category: 'replica', result: 'success', details: `Encrypted standby snapshot published (${result.bytes} bytes).`
        });
      }).catch(error => {
        logStructured('error', 'replica.remote_snapshot_publish_failed', { category: 'replica', message: error.message });
      });
    }
  } catch (error) {
    logStructured('error', 'replica.snapshot_write_failed', { category: 'replica', message: error.message });
  }
}
function ensureBootstrapAdministrator() {
  if (db.users.some(account => account.role === 'admin')) return;
  const username = String(process.env.LF_BOOTSTRAP_ADMIN_USERNAME || '').trim();
  const pin = String(process.env.LF_BOOTSTRAP_ADMIN_PIN || '');
  if (!username || !pin) {
    logStructured('warn', 'bootstrap.admin_missing', { category: 'configuration', message: 'No administrator account exists. Set LF_BOOTSTRAP_ADMIN_USERNAME and LF_BOOTSTRAP_ADMIN_PIN to create the first real school administrator.' });
    return;
  }
  db.users.push({
    username,
    pinHash: hashPin(pin),
    name: String(process.env.LF_BOOTSTRAP_ADMIN_NAME || 'School Administrator').trim(),
    role: 'admin',
    schoolName: String(process.env.LF_BOOTSTRAP_SCHOOL_NAME || 'Your School').trim(),
    schoolStoreUrl: '',
    verificationStatus: 'Active',
    createdAt: new Date().toISOString()
  });
}
const DIAGNOSTIC_HISTORY_RESET_ID = 'inspect-clean-slate-20261001-v1';
function applyDiagnosticHistoryResetMigration() {
  if (!db.diagnosticMigrations || typeof db.diagnosticMigrations !== 'object' || Array.isArray(db.diagnosticMigrations)) db.diagnosticMigrations = {};
  if (db.diagnosticMigrations[DIAGNOSTIC_HISTORY_RESET_ID]) return false;
  if (!Array.isArray(db.systemErrors)) db.systemErrors = [];
  const removedPersistentFaults = db.systemErrors.length;
  const removedRuntimeLogs = structuredLogger.clear();
  db.systemErrors = [];
  db.diagnosticMigrations[DIAGNOSTIC_HISTORY_RESET_ID] = {
    appliedAt: new Date().toISOString(),
    removedPersistentFaults,
    removedRuntimeLogs
  };
  return true;
}

function applyOwnerAccountMigration() {
  if (process.env.LF_OWNER_RESET_ALL_ACCOUNTS !== '1') return false;
  const migrationId = String(process.env.LF_OWNER_ACCOUNT_RESET_ID || '').trim().slice(0, 120);
  const username = String(process.env.LF_OWNER_ADMIN_USERNAME || '').trim().slice(0, 160);
  const pin = String(process.env.LF_OWNER_ADMIN_PIN || '');
  const name = String(process.env.LF_OWNER_ADMIN_NAME || '').trim().slice(0, 160);
  if (!migrationId || !username || !name || pin.length < 4 || pin.length > 128) {
    throw new Error('LF_OWNER_RESET_ALL_ACCOUNTS requires a reset ID, owner username, owner name, and a 4-128 character owner PIN/password.');
  }
  if (!db.accountMigrations || typeof db.accountMigrations !== 'object' || Array.isArray(db.accountMigrations)) db.accountMigrations = {};
  if (db.accountMigrations[migrationId]) return false;

  const anchor = db.users.find(account => account.role === 'admin') || db.users[0];
  const requestedSchoolName = String(process.env.LF_OWNER_SCHOOL_NAME || '').trim().slice(0, 160);
  const anchorSchool = anchor && db.schools.find(school => school.id === accountSchoolId(anchor));
  const school = anchorSchool || db.schools.find(item => schoolKey(item.name) === schoolKey(requestedSchoolName))
    || ensureSchool(requestedSchoolName || anchor?.schoolName || 'Little Feet');
  const removedUsernames = new Set(db.users.map(account => normalizeUsername(account.username)).filter(value => value && value !== normalizeUsername(username)));
  const removedStaffFiles = (db.fileRecords || []).filter(file => file.entityType === 'staff'
    && removedUsernames.has(normalizeUsername(file.recordId)) && file.accessState !== 'deleted');
  const filesBySchool = new Map();
  removedStaffFiles.forEach(file => {
    const schoolId = String(file.schoolId || 'unassigned');
    if (!filesBySchool.has(schoolId)) filesBySchool.set(schoolId, []);
    filesBySchool.get(schoolId).push(file);
  });
  filesBySchool.forEach((files, schoolId) => queueStorageCleanup(schoolId, files, `owner-account-reset:${migrationId}`));
  const deletedAt = new Date().toISOString();
  removedStaffFiles.forEach(file => { file.accessState = 'deleted'; file.deletedAt = deletedAt; file.deletedBy = username; });

  db.users = [{
    username,
    pinHash: hashPin(pin),
    name,
    role: 'admin',
    schoolId: school.id,
    schoolName: requestedSchoolName || school.name,
    schoolStoreUrl: '',
    verificationStatus: 'Active',
    createdAt: new Date().toISOString()
  }];
  db.accountMigrations[migrationId] = { appliedAt: new Date().toISOString(), ownerUsername: username, removedAccounts: removedUsernames.size };
  logStructured('info', 'account.owner_reset_applied', { category: 'migration', result: 'completed', details: `Migration ${migrationId}; removed ${removedUsernames.size} previous account(s).` });
  return true;
}
function removeLegacyMailboxConnections() {
  let removed = 0;
  (db.users || []).forEach(account => {
    if (!account?.mailboxConnection) return;
    if (account.mailboxConnection.version === 2 && MAILBOX_PROVIDERS.has(account.mailboxConnection.provider)) return;
    delete account.mailboxConnection;
    removed += 1;
  });
  if (removed) logStructured('info', 'mailbox.legacy_connections_removed', { category: 'migration', result: 'completed', details: `Removed ${removed} obsolete mailbox connection record(s).` });
  return removed;
}

function syncConfiguredPlatformOwnerAccess() {
  const ownerUsername = configuredPlatformOwnerUsername();
  let owner = ownerUsername ? db.users.find(account => normalizeUsername(account.username) === ownerUsername) : null;
  // Safe first-run fallback: if no owner username is configured yet and the
  // installation has exactly one administrator, that founding administrator
  // becomes the platform owner. Once set, the persisted platformAccess flag
  // keeps the ownership capability explicit rather than depending on a name.
  if (!owner) {
    const administrators = db.users.filter(account => account.role === 'admin');
    if (!ownerUsername && administrators.length === 1) owner = administrators[0];
  }
  if (!owner) return false;
  owner.role = 'admin';
  owner.platformAccess = true;
  owner.verificationStatus = 'Active';
  return true;
}

function scheduleReplicaSnapshot() {
  if (replicaMode || replicaSnapshotTimer) return;
  replicaSnapshotTimer = setTimeout(() => {
    replicaSnapshotTimer = null;
    writeReplicaSnapshot();
  }, 250);
}
async function initialisePersistence() {
  if (readOnlySnapshotMode) {
    loadReplicaSnapshot();
    if (!replicaTransport.configured) {
      logStructured('warn', 'replica.remote_transport_unconfigured', {
        category: 'configuration', details: `Standby is limited to a local snapshot. Missing: ${replicaTransport.missing.join(', ')}.`
      });
    } else {
      void loadRemoteReplicaSnapshot();
      replicaRemoteTimer = setInterval(() => { void loadRemoteReplicaSnapshot(); }, 10000);
    }
    replicaTimer = setInterval(loadReplicaSnapshot, 2000);
    return;
  }
  if (process.env.DATABASE_URL) await openPostgresDatabase();
  else openStateDatabase();
  const restoredFromDatabase = await loadDatabaseState();
  if (sharedDatabaseFailover) {
    if (!restoredFromDatabase) throw new Error('Shared-database standby refused startup because the primary Little Feet database contains no persisted state.');
    logStructured('info', 'failover.shared_database_standby_ready', {
      category: 'failover', result: 'ready', details: 'Standby uses the authoritative PostgreSQL database; writes are serialized by the shared advisory lock.'
    });
    let sharedStateRefreshInProgress = false;
    const sharedStateRefreshTimer = setInterval(() => {
      if (activeSharedDatabaseMutations > 0 || sharedStateRefreshInProgress || !postgresPool) return;
      sharedStateRefreshInProgress = true;
      void withPersistentMutation(() => {}).catch(error => {
        logStructured('error', 'failover.shared_database_refresh_failed', { category: 'failover', message: error.message });
      }).finally(() => { sharedStateRefreshInProgress = false; });
    }, 3000);
    sharedStateRefreshTimer.unref?.();
    return;
  }
  if (!restoredFromDatabase) loadReplicaSnapshot();
  const diagnosticHistoryResetApplied = applyDiagnosticHistoryResetMigration();
  const ownerAccountResetApplied = applyOwnerAccountMigration();
  ensureBootstrapAdministrator();
  syncConfiguredPlatformOwnerAccess();
  migrateSchoolTenancy();
  migrateSchoolSubscriptionTrials();
  migrateSensitiveStoredFields();
  removeLegacyMailboxConnections();
  ensureAllLearnersHaveAccessCodes();
  syncCurrentReleaseNotes();
  await retryPendingStorageCleanup();
  await saveDatabaseState();
  if (diagnosticHistoryResetApplied) {
    logStructured('info', 'inspection.history_reset_applied', {
      category: 'migration',
      result: 'completed',
      message: 'Previous Inspect diagnostic history was cleared for the centralized logging clean slate.'
    });
  }
  if (ownerAccountResetApplied && postgresPool) await postgresPool.query('DELETE FROM little_feet_sessions');
  // saveDatabaseState already queued a debounced snapshot. Cancel it before the
  // immediate startup publish so an unchanged state is not uploaded twice.
  if (replicaSnapshotTimer) {
    clearTimeout(replicaSnapshotTimer);
    replicaSnapshotTimer = null;
  }
  writeReplicaSnapshot();
}

persistenceReady = initialisePersistence();

// API Endpoints
// Auth
const establishAuthenticatedSession = accountsHelpers.establishAuthenticatedSession;

authRoutes.registerLoginRoutes(app, routeContext);

// Health check
healthRoutes.registerFailoverReadinessRoutes(app, routeContext);


// A lightweight heartbeat used by the repository's free scheduled monitor. It
// touches the configured datastore so both the web service and a free pilot
// PostgreSQL project remain active without exposing application records.


const runtimeReadiness = diagnosticsHelpers.runtimeReadiness;

// A separate readiness endpoint lets hosting monitor liveness without treating
// a missing production secret as a healthy, launch-ready configuration.
healthRoutes.registerReadyRoutes(app, routeContext);



// Public self-registration is intentionally limited to school-facing roles.
authRoutes.registerSignupRoutes(app, routeContext);

const safeAccount = accountsHelpers.safeAccount;
const getSessionAccount = accountsHelpers.getSessionAccount;
const requireAdmin = accountsHelpers.requireAdmin;
const requireAccountManager = accountsHelpers.requireAccountManager;
const requireSchoolStaff = tenancyHelpers.requireSchoolStaff;
const requireCompanyStaff = accountsHelpers.requireCompanyStaff;
const SCHOOL_SUBSCRIPTION_EXEMPT_API_PREFIXES = Object.freeze([
  '/api/auth/', '/api/subscription-billing', '/api/payments/', '/api/release-notes',
  '/api/account-deletion-request', '/api/system/client-log'
]);
app.use('/api', (req, res, next) => {
  const pathOnly = String(req.originalUrl || '').split('?')[0];
  const employee = getSessionAccount(req);
  if (['school_staff','school_hr'].includes(employee?.role)) {
    const personal = /^\/api\/(?:auth\/|email\/(?!inbound\/)|chat\/|release-notes$|system\/client-log$|staff\/(?:directory|tasks|leave|qualifications|kpi-history|kpi-monthly|development-plans|performance-reviews)(?:\/|$)|tickets(?:\/|$)|account-deletion-request$)/.test(pathOnly);
    if (!personal) return res.status(403).json({message:'This position has access to staff work and communication only.'});
  }

  if (employee && PLATFORM_INTERNAL_ROLES.has(employee.role)) {
    // Deny by default even when a legacy employee has platformAccess stored as true.
    const common = /^\/api\/(?:auth\/|email\/(?!inbound\/)|chat\/|release-notes$|system\/client-log$|staff\/(?:directory|tasks|leave|qualifications|kpi-history|kpi-monthly|development-plans|performance-reviews)(?:\/|$)|tickets(?:\/|$)|account-deletion-request$)/.test(pathOnly);
    const job = (employee.role === 'crm' && /^\/api\/company\/clients(?:\/|$)/.test(pathOnly))
      || (employee.role === 'crm' && (/^\/api\/accounts(?:\/|$)/.test(pathOnly) || pathOnly === '/api/schools/search'))
      || (employee.role === 'accounts' && /^\/api\/company\/billing(?:\/|$)/.test(pathOnly));
    if (!common && !job) return res.status(403).json({ message: 'This tool is outside your company job permissions.' });
  }
  if (SCHOOL_SUBSCRIPTION_EXEMPT_API_PREFIXES.some(prefix => pathOnly.startsWith(prefix))) return next();
  const actor = getSessionAccount(req);
  if (!actor || hasPlatformAccess(actor) || PLATFORM_INTERNAL_ROLES.has(actor.role)) return next();
  const access = schoolSubscriptionAccessState(actor);
  if (access.allowed) return next();
  return res.status(402).json({
    code: 'SCHOOL_SUBSCRIPTION_REQUIRED',
    message: access.status === 'trial_expired'
      ? 'The school\'s 14-day Little Feet trial has ended. A principal or administrator must activate a school subscription to continue.'
      : access.status === 'trial_pending'
        ? 'The school\'s 14-day Little Feet trial has not started yet. A principal or administrator must sign in to activate it.'
        : 'The school subscription has expired or is inactive. A principal or administrator must renew it to continue.',
    subscription: access
  });
});
const learnerRecordsVisibleTo = learnersHelpers.learnerRecordsVisibleTo;
const errorSourceLocation = validationHelpers.errorSourceLocation;

const recordSystemError = diagnosticsHelpers.recordSystemError;

diagnosticsRoutes.registerSystemStatusRoutes(app, routeContext);



const structuredLogVisibleTo = validationHelpers.structuredLogVisibleTo;
const systemErrorVisibleTo = diagnosticsHelpers.systemErrorVisibleTo;
const structuredStatusMatches = validationHelpers.structuredStatusMatches;

diagnosticsRoutes.registerSystemErrorsRoutes(app, routeContext);









const sourceFinding = validationHelpers.sourceFinding;
const sourceLineNumber = validationHelpers.sourceLineNumber;
const scanSourceMatches = validationHelpers.scanSourceMatches;

const runAdminSelfTest = accountsHelpers.runAdminSelfTest;

diagnosticsRoutes.registerSystemSelfTestRoutes(app, routeContext);



const billingBundleSizes = [5, 20, 100];
const schoolSubscriptionPlans = Object.freeze([
  Object.freeze({ code: 'micro', name: 'Micro / ECD', maxLearners: 30, hardMaxLearners: 250, monthlyPrice: 350, overagePerLearner: 10 }),
  Object.freeze({ code: 'standard', name: 'Standard Primary', maxLearners: 250, hardMaxLearners: 1000, monthlyPrice: 1500, overagePerLearner: 6 }),
  Object.freeze({ code: 'enterprise', name: 'Enterprise Campus', maxLearners: 1000, hardMaxLearners: 1000, monthlyPrice: 7500, overagePerLearner: 0 })
]);
const schoolLearnerCount = learnersHelpers.schoolLearnerCount;
const schoolPlanForCode = tenancyHelpers.schoolPlanForCode;
const planPriceForLearners = learnersHelpers.planPriceForLearners;
const schoolLearnerLimitState = learnersHelpers.schoolLearnerLimitState;

const payFastMode = String(process.env.LF_PAYFAST_MODE || 'live').trim().toLowerCase() === 'sandbox' ? 'sandbox' : 'live';
const payFastConfigured = paymentsHelpers.payFastConfigured;
const payFastHost = paymentsHelpers.payFastHost;
const payFastProcessUrl = paymentsHelpers.payFastProcessUrl;
const payFastValidationUrl = paymentsHelpers.payFastValidationUrl;
const payFastUrlEncode = paymentsHelpers.payFastUrlEncode;
const payFastParamString = paymentsHelpers.payFastParamString;
const payFastSignature = paymentsHelpers.payFastSignature;
const payFastRawEntries = paymentsHelpers.payFastRawEntries;
const ipv4ToInt = validationHelpers.ipv4ToInt;
const ipv4InCidr = validationHelpers.ipv4InCidr;
const PAYFAST_PUBLISHED_CIDRS = Object.freeze([
  '197.97.145.144/28', '41.74.179.192/27', '102.216.36.0/28', '102.216.36.128/28', '144.126.193.139/32'
]);
let payFastResolvedIps = { expiresAt: 0, values: new Set() };
const payFastSourceIsValid = paymentsHelpers.payFastSourceIsValid;
const payFastServerValidates = paymentsHelpers.payFastServerValidates;
const htmlAttributeEscape = validationHelpers.htmlAttributeEscape;
const billingDefaults = billingHelpers.billingDefaults;
const billingPaymentConfigured = paymentsHelpers.billingPaymentConfigured;
const subscriptionBillingState = billingHelpers.subscriptionBillingState;
const billingAmount = billingHelpers.billingAmount;
const publicBillingPricing = billingHelpers.publicBillingPricing;
const donationBillingState = paymentsHelpers.donationBillingState;
const paymentInstructions = paymentsHelpers.paymentInstructions;
const dateKeyInSouthAfrica = validationHelpers.dateKeyInSouthAfrica;
const schoolSubscriptionAccessState = billingHelpers.schoolSubscriptionAccessState;
const parentSubscriptionActive = billingHelpers.parentSubscriptionActive;
const validDateKey = validationHelpers.validDateKey;
const extendSubscriptionDate = billingHelpers.extendSubscriptionDate;
const cents = paymentsHelpers.cents;
const parentPaymentAmount = paymentsHelpers.parentPaymentAmount;
const parentPaymentDueDate = paymentsHelpers.parentPaymentDueDate;
const parentPaymentFinancials = paymentsHelpers.parentPaymentFinancials;
const parentPaymentSummary = paymentsHelpers.parentPaymentSummary;
const parentPaymentAgeing = paymentsHelpers.parentPaymentAgeing;
const parentPaymentView = paymentsHelpers.parentPaymentView;
const paymentStatuses = new Set(['awaiting_payment', 'paid', 'failed', 'refunded']);
const canonicalPaymentStatus = paymentsHelpers.canonicalPaymentStatus;
const findPaymentTarget = paymentsHelpers.findPaymentTarget;
const expectedPaymentAmount = paymentsHelpers.expectedPaymentAmount;

const STORE_RESERVATION_TTL_MS = 30 * 60 * 1000;
const storeProductForOrder = validationHelpers.storeProductForOrder;
const storeAvailableQuantity = validationHelpers.storeAvailableQuantity;
const updateStoreRoomRecord = validationHelpers.updateStoreRoomRecord;
const releaseStoreReservation = validationHelpers.releaseStoreReservation;
const releaseExpiredStoreReservations = validationHelpers.releaseExpiredStoreReservations;
const applyStorePaymentState = paymentsHelpers.applyStorePaymentState;
const applyPaymentEvent = paymentsHelpers.applyPaymentEvent;

// Company employees use business records rather than school administration APIs.
companyRoutes.registerCompanyClientsRoutes(app, routeContext);




billingRoutes.registerSubscriptionBillingRoutes(app, routeContext);





const allowedParentPaymentRoles = new Set(['parent', 'principal', 'admin', 'school_accounts']);
const parentPaymentParentForSchool = paymentsHelpers.parentPaymentParentForSchool;
const createParentPaymentRecord = paymentsHelpers.createParentPaymentRecord;

registerFinanceAutomation(app, {
  db, getSessionAccount, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
  findAccountByUsername, normalizeUsername, limitedText, billingAmount, cents, validDateKey,
  dateKeyInSouthAfrica, createParentPaymentRecord, parentPaymentFinancials, parentPaymentView,
  applyPaymentEvent, findPaymentTarget, expectedPaymentAmount, saveDatabaseState,
  scheduleReplicaSnapshot, persistenceReady, hasPlatformAccess, logStructured, withPersistentMutation, readOnlySnapshotMode
});

paymentsRoutes.registerParentPaymentsParentsRoutes(app, routeContext);







billingRoutes.registerParentSubscriptionRoutes(app, routeContext);



accountsRoutes.registerAccountsParentSubscriptionRoutes(app, routeContext);

const bookRecordVisibleTo = booksHelpers.bookRecordVisibleTo;
const bookRecordView = booksHelpers.bookRecordView;
const bookRecordsForSchool = tenancyHelpers.bookRecordsForSchool;

booksRoutes.registerBookRegisterRoutes(app, routeContext);







function createBookRecordFromImport(row, actor) {
  const body = {
    bookTitle: row.bookTitle ?? row['Book Title'], bookCode: row.bookCode ?? row['Book Code'], learnerName: row.learnerName ?? row['Learner Name'],
    className: row.className ?? row.Class ?? row['Class Name'], parentUsername: row.parentUsername ?? row['Parent Username'],
    issueCondition: row.issueCondition ?? row['Condition at handover'] ?? row['Condition at Handover'], bookPrice: row.bookPrice ?? row['Book replacement price'] ?? row['Replacement Price'], notes: row.notes ?? row.Notes,
    adminSignature: row.adminSignature ?? row['Admin signature']
  };
  const parent = parentPaymentParentForSchool(body.parentUsername, actor);
  const bookPrice = billingAmount(body.bookPrice);
  const bookTitle = String(body.bookTitle || '').trim().slice(0, 200), learnerName = String(body.learnerName || '').trim().slice(0, 160), issueCondition = String(body.issueCondition || '').trim().slice(0, 500);
  if (!parent || !bookTitle || !learnerName || !issueCondition || bookPrice === null || bookPrice < 0) return { error: 'Parent username, book title, learner name, handover condition, and a valid replacement price are required.' };
  return { record: tagSchoolRecord(actor, {
    id: crypto.randomUUID(), bookTitle, bookCode: String(body.bookCode || '').trim().slice(0, 80), bookPrice, learnerName, className: String(body.className || '').trim().slice(0, 120),
    parentUsername: parent.username, parentName: parent.name || parent.username, issueCondition, issuedAt: new Date().toISOString(),
    adminSignature: String(body.adminSignature || actor.name || actor.username).trim().slice(0, 160), adminSignedAt: new Date().toISOString(),
    parentSignature: '', parentSignedAt: '', returnCondition: '', returnedAt: '', returnAdminSignature: '', returnAdminSignedAt: '', returnParentSignature: '', returnParentSignedAt: '', returnStatus: '', penaltyAmount: 0, status: 'awaiting_parent_signature', notes: String(body.notes || '').trim().slice(0, 500), createdAt: new Date().toISOString()
  }) };
}

booksRoutes.registerBookRegisterSignRoutes(app, routeContext);



// Free bank-transfer reconciliation is available to school administrators. The
// same ledger can accept a gateway later through the signed, provider-neutral
// webhook without changing the finance screens or historical records.
paymentsRoutes.registerPaymentsLedgerRoutes(app, routeContext);













accountsRoutes.registerAccountsCatalogRoutes(app, routeContext);


const resolveManagedAccountScope = tenancyHelpers.resolveManagedAccountScope;

const canManageAccount = accountsHelpers.canManageAccount;

accountsRoutes.registerAccountsLearnerOptionsRoutes(app, routeContext);
const clientLearnerLinkError = learnersHelpers.clientLearnerLinkError;

accountsRoutes.registerAccountsRoutes(app, routeContext);

const migrateAccountReferences = accountsHelpers.migrateAccountReferences;

accountsRoutes.registerAccountsRoutes2(app, routeContext);







// Search schools by name for Account Management. Known Little Feet schools are
// returned first; public South African school names are then filled from OpenStreetMap.
schoolsRoutes.registerSchoolsSearchRoutes(app, routeContext);

// Live nearby-school search. Results are sourced from OpenStreetMap via Overpass.


// Optional, verified public-place enrichment. This is deliberately server-side so
// the API key is never sent to a browser. It does not use an AI model to invent data.


// Academic Term



const FILE_ENTITY_TYPES = new Set(['learner', 'staff', 'school', 'post', 'worksheet', 'dsd_incident', 'admission_application']);
const fileContentPath = filesHelpers.fileContentPath;
const publicFileMetadata = filesHelpers.publicFileMetadata;
const admissionApplicationVisibleTo = validationHelpers.admissionApplicationVisibleTo;
const admissionApplicationView = validationHelpers.admissionApplicationView;
const relatedRecordForFile = filesHelpers.relatedRecordForFile;
const canManageFile = filesHelpers.canManageFile;
const createStoredFile = filesHelpers.createStoredFile;
const rollbackStoredFile = filesHelpers.rollbackStoredFile;

filesRoutes.registerFilesRoutes(app, routeContext);











// Admissions 2.0 + central learner document repository.
const admissionsManagementActor = accountsHelpers.admissionsManagementActor;
const admissionForActor = accountsHelpers.admissionForActor;
const admissionDocumentState = validationHelpers.admissionDocumentState;
const admissionApiView = validationHelpers.admissionApiView;
const notifyAdmissionParent = validationHelpers.notifyAdmissionParent;

admissionsRoutes.registerAdmissionsApplicationsRoutes(app, routeContext);







filesRoutes.registerLearnerDocumentsRoutes(app, routeContext);





// Posts
academicsRoutes.registerPostsRoutes(app, routeContext);



// Schedules





// Worksheets




// Badges




// Analytics


// Staff qualifications, compliance, development and KPI history.
const validIsoDate = validationHelpers.validIsoDate;
const qualificationStatus = validationHelpers.qualificationStatus;
staffRoutes.registerStaffQualificationsRoutes(app, routeContext);







// Little Feet Email Integration inbox: a separate delivery surface for portal events.
const emailInboxVisibleTo = mailHelpers.emailInboxVisibleTo;
const emailSourceKey = mailHelpers.emailSourceKey;
const dismissEmailSource = mailHelpers.dismissEmailSource;
const addEmailInboxItem = mailHelpers.addEmailInboxItem;
const emailInboxPreferenceDefaults = mailHelpers.emailInboxPreferenceDefaults;
const emailInboxPreferenceKeys = mailHelpers.emailInboxPreferenceKeys;
const emailInboxPreferencesFor = mailHelpers.emailInboxPreferencesFor;
const emailInboxTypeKey = mailHelpers.emailInboxTypeKey;
const emailInboxTypeEnabled = mailHelpers.emailInboxTypeEnabled;

const buildEmailInbox = mailHelpers.buildEmailInbox;
mailRoutes.registerEmailInboxRoutes(app, routeContext);




// Email is a delivery channel, separate from in-app notifications.
// Little Feet can use the existing HTTPS email API or a real mailbox SMTP
// connection (for example Zoho Mail) without exposing mailbox credentials.
const emailVerificationTokens = new Map();
const emailHeaderText = mailHelpers.emailHeaderText;
const smtpConfig = mailHelpers.smtpConfig;
const smtpEmailConfigured = mailHelpers.smtpEmailConfigured;
const apiEmailConfigured = mailHelpers.apiEmailConfigured;
const emailDeliveryProvider = mailHelpers.emailDeliveryProvider;

const emailHtmlText = mailHelpers.emailHtmlText;

const smtpSend = mailHelpers.smtpSend;

const sendLittleFeetEmail = mailHelpers.sendLittleFeetEmail;

const inboundEmailDomain = mailHelpers.inboundEmailDomain;
const inboundEmailApiKey = mailHelpers.inboundEmailApiKey;
const inboundWebhookSecret = accountsHelpers.inboundWebhookSecret;
const inboundEmailConfigured = mailHelpers.inboundEmailConfigured;
const validForwardingAlias = mailHelpers.validForwardingAlias;
const forwardingAddressFor = mailHelpers.forwardingAddressFor;
const publicForwardingStatus = mailHelpers.publicForwardingStatus;
const ensureForwardingAddress = mailHelpers.ensureForwardingAddress;
const normalizeEnvelopeAddress = validationHelpers.normalizeEnvelopeAddress;
const forwardingActorForRecipients = mailHelpers.forwardingActorForRecipients;
const receivedEmailSourceId = mailHelpers.receivedEmailSourceId;

mailRoutes.registerEmailForwardingSetupRoutes(app, routeContext);

const mailboxConnectionStatus = mailHelpers.mailboxConnectionStatus;
const mailboxSyncLimit = mailHelpers.mailboxSyncLimit;
const mailboxAccessToken = mailHelpers.mailboxAccessToken;
const syncConnectedMailbox = mailHelpers.syncConnectedMailbox;

mailRoutes.registerEmailMailboxStatusRoutes(app, routeContext);



const completeMailboxOAuth = mailHelpers.completeMailboxOAuth;

mailRoutes.registerEmailMailboxOauthCallbackRoutes(app, routeContext);









const emailActor = mailHelpers.emailActor;
mailRoutes.registerEmailStatusRoutes(app, routeContext);



// Attendance

// Monthly KPI is calculated from completed staff tasks, not subjective manager ratings.
const monthKey = validationHelpers.monthKey;
const monthlyTaskKpi = validationHelpers.monthlyTaskKpi;
staffRoutes.registerStaffKpiMonthlyRoutes(app, routeContext);

// Staff purchase requests feed management approvals and finance fulfilment.
operationsRoutes.registerPurchaseRequestsRoutes(app, routeContext);



// School resource booking with collision prevention.




// Maintenance & work orders
const MAINTENANCE_STATUSES = new Set(['Open','In Progress','Completed']);
operationsRoutes.registerMaintenanceRoutes(app, routeContext);



// Meeting minutes turn approved meeting tickets into accountable staff work.
staffRoutes.registerStaffMeetingsRoutes(app, routeContext);


// Staff notice board with per-staff acknowledgement tracking.




// Management approvals centre aggregates existing workflows without duplicating their records.
operationsRoutes.registerApprovalsRoutes(app, routeContext);


// Executive Home overview: one aggregate request keeps the CEO dashboard live
// without duplicating the per-workspace API fan-out used by My Day.
executiveRoutes.registerExecutiveOverviewRoutes(app, routeContext);

// Staff performance reviews / KPI
const KPI_RATINGS = new Set([1, 2, 3, 4, 5]);
staffRoutes.registerStaffPerformanceReviewsRoutes(app, routeContext);



// Staff workplace: tasks, leave and teacher cover
const WORK_TASK_STATUSES = new Set(['Open', 'In Progress', 'Completed']);
const LEAVE_STATUSES = new Set(['Pending', 'Approved', 'Rejected', 'Cancelled']);
const COVER_STATUSES = new Set(['Needs Cover', 'Assigned', 'Completed', 'Cancelled']);
const staffAccountInSchool = tenancyHelpers.staffAccountInSchool;

const tagEmploymentRecord = tenancyHelpers.tagEmploymentRecord;
staffRoutes.registerStaffDirectoryRoutes(app, routeContext);













attendanceRoutes.registerAttendanceRoutes(app, routeContext);






// Tickets
const ADMISSION_STATUSES = new Set(['Submitted','Under review','Documents required','Waitlisted','Approved','Rejected','Enrolled','Withdrawn']);
const admissionChecklistDefaults = validationHelpers.admissionChecklistDefaults;

schoolsRoutes.registerSchoolApplicationsRoutes(app, routeContext);

deletionRoutes.registerAccountDeletionRequestRoutes(app, routeContext);



ticketsRoutes.registerTicketsAssigneesRoutes(app, routeContext);



const purgeSchoolData = tenancyHelpers.purgeSchoolData;

deletionRoutes.registerSchoolDeletionExecuteRoutes(app, routeContext);

ticketsRoutes.registerTicketsUpdateRoutes(app, routeContext);


// Chat - Groups
chatRoutes.registerChatGroupsRoutes(app, routeContext);



// Chat - Messages




// Chat - Direct





// Location-aware emergency broadcasts. Exact incident coordinates remain visible
// only to authorised safety staff; recipients receive only applicable alerts.
const requireSafetyStaff = accountsHelpers.requireSafetyStaff;
safetyRoutes.registerBroadcastsRoutes(app, routeContext);
























// Store details and purchases are always scoped to the signed-in user's school.
storeRoutes.registerStoreRoutes(app, routeContext);









// Internal operational records for the advanced workspaces. External providers are configured separately.
const moduleRecordCollection = recordsHelpers.moduleRecordCollection;

recordsRoutes.registerModulesRoutes(app, routeContext);











safetyRoutes.registerConsentsRoutes(app, routeContext);





diagnosticsRoutes.registerReleaseNotesRoutes(app, routeContext);

reportsRoutes.registerReportSigningPinRoutes(app, routeContext);





// School-controlled learner access codes. Codes are encrypted at rest and are
// available only to the school roles that issue or print the physical handout.
const findLearnerAccessCodeActor = learnersHelpers.findLearnerAccessCodeActor;

const learnerAccessCodeView = learnersHelpers.learnerAccessCodeView;

learnersRoutes.registerLearnerAccessCodesRoutes(app, routeContext);



// This is deliberately a separate, credential-free view. It lets an
// administrator verify exactly what teachers can use: learner details and an
// issued/not-issued indicator, never an access code or its history.














// Student Search




// Secure bulk learner import. The browser previews spreadsheet rows first; this
// endpoint applies the authoritative duplicate check and encrypts sensitive fields.




// 1. Session and Passport Setup
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

app.use(passport.initialize());
app.use(passport.session());

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const googleSignInConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const yahooSignInConfigured = Boolean(process.env.YAHOO_CLIENT_ID && process.env.YAHOO_CLIENT_SECRET);
const microsoftSignInConfigured = Boolean(process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET);
const googleCallbackUrl = oauthCallbackUrl('google');
const yahooCallbackUrl = oauthCallbackUrl('yahoo');
const microsoftCallbackUrl = oauthCallbackUrl('microsoft');
if (googleSignInConfigured) passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: googleCallbackUrl,
    state: true
  },
  (accessToken, refreshToken, profile, done) => {
    const user = {
      googleId: profile.id,
      displayName: profile.displayName,
      email: profile.emails?.[0]?.value || '',
      emails: profile.emails || [],
      emailVerified: profile._json?.email_verified !== false,
      photo: profile.photos?.[0]?.value || ''
    };
    return done(null, user);
  }
));

authRoutes.registerAuthProvidersRoutes(app, routeContext);



oauthRoutes.registerGoogleRoutes(app, routeContext);











if (typeof registerSchoolCoreUpgrades === 'function') {
  registerSchoolCoreUpgrades(app, {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, learnerRecordsVisibleTo, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, sendLittleFeetEmail, looksLikeEmailAddress, safeHttpsUrl, validDateKey,
    validSignatureData, encryptField, decryptStoredField, validSecretLength, matchesPin, saveDatabaseState,
    scheduleReplicaSnapshot, logStructured, smtpEmailConfigured, apiEmailConfigured, withPersistentMutation, readOnlySnapshotMode
  });
}

if (typeof registerAdvancedSchoolOperations === 'function') {
  registerAdvancedSchoolOperations(app, {
    db, getSessionAccount, hasPlatformAccess, accountSchoolId, isSameSchool, recordInSchool, tagSchoolRecord,
    tenantRecords, learnerRecordsVisibleTo, normalizeUsername, normalizeComparableText, limitedText, boundedText, dateKeyInSouthAfrica,
    isParentLinkedToLearner, validDateKey, safeHttpsUrl, createParentPaymentRecord, encryptField, decryptStoredField,
    saveDatabaseState, scheduleReplicaSnapshot, logStructured
  });
}

app.use((req, res, next) => {
  const blockedFile = /^\/(?:\.env(?:\.[^/]+)?|server\.js|backup-server\.js|auth-crypto\.js|finance-automation-server\.js|school-core-upgrades-server\.js|advanced-school-operations-server\.js|littlefeet-replica\.json|(?:littlefeet|littlesteps)\.(?:db|sqlite|sqlite3)(?:-(?:shm|wal))?|package(?:-lock)?\.json|\.render-deploy-release\.json|create_portal_documents\.py|npm-debug\.log)$/i.test(req.path);
  const blockedDirectory = /^\/(?:\.git|\.github|node_modules|output|tests|tmp|uploads|scripts|lib)(?:\/|$)/i.test(req.path);
  const blockedSourceMap = /\.map$/i.test(req.path);
  if (blockedFile || blockedDirectory || blockedSourceMap) {
    res.setHeader('Cache-Control', 'no-store');
    return res.sendStatus(404);
  }
  next();
});

// Wildcard Catch-All (Serves Frontend)
app.use((error, req, res, _next) => {
  if (error?.code === 'AMBIGUOUS_LEARNER') return res.status(409).json({ message: 'More than one learner matches this name. Choose a school and a uniquely identified learner before saving.' });
  const report = recordSystemError(error, req);
  if (!replicaMode && (!req.method || req.method === 'GET')) void saveDatabaseState();
  scheduleReplicaSnapshot();
  res.status(Number(error?.status) >= 400 && Number(error?.status) < 600 ? Number(error.status) : 500).json({
    message: 'An unexpected server error occurred. The administrator report has been created.',
    requestId: report.requestId || report.id
  });
});

app.get(/(.*)/, (req, res) => {
  if (path.extname(req.path)) return res.status(404).end();
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Start Server
persistenceReady.then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    logStructured('info', 'server.started', { category: 'runtime', result: 'listening', details: `Port ${PORT}` });
  });
}).catch(error => {
  logStructured('error', 'server.startup_failed', { category: 'runtime', result: 'failed', message: error.message });
  process.exit(1);
});
