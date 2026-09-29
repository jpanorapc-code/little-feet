# Vendor / Operator and Cross-Border Register

**Review date:** 2026-09-29  
**Owner:** Information Officer

This register separates facts verified from provider-published contractual material from facts that require Little Feet account-specific evidence. POPIA section 72 requires an applicable cross-border basis. A provider publishing GDPR/SCC safeguards is evidence of contractual safeguards, but is not by itself recorded here as a final legal conclusion that every Little Feet transfer satisfies section 72.

| Provider/service | Purpose | Role | Verified location / transfer facts | Contract and security evidence | POPIA s72 assessment | Status / action |
|---|---|---|---|---|---|---|
| Render | Application/database hosting as configured | Processor/service provider for customer data | Render offers Oregon, Ohio, Virginia, Frankfurt and Singapore service/datastore regions. Render states its primary processing operations take place in the United States and its privacy policy states the service is hosted/operated in the US. Little Feet's actual selected service/database region must still be captured from its Render dashboard. | Render Terms incorporate its DPA. DPA identifies Render as processor (subject to stated exceptions), restricts processing to agreement/instructions, requires confidentiality, comparable written subprocessor obligations, security measures, breach handling, SCC/DPF transfer safeguards, encryption at rest and TLS in transit. | Binding contractual safeguards are documented. Final Little Feet section 72 basis remains **PARTIAL** until the selected region and applicability/adequacy of the contractual basis for the South African transfer are recorded. | **PARTIAL — capture deployed service/database region.** |
| Cloudflare R2 | Private object storage | Processor/service provider | Little Feet bucket is configured with R2 Automatic placement. Cloudflare states Automatic chooses a bucket location based on the closest available region to the bucket-creation request; a specific country is not guaranteed by a Location Hint. Cloudflare's services operate across a global network. | Cloudflare DPA v6.4 (effective 2026-04-03) forms part of the applicable main agreement, identifies Cloudflare as processor/subprocessor as applicable, requires written subprocessor protections, contains transfer safeguards and published security measures. | Binding contractual safeguards are documented, but the exact R2 object location is not established from the current configuration. Final section 72 assessment remains **PARTIAL** pending confirmation that the contractual basis used by Little Feet provides the required POPIA level for the relevant transfers. | **PARTIAL — retain Automatic-location evidence; do not claim South African storage.** |
| Zoho Mail | Company email/communications | Operator/service provider where applicable | Zoho's South Africa privacy notice says personal information/service data may be processed, transferred and stored in the US, EEA and other countries where Zoho operates. No Little Feet-specific mail data-centre location has been verified. | Zoho publishes a South Africa POPIA privacy notice and expressly offers a POPIA-compliant operator agreement. Zoho says it can be requested from legal@zohocorp.com; its account help also provides an administrator DPA initiation flow. | Strong provider-specific POPIA path exists, but Little Feet must actually initiate/sign the operator/DPA agreement before recording the contractual basis as executed. | **ACTION REQUIRED — initiate and sign Zoho operator/DPA agreement.** |
| Other payment/email/OAuth providers | Only if enabled/configured | To determine per integration | Not assessed until enabled | Review before production processing | Must establish applicable section 72 basis before foreign transfer | **OPEN IF ENABLED** |

## Section 72 rule used for this review
A South African responsible party may transfer personal information to a recipient in a foreign country only where one of POPIA section 72(1)'s grounds applies. One ground is that the recipient is subject to a law, binding corporate rules or binding agreement providing an adequate level of protection substantially similar to POPIA and appropriate onward-transfer protections. Other statutory grounds include qualifying consent and specified contractual/benefit circumstances.

## Provider evidence reviewed
### Render
- Render Data Processing Addendum, last modified 2024-12-19.
- Render Terms of Service, last modified 2026-07-10.
- Render Regions documentation.
- Render Privacy Policy transfer disclosures.

### Cloudflare
- Cloudflare Data Processing Addendum v6.4, effective 2026-04-03.
- Cloudflare R2 Data Location documentation, updated 2026-08-19.
- Cloudflare Data Localization R2 documentation.
- Cloudflare Information Security Exhibit, effective 2026-02-14.

### Zoho
- Zoho South Africa Privacy Policy, last updated 2025-11-12.
- Zoho Accounts documentation for initiating a DPA.

## Required account-level evidence
1. **Render:** record the actual region selected for each Little Feet web service and database. Do not infer it from Render's available regions.
2. **Cloudflare R2:** current Automatic placement does not prove a South African storage location. Preserve this fact in public/internal cross-border wording.
3. **Zoho:** administrator must initiate and complete the POPIA operator/DPA signature process. Until signed, status remains action required.
4. Re-screen prior-authorisation requirements if children's or special personal information will be transferred to a foreign recipient without an adequate section 72 protection basis.

## Review cadence
Review this register at least annually and whenever a provider, service region, storage configuration, subprocessor arrangement or material data flow changes.
