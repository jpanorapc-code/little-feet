(() => {
  const PRIVACY_VERSION = 'POPIA-2026-09-v3';
  const TERMS_VERSION = 'TOS-ZA-2026-09-v3';
  const IP_VERSION = 'IP-ZA-2026-09-v1';

  const section = (title, body) =>
    '<section style="margin:0 0 16px;"><h3 style="margin:0 0 7px;font-size:1rem;">' + title + '</h3><div style="color:var(--text-muted);line-height:1.65;font-size:.88rem;">' + body + '</div></section>';
  const bullets = items => '<ul style="margin:7px 0 0;padding-left:20px;">' + items.map(item => '<li style="margin:5px 0;">' + item + '</li>').join('') + '</ul>';

  function privacyNoticeMarkup() {
    return [
      '<div style="font-size:.9rem;line-height:1.55;">',
      '<p class="meta" style="margin:0 0 14px;">Version ' + PRIVACY_VERSION + ' · South Africa · Protection of Personal Information Act 4 of 2013 (POPIA)</p>',
      section('1. Who is responsible for personal information',
        '<p>The school or education provider using Little Feet will ordinarily decide why and how learner, guardian and staff records are processed and will therefore usually act as the <strong>responsible party</strong> for those school records. Little Feet may act as an <strong>operator</strong> when it processes those records on the school’s instructions, and may separately act as a responsible party for its own account, service, security and billing administration. The exact legal allocation depends on the applicable contract and facts.</p><p style="margin-top:8px;">Each responsible party must make the required Information Officer or Deputy Information Officer details available to data subjects. Platform support requests can be raised through the Little Feet Support Desk.</p>'),
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
        '<p>Children’s information and special personal information receive additional protection under POPIA. A responsible party must establish the applicable competent-person consent, legal duty, statutory permission or other authorisation permitted by POPIA before processing such information. In child-related care, protection and well-being matters, schools must also apply applicable South African child-protection duties, including the best-interests principle in the Children’s Act 38 of 2005. Little Feet features do not remove the school’s duty to decide whether processing is lawful, proportionate and in the child’s best interests.</p>'),
      section('5. Consent',
        '<p>Where consent is used, it must be voluntary, specific and informed and recorded for the relevant purpose. Consent for authenticated internal class updates is kept separate from optional external marketing or media consent. Withdrawal applies prospectively where consent is the applicable justification, but does not automatically require deletion where another law requires retention.</p>'),
      section('6. Sharing, operators and contracts',
        '<p>Information may be made available only to authorised school users, approved family users, contracted operators or service providers, or other recipients where the responsible party has a lawful reason. Operators handling personal information must be subject to appropriate confidentiality, security and processing obligations. Little Feet does not treat school-held personal information as a product for sale.</p>'),
      section('7. Cross-border processing',
        '<p>Personal information may be transferred outside South Africa only where the requirements of POPIA section 72 are satisfied, for example where the recipient is subject to an adequate level of protection, an appropriate binding agreement, consent or another permitted ground.</p>'),
      section('8. Security and security compromises',
        '<p>Little Feet uses role-based access, tenant isolation, secure sessions, encrypted storage for selected sensitive fields, audit controls and security testing. No system can guarantee absolute security. Where there are reasonable grounds to believe personal information has been accessed or acquired by an unauthorised person, the responsible party must follow POPIA section 22 and applicable Information Regulator requirements, including notification to the Regulator and affected data subjects where required by law.</p>'),
      section('9. Data-subject rights',
        bullets([
          'Ask whether a responsible party holds personal information about you and request access where permitted.',
          'Request correction or deletion of inaccurate, irrelevant, excessive, out-of-date, incomplete, misleading or unlawfully obtained information, subject to lawful retention duties.',
          'Object to processing in circumstances provided by POPIA and withdraw consent where consent is the applicable justification.',
          'Complain to the school’s Information Officer and, where appropriate, lodge a complaint with the Information Regulator.',
          'Request information about the purpose and categories of processing. PAIA may also provide a route to request access to records.'
        ])),
      section('10. PAIA and records access',
        '<p>The Promotion of Access to Information Act 2 of 2000 (PAIA) applies to access to records held by public and private bodies. A private body must maintain the section 51 PAIA manual required by law and make it available in the required manner. The applicable manual should identify the responsible private body, Information Officer details, categories of records and the prescribed request process. Little Feet must not invent those legal identity details; they must match the actual provider and registered Information Officer.</p>'),
      section('11. Direct marketing and automated decisions',
        '<p>Unsolicited electronic direct marketing must comply with POPIA and other applicable South African consumer and electronic-communications rules. Little Feet must not be used to make a solely automated admission, disciplinary, safeguarding or developmental decision that has legal or substantial effects on a person without the protections required by law.</p>'),
      section('12. Information Regulator',
        '<p>The South African Information Regulator is the independent regulator responsible for POPIA and PAIA. Current complaint forms, PAIA forms and contact channels are available at <a href="https://inforegulator.org.za/" target="_blank" rel="noopener">inforegulator.org.za</a>.</p>'),
      '<p class="meta" style="margin-top:14px;">This platform notice supports compliance but does not replace the school’s own privacy notice, the responsible party’s section 51 PAIA manual, retention schedule, operator agreements, Information Officer duties, security incident process or professional legal review.</p>',
      '</div>'
    ].join('');
  }

  function termsMarkup() {
    return [
      '<div style="font-size:.9rem;line-height:1.55;">',
      '<p class="meta" style="margin:0 0 14px;">Version ' + TERMS_VERSION + ' · Governed by the laws of the Republic of South Africa</p>',
      section('1. Service identity, acceptance and authority',
        '<p><strong>Little Feet™</strong> is the service and brand used for this portal, and <strong>littlefeet.co.za</strong> is its official website. Little Feet is a private service and does not claim to be a government department, regulator or official government system.</p><p style="margin-top:8px;">By creating or using an account you confirm that you are authorised to use Little Feet for the relevant school, family or educational purpose and agree to these Terms together with the applicable Privacy & POPIA Notice. Electronic acceptance and records are handled subject to applicable South African law, including the Electronic Communications and Transactions Act 25 of 2002 (ECTA).</p>'),
      section('2. Supplier information and electronic transactions',
        '<p>Where a paid agreement is concluded electronically through Little Feet, the supplier must make the disclosures required by ECTA section 43 available before the transaction is concluded, including the supplier’s legal identity and status, registration details where applicable, contact and physical or legal-service address, service description, total price and charges, payment method, agreement terms, transaction-record access, cancellation or refund terms, privacy and security information, and any applicable minimum duration or dispute-resolution process.</p><p style="margin-top:8px;">Viewing a plan, creating a payment request or browsing the portal does not by itself create a paid school subscription. Binding school commercial terms are those accepted in the applicable quotation, order form or service agreement.</p>'),
      section('3. Permitted use and cybersecurity',
        bullets([
          'Use the service only for legitimate school, education, childcare, family-account or authorised administrative purposes.',
          'Access only the school, learner, family, staff and finance records that your role permits.',
          'Keep credentials confidential and promptly report suspected account compromise.',
          'Do not bypass access controls, probe another school’s records, introduce malicious code, interfere with service availability, unlawfully intercept data, misuse credentials or perform unauthorised security testing.',
          'Do not scrape, bulk-extract or reuse restricted portal data except where expressly authorised and lawful.'
        ]) + '<p style="margin-top:8px;">Unauthorised access and related conduct may also be prohibited by the Cybercrimes Act 19 of 2020 and other applicable law.</p>'),
      section('4. School and user responsibilities',
        '<p>Schools are responsible for approving users, verifying learner and family relationships, configuring authorised staff access, maintaining accurate records and determining the lawful purpose and retention period for school-held information. Users must provide accurate information and must not upload content, health information, photographs or documents unless they are authorised to do so.</p>'),
      section('5. Safeguarding and sensitive information',
        '<p>Little Feet provides tools for safeguarding, consent, pickup controls and care records, but it does not replace professional safeguarding judgement, mandatory reporting obligations, medical advice, emergency procedures or the school’s legal duties under applicable South African law.</p>'),
      section('6. Finance, payments and payroll',
        '<p>Finance tools assist with invoices, balances, statements, credits, refunds, reconciliation and payroll record preparation. They are administrative tools and are not banking, tax, accounting or payroll-compliance advice. Little Feet does not calculate PAYE, UIF, SDL or other statutory payroll obligations. Schools must verify financial exports and statutory treatment with their accountant, payroll provider or relevant authority.</p>'),
      section('7. Third-party services',
        '<p>Some functions may rely on third-party payment, messaging, hosting, map or other providers. Those services may have their own terms and privacy practices. A school must approve and configure a provider before Little Feet sends information to it where configuration is required.</p>'),
      section('8. Availability, backups and changes',
        '<p>Reasonable steps are taken to maintain service availability and data protection, but uninterrupted availability cannot be guaranteed. Schools should maintain appropriate continuity and backup arrangements for legally or operationally critical records. Features may be improved or changed, but changes must not be used to remove rights that cannot lawfully be excluded.</p>'),
      section('9. Little Feet intellectual property and licence',
        '<p>Except for school or user content and third-party material, the Little Feet service and its original software, source and compiled code, user-interface design, workflows, documentation, text, templates, database arrangements, graphics, mascot, logos, brand elements and other original materials are owned by or licensed to the Little Feet service provider and are protected to the extent provided by applicable law, including the Copyright Act 98 of 1978 and trade mark law.</p>' +
        bullets([
          'An authorised account receives only a limited, non-exclusive, non-transferable right to use the service for its approved purpose while access remains valid.',
          'No ownership in Little Feet intellectual property is transferred to a school or user.',
          'Except where applicable law expressly permits and does not allow contractual restriction, users may not copy, reproduce, distribute, sell, sublicense, white-label, clone, remove rights notices from, or create a competing service from protected Little Feet material.',
          'Users may not use the Little Feet name, logo, mascot, slogan, domain identity or confusingly similar branding in a way that suggests ownership, endorsement or affiliation without written permission.'
        ]) + '<p style="margin-top:8px;"><strong>Little Feet™</strong> denotes a claimed trade mark. It does not state that the mark is registered. The ® symbol must not be used unless the relevant mark has actually been registered.</p>'),
      section('10. School and user content',
        '<p>Users retain whatever rights they lawfully hold in content they upload. Uploading content does not transfer ownership to Little Feet. The school or user grants only the limited permission reasonably necessary for Little Feet and its authorised operators to host, store, process, transmit, back up and display that content for the authorised service purpose and to comply with law. Users must not upload material they are not entitled to use.</p>'),
      section('11. Suspension and termination',
        '<p>Access may be limited or suspended where reasonably necessary to protect users, comply with law, investigate misuse, secure the service, enforce authorised school access or respond to non-payment under an applicable service agreement. Where practical and lawful, affected account holders should receive appropriate notice and an opportunity to resolve the issue.</p>'),
      section('12. Consumer rights, plain language and liability',
        '<p>Nothing in these Terms excludes or limits rights or remedies that cannot lawfully be excluded under South African law, including the Consumer Protection Act 68 of 2008 where it applies. Terms, notices and limitations must be interpreted in a fair, just, reasonable and reasonably understandable manner. Any unusual limitation of risk, assumption of risk, indemnity or acknowledgement must be brought to the consumer’s attention in the manner required by applicable law.</p>'),
      section('13. Privacy, notices, disputes and governing law',
        '<p>The Privacy & POPIA Notice forms part of these Terms. South African law governs the service and these Terms, subject to any mandatory law that applies to a particular user or transaction. Nothing prevents a person from approaching the Information Regulator, National Consumer Commission, a court or another competent authority where the law gives that right. Formal legal notices must use the actual legal contact details supplied by the relevant school or Little Feet service provider.</p>'),
      '<p class="meta" style="margin-top:14px;">These platform Terms do not replace school-specific service agreements, statutory policies, PAIA manuals, fee schedules, employment or payroll terms, retention schedules or professional legal review.</p>',
      '</div>'
    ].join('');
  }

  function copyrightPolicyMarkup() {
    return [
      '<div style="font-size:.9rem;line-height:1.55;">',
      '<p class="meta" style="margin:0 0 14px;">Version ' + IP_VERSION + ' · South Africa · Copyright, trade marks, brand protection and content reporting</p>',
      section('1. Little Feet protected material',
        '<p><strong>Little Feet™</strong>, the Little Feet name, original logos, mascot, slogan, visual identity, website and portal design, original graphics, text, documentation, templates, software, source and compiled code, workflows and other original materials are protected to the extent provided by South African intellectual-property law. Copyright arises independently of trade mark registration; trade mark registration provides additional statutory protection for a registered mark.</p>'),
      section('2. Trade mark notice',
        '<p>Little Feet uses <strong>™</strong> to identify claimed brand rights. The <strong>®</strong> symbol must not be used for a Little Feet mark unless that specific mark has been registered and the registration is current. No user may register or use a confusingly similar business name, domain, social-media handle, logo, mascot or mark in a manner that misrepresents affiliation with Little Feet.</p>'),
      section('3. What users may and may not do',
        bullets([
          'Schools and authorised users may use Little Feet material only as necessary to use the service and approved school outputs.',
          'Do not copy, republish, sell, sublicense, white-label, clone or commercially exploit protected Little Feet material without written permission.',
          'Do not remove copyright, trade mark or other rights notices from Little Feet material.',
          'Do not scrape restricted portal content, extract protected datasets, reverse engineer the service or use protected Little Feet material to build or train a competing product except to the extent applicable law expressly permits and does not allow contractual restriction.',
          'Do not use the Little Feet brand, mascot, logo or slogan in advertising, merchandise, domain names or public-facing material in a way that implies endorsement or ownership without written permission.'
        ])),
      section('4. School and user content',
        '<p>Schools and users retain the rights they lawfully hold in their own uploaded material. They are responsible for ensuring that uploads, photographs, documents, learning resources and other content are authorised. Little Feet receives only the limited service licence described in the Terms of Service and does not acquire ownership merely because content is stored in the portal.</p>'),
      section('5. Reporting copyright or brand misuse',
        '<p>Use the Support Desk to report suspected infringement or unauthorised use. A useful report should identify the protected work or mark, identify the material or location complained of, explain the basis of the claim, provide contact details for the reporter and state that the report is made in good faith. Little Feet may request supporting documents before taking action.</p>'),
      section('6. Review, restriction and preservation',
        '<p>Where reasonably necessary, Little Feet may temporarily restrict access to disputed material while a report is reviewed, preserve relevant audit or evidentiary records, request a response from the uploader or school, and remove or restore material according to the facts, applicable contract and law. This reporting process does not replace any statutory ECTA procedure, court remedy or other legal process that may apply.</p>'),
      section('7. False or abusive reports',
        '<p>Knowingly false, abusive or bad-faith reports may themselves breach these Terms. Little Feet may restrict misuse of the reporting process while preserving any rights a person has under applicable law.</p>'),
      section('8. Applicable South African law',
        '<p>This policy is intended to operate consistently with the Copyright Act 98 of 1978, Trade Marks Act 194 of 1993, Electronic Communications and Transactions Act 25 of 2002, Cybercrimes Act 19 of 2020 and Consumer Protection Act 68 of 2008 where applicable. It does not create rights that the law does not provide and does not remove rights that cannot lawfully be waived.</p>'),
      '<p class="meta" style="margin-top:14px;">For formal legal enforcement or registration work, the rights owner should use the correct legal entity name and obtain South African intellectual-property advice where appropriate.</p>',
      '</div>'
    ].join('');
  }

  function openPopiaPrivacyNotice() {
    window.openModal?.('Privacy & POPIA Notice', privacyNoticeMarkup());
  }

  function openTermsOfService() {
    window.openModal?.('Terms of Service · South Africa', termsMarkup());
  }

  function openCopyrightContentPolicy() {
    window.openModal?.('Copyright, Trade Marks & Intellectual Property', copyrightPolicyMarkup());
  }

  Object.assign(window, {
    LITTLE_FEET_PRIVACY_VERSION: PRIVACY_VERSION,
    LITTLE_FEET_TERMS_VERSION: TERMS_VERSION,
    LITTLE_FEET_IP_VERSION: IP_VERSION,
    openPopiaPrivacyNotice,
    openTermsOfService,
    openCopyrightContentPolicy
  });
})();