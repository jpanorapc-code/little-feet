(() => {
  const PRIVACY_VERSION = 'POPIA-2026-09-v2';
  const TERMS_VERSION = 'TOS-ZA-2026-09-v2';

  const section = (title, body) =>
    '<section style="margin:0 0 16px;"><h3 style="margin:0 0 7px;font-size:1rem;">' + title + '</h3><div style="color:var(--text-muted);line-height:1.65;font-size:.88rem;">' + body + '</div></section>';
  const bullets = items => '<ul style="margin:7px 0 0;padding-left:20px;">' + items.map(item => '<li style="margin:5px 0;">' + item + '</li>').join('') + '</ul>';

  function privacyNoticeMarkup() {
    return [
      '<div style="font-size:.9rem;line-height:1.55;">',
      '<p class="meta" style="margin:0 0 14px;">Version ' + PRIVACY_VERSION + ' · South Africa · Protection of Personal Information Act 4 of 2013 (POPIA)</p>',
      section('1. Who is responsible for personal information',
        '<p>The school or education provider using Little Feet will ordinarily decide why and how learner, guardian and staff records are processed and will therefore usually act as the <strong>responsible party</strong> for those school records. Little Feet may act as an <strong>operator</strong> when it processes those records on the school’s instructions, and may separately act as a responsible party for its own account, service, security and billing administration. The exact legal allocation depends on the applicable contract and facts.</p><p style="margin-top:8px;">Each school must make its Information Officer or Deputy Information Officer contact details available to its users. Platform support requests can be raised through the Little Feet Support Desk.</p>'),
      section('2. Information that may be processed',
        bullets([
          'Account and identity information such as names, usernames, roles, contact details and school relationships.',
          'Learner and education records such as attendance, class placement, development observations, portfolios, reports and school applications.',
          'Sensitive care and safeguarding information where lawfully required, including allergy, medical, medication, consent, pickup and incident-related records.',
          'Financial records such as invoices, balances, payment references, credits, refunds, payroll records and reconciliation entries. Little Feet does not need or request card CVV data.',
          'Communications, support tickets, audit events, security logs and technical information needed to operate and protect the service.'
        ])),
      section('3. POPIA processing principles',
        '<p>Personal information must be processed in accordance with POPIA’s conditions for lawful processing: accountability, processing limitation, purpose specification, compatible further processing, information quality, openness, security safeguards and data-subject participation.</p>' +
        bullets([
          'Collect only information that is adequate, relevant and not excessive for a defined school or service purpose.',
          'Use a lawful justification permitted by POPIA, which may include consent, performance of a contract, a legal duty, protection of a legitimate interest, or another lawful ground depending on the activity.',
          'Do not reuse information for an incompatible purpose without a lawful basis.',
          'Take reasonable steps to keep information accurate and up to date.',
          'Retain records only for as long as required by the original purpose, an applicable legal obligation, an authorised school retention schedule or another lawful reason; thereafter securely delete, destroy or de-identify them.'
        ])),
      section('4. Children and special personal information',
        '<p>Children’s information and special personal information receive additional protection under POPIA. Schools must confirm that the applicable consent, competent-person authorisation, statutory permission or other POPIA authorisation exists before recording or disclosing such information. Little Feet features do not remove the school’s duty to decide whether processing is lawful and proportionate.</p>'),
      section('5. Consent',
        '<p>Where consent is used, it must be voluntary, specific and informed and recorded for the relevant purpose. Consent for authenticated internal class updates is kept separate from optional external marketing/media consent. A withdrawal of consent applies prospectively where consent is the applicable justification, but does not automatically require deletion where another law requires retention.</p>'),
      section('6. Sharing and operators',
        '<p>Information may be made available only to authorised school users, approved family users, contracted operators/service providers, or other recipients where the school or Little Feet has a lawful reason. Operators handling personal information must be subject to appropriate confidentiality and security obligations. Little Feet does not treat school-held personal information as a product for sale.</p>'),
      section('7. Cross-border processing',
        '<p>Personal information may be transferred outside South Africa only where the requirements of POPIA section 72 are satisfied, for example where the recipient is subject to an adequate level of protection, an appropriate binding agreement, consent or another permitted ground.</p>'),
      section('8. Security and incidents',
        '<p>Little Feet uses role-based access, tenant isolation, secure sessions, encrypted storage for selected sensitive fields, audit controls and security testing. No system can guarantee absolute security. Where there are reasonable grounds to believe personal information has been accessed or acquired by an unauthorised person, the responsible party must follow POPIA’s security-compromise notification requirements, including notification to the Information Regulator and affected data subjects as required by law.</p>'),
      section('9. Your POPIA rights',
        bullets([
          'Ask whether a responsible party holds personal information about you and request access where permitted.',
          'Request correction or deletion of inaccurate, irrelevant, excessive, out-of-date, incomplete, misleading or unlawfully obtained information, subject to lawful retention duties.',
          'Object to processing in circumstances provided by POPIA and withdraw consent where consent is the applicable justification.',
          'Complain to the school’s Information Officer and, where appropriate, lodge a complaint with the Information Regulator.',
          'Request information about the purpose and categories of processing. A PAIA access process may also apply where required.'
        ])),
      section('10. Direct marketing and automated decisions',
        '<p>Unsolicited electronic direct marketing must comply with POPIA. Little Feet must not be used to make a solely automated admission, disciplinary, safeguarding or developmental decision that has legal or substantial effects on a person without the protections required by law.</p>'),
      section('11. Information Regulator',
        '<p>The South African Information Regulator is the independent regulator responsible for POPIA and PAIA. Current complaint forms and contact channels are available at <a href="https://inforegulator.org.za/" target="_blank" rel="noopener">inforegulator.org.za</a>.</p>'),
      '<p class="meta" style="margin-top:14px;">This platform notice supports POPIA compliance but does not replace the school’s own privacy notice, PAIA manual where applicable, retention schedule, operator agreements, Information Officer duties or professional legal review.</p>',
      '</div>'
    ].join('');
  }

  function termsMarkup() {
    return [
      '<div style="font-size:.9rem;line-height:1.55;">',
      '<p class="meta" style="margin:0 0 14px;">Version ' + TERMS_VERSION + ' · Governed by the laws of the Republic of South Africa</p>',
      section('1. Acceptance and authority',
        '<p>By creating or using an account you confirm that you are authorised to use Little Feet for the relevant school, family or educational purpose and agree to these Terms together with the applicable Privacy & POPIA Notice. Electronic acceptance and records are handled in accordance with applicable South African law, including the Electronic Communications and Transactions Act 25 of 2002.</p>'),
      section('2. Permitted use',
        bullets([
          'Use the service only for legitimate school, education, childcare, family-account or authorised administrative purposes.',
          'Access only the school, learner, family, staff and finance records that your role permits.',
          'Keep credentials confidential and promptly report suspected account compromise.',
          'Do not attempt to bypass access controls, probe another school’s records, introduce malicious code, scrape restricted data, interfere with service availability or misuse learner information.'
        ])),
      section('3. School and user responsibilities',
        '<p>Schools are responsible for approving users, verifying learner/family relationships, configuring authorised staff access, maintaining accurate records and determining the lawful purpose and retention period for school-held information. Users must provide accurate information and must not upload content, health information, photographs or documents unless they are authorised to do so.</p>'),
      section('4. Safeguarding and sensitive information',
        '<p>Little Feet provides tools for safeguarding, consent, pickup controls and care records, but it does not replace professional safeguarding judgement, mandatory reporting obligations, medical advice, emergency procedures or the school’s legal duties under applicable South African law.</p>'),
      section('5. Finance and payroll',
        '<p>Finance tools assist with invoices, balances, statements, credits, refunds, reconciliation and payroll record preparation. They are administrative tools and are not banking, tax, accounting or payroll-compliance advice. Little Feet does not calculate PAYE, UIF, SDL or other statutory payroll obligations. Schools must verify financial exports and statutory treatment with their accountant, payroll provider or relevant authority.</p>'),
      section('6. Third-party services',
        '<p>Some functions may rely on third-party payment, messaging, hosting, map or other providers. Those services may have their own terms and privacy practices. A school must approve and configure a provider before Little Feet sends information to it where configuration is required.</p>'),
      section('7. Availability, backups and changes',
        '<p>Reasonable steps are taken to maintain service availability and data protection, but uninterrupted availability cannot be guaranteed. Schools should maintain appropriate continuity and backup arrangements for legally or operationally critical records. Features may be improved or changed, but changes must not be used to remove rights that cannot lawfully be excluded.</p>'),
      section('8. Intellectual property and uploaded content',
        '<p>Users retain whatever rights they lawfully hold in content they upload. Uploading content does not transfer ownership to Little Feet, but the service needs permission to store, process and display that content for the authorised service purpose. Users must not upload material they are not entitled to use.</p>'),
      section('9. Suspension and termination',
        '<p>Access may be limited or suspended where reasonably necessary to protect users, comply with law, investigate misuse, secure the service, enforce authorised school access or respond to non-payment under an applicable service agreement. Where practical and lawful, affected account holders should receive appropriate notice and an opportunity to resolve the issue.</p>'),
      section('10. Consumer rights and liability',
        '<p>Nothing in these Terms excludes or limits rights or remedies that cannot lawfully be excluded under South African law, including the Consumer Protection Act 68 of 2008 where it applies. Any limitation or disclaimer must be interpreted subject to those mandatory rights and the requirement for fair, just and reasonable terms.</p>'),
      section('11. Privacy, notices and governing law',
        '<p>The Privacy & POPIA Notice forms part of these Terms. South African law governs the service and these Terms, subject to any mandatory law that applies to a particular user or transaction. Formal legal notices should use the contact details supplied by the school or service provider for the relevant matter.</p>'),
      '<p class="meta" style="margin-top:14px;">Schools should obtain professional legal advice for their own service agreement, fee terms, employment/payroll arrangements, retention schedule, PAIA obligations and school-specific privacy notice.</p>',
      '</div>'
    ].join('');
  }

  function openPopiaPrivacyNotice() {
    window.openModal?.('Privacy & POPIA Notice', privacyNoticeMarkup());
  }
  function openTermsOfService() {
    window.openModal?.('Terms of Service · South Africa', termsMarkup());
  }

  Object.assign(window, {
    LITTLE_FEET_PRIVACY_VERSION: PRIVACY_VERSION,
    LITTLE_FEET_TERMS_VERSION: TERMS_VERSION,
    openPopiaPrivacyNotice,
    openTermsOfService
  });
})();
