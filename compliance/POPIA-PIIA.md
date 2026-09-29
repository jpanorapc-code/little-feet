# Personal Information Impact Assessment (PIIA)

**Assessment owner:** Information Officer  
**Initial assessment:** 29 September 2026

## Risk posture
Little Feet processes information about children and may process medical, medication, allergy, safeguarding and other special personal information. Inherent privacy impact is therefore high. The objective is to reduce risk through minimisation, strict authorisation, tenant isolation, secure storage, contracts, retention controls, incident readiness and continuous testing.

| Processing | Main risks | Existing evidence | Required residual controls |
|---|---|---|---|
| Accounts/authentication | takeover, excessive access, cross-tenant access | hashed credentials, secure sessions, login controls, role/tenant tests | monitoring, periodic access review, documented retention |
| Learner/school records | child-data exposure, wrong staff/parent access, overcollection | tenant/role/linked-learner controls, bounded inputs, authorisation tests | operator agreement, minimum-field review, lawful-instruction record |
| Care/medical/safeguarding | high-harm disclosure, inaccuracy | authenticated restricted workflows, selected field encryption, security controls | verify lawful basis/competent-person or other POPIA authorisation; tighter retention/access |
| Files/photos/documents | public exposure, object enumeration, wrong tenant | private storage design, tenant-derived keys, server access, lifecycle tests | retention/deletion verification and media/consent rules |
| Finance | financial privacy, over-retention | role controls, validation, auditability; no CVV required | finance retention schedule and provider terms |
| Communications/support/logs | wrong recipient, sensitive free text, excessive logs | role/tenant checks, limits, escaping, audit logging | log retention and staff confidentiality |
| Cloud providers | foreign processing, provider compromise | managed hosting/storage and private storage | provider register, written operator safeguards, section 72 assessment |

## Required review triggers
Review this PIIA before material new categories of personal information, new analytics/AI/profiling, new vendors, new cross-border flows, new integrations, material access-model changes, or after a significant security compromise.

## Conclusion
Existing technical controls materially reduce risk but do not close governance risk by themselves. Client/operator terms, lawful-basis records for child/special-information processing, retention rules, vendor/cross-border assessment, incident readiness and periodic access review remain mandatory operational controls.
