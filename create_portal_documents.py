from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib import colors
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.lib.colors import HexColor

ROOT = Path(r"C:\Users\Chris\littlesteps")
OUT = ROOT / "output" / "pdf"
OUT.mkdir(parents=True, exist_ok=True)
LOGO = ROOT / "logo.png"
IMG = {
    "home": Path(r"C:\Users\Chris\AppData\Local\Temp\codex-clipboard-a5be3b5f-4229-4f5f-a66f-c1e9ed5e8cf9.png"),
    "schedule": Path(r"C:\Users\Chris\AppData\Local\Temp\codex-clipboard-b7654a97-a6db-47ea-a33c-38420a1bc493.png"),
    "chat": Path(r"C:\Users\Chris\AppData\Local\Temp\codex-clipboard-adea5e49-8c5f-488a-80d5-498b48bfac96.png"),
    "alerts": Path(r"C:\Users\Chris\AppData\Local\Temp\codex-clipboard-ecd78aec-c8df-4afc-b775-401c4c0f7ab3.png"),
    "store": Path(r"C:\Users\Chris\AppData\Local\Temp\codex-clipboard-7ecf2124-681f-4254-abd0-6748d96da0f9.png"),
}

NAVY = HexColor("#071521")
INK = HexColor("#102f4a")
PANEL = HexColor("#17395b")
TEAL = HexColor("#10a69d")
MINT = HexColor("#76e2c6")
WHITE = colors.white
SOFT = HexColor("#eaf4f6")
MUTED = HexColor("#9fb4c8")
GOLD = HexColor("#f1bd61")
RED = HexColor("#e85c65")

def wrap(c, text, font, size, width):
    words = text.split()
    lines, line = [], ""
    for word in words:
        attempt = (line + " " + word).strip()
        if stringWidth(attempt, font, size) <= width:
            line = attempt
        else:
            if line: lines.append(line)
            line = word
    if line: lines.append(line)
    return lines

def text_block(c, x, y, text, width, size=10, color=SOFT, leading=None, font="Helvetica"):
    leading = leading or size * 1.35
    c.setFont(font, size); c.setFillColor(color)
    for line in wrap(c, text, font, size, width):
        c.drawString(x, y, line)
        y -= leading
    return y

def bullet_list(c, x, y, entries, width, size=10.1, color=SOFT, gap=6):
    for heading, body in entries:
        c.setFillColor(TEAL); c.circle(x + 3, y + 3, 2.1, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", size); c.setFillColor(WHITE)
        c.drawString(x + 12, y, heading)
        indent = x + 12 + stringWidth(heading, "Helvetica-Bold", size) + 4
        available = max(70, width - (indent - x))
        first, *rest = wrap(c, body, "Helvetica", size, available)
        c.setFont("Helvetica", size); c.setFillColor(color); c.drawString(indent, y, first)
        y -= size * 1.35
        for line in rest:
            c.drawString(x + 12, y, line); y -= size * 1.35
        y -= gap
    return y

def cover(c, w, h, title, subtitle, label, presentation=False):
    c.setFillColor(NAVY); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(INK); c.circle(w*.79, h*.75, h*.38, fill=1, stroke=0)
    c.setFillColor(TEAL); c.circle(w*.79, h*.75, h*.31, fill=0, stroke=1)
    if LOGO.exists():
        if presentation:
            c.drawImage(str(LOGO), 52, h-220, width=152, height=152, preserveAspectRatio=True, mask='auto')
        else:
            c.drawImage(str(LOGO), (w-170)/2, h-235, width=170, height=170, preserveAspectRatio=True, mask='auto')
    if presentation:
        x, y = 58, h-274
    else:
        x, y = 55, h-285
    c.setFillColor(MINT); c.setFont("Helvetica-Bold", 10); c.drawString(x, y, label.upper())
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 27 if presentation else 25)
    y -= 38
    for line in wrap(c, title, "Helvetica-Bold", 27 if presentation else 25, w-115):
        c.drawString(x, y, line); y -= 34
    y -= 8
    y = text_block(c, x, y, subtitle, w-115, 13 if presentation else 12, MUTED, 18)
    c.setStrokeColor(TEAL); c.setLineWidth(2); c.line(x, 54, w-55, 54)
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 10); c.drawString(x, 32, "Little Feet | Every Little Step Matters")
    c.setFillColor(MUTED); c.setFont("Helvetica", 8.5); c.drawRightString(w-55, 32, "Prepared August 2026")

def page_base(c, w, h, title, kicker, number, manual=False):
    c.setFillColor(NAVY); c.rect(0, 0, w, h, fill=1, stroke=0)
    c.setFillColor(INK); c.rect(0, h-65, w, 65, fill=1, stroke=0)
    c.setFillColor(TEAL); c.rect(0, h-65, w, 4, fill=1, stroke=0)
    c.setFillColor(MINT); c.setFont("Helvetica-Bold", 8.5); c.drawString(40, h-25, kicker.upper())
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 18 if manual else 20); c.drawString(40, h-50, title)
    c.setStrokeColor(HexColor("#244a6c")); c.line(40, 34, w-40, 34)
    c.setFillColor(MUTED); c.setFont("Helvetica", 8); c.drawString(40, 20, "Little Feet ECD Portal")
    c.drawRightString(w-40, 20, f"{number}")

def card(c, x, y, w, h, label, title, body, accent=TEAL):
    c.setFillColor(PANEL); c.roundRect(x, y-h, w, h, 10, fill=1, stroke=0)
    c.setFillColor(accent); c.roundRect(x, y-h, 5, h, 3, fill=1, stroke=0)
    c.setFillColor(MINT); c.setFont("Helvetica-Bold", 8); c.drawString(x+18, y-20, label.upper())
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold", 12); c.drawString(x+18, y-41, title)
    text_block(c, x+18, y-60, body, w-35, 9.2, SOFT, 12.5)

def screenshot(c, path, x, y, w, h):
    c.setFillColor(PANEL); c.roundRect(x, y-h, w, h, 10, fill=1, stroke=0)
    if path.exists():
        c.drawImage(str(path), x+5, y-h+5, width=w-10, height=h-10, preserveAspectRatio=True, anchor='c', mask='auto')
    else:
        c.setFillColor(MUTED); c.setFont("Helvetica", 10); c.drawCentredString(x+w/2, y-h/2, "Portal screenshot unavailable")

def presentation():
    path = OUT / "LittleSteps_Platform_Presentation_2026.pdf"
    w, h = landscape(A4); c = canvas.Canvas(str(path), pagesize=(w,h)); c.setTitle("LittleSteps Platform Presentation")
    cover(c,w,h,"LittleSteps Platform Presentation","A practical, role-aware operating portal for early childhood development, school administration, family engagement, and safeguarding.","Executive overview", True); c.showPage()
    pages = [
        ("One connected school experience", "Platform overview", [
            ("One portal, six working areas", "LittleSteps brings learning records, care routines, communication, operations, family access, and school administration into a single web experience."),
            ("Designed around people", "Parents, teachers, principals, district users, and administrators each see the functions relevant to their role and subscription."),
            ("Responsive by default", "The layout adapts for desktop, tablet, phone, and shared-display use, with a compact tab navigator for smaller screens."),
        ]),
        ("Role-aware access", "People and permissions", [
            ("Parents", "View their own child\'s updates, reports, schedules, alerts, school-store links, and consent choices."),
            ("Teachers", "Log daily routines, attendance, learning evidence, classroom schedules, supply requests, and parent-ready reports."),
            ("Principals and districts", "Review school activity, operational records, growth indicators, and approved governance information."),
            ("Administrators", "Manage accounts, role assignment, school linkage, subscriptions, staff records, notices, and service configuration."),
        ]),
        ("Learning, records, and visibility", "Teaching and learner progress", [
            ("Daily care automation", "One-tap meal, nap, mood, toileting and diaper entries reduce repeated manual notes while keeping a clear family update trail."),
            ("Schedules and templates", "Teachers can create schedules, download import templates, upload spreadsheet data, and export records for review."),
            ("Progress analytics", "Term views calculate improvement or decline, identify strongest and weakest recorded tests, and present parent-ready progress summaries."),
            ("Report acknowledgement", "Teacher and parent confirmation can use personal PINs and drawn signatures before a report is marked complete."),
        ]),
        ("Communication that reaches the right people", "Family engagement and alerts", [
            ("Activity feed and messaging", "Staff group chat, direct conversations, notices, support tickets, and read-aware broadcasts keep day-to-day communication in one place."),
            ("Location-aware emergency notices", "Area alerts are designed to notify people in the selected area, include a clear sound cue, keep an audit-friendly record, and support removal when no longer needed."),
            ("Updates and wellbeing", "A dismissible notice board highlights new features; short family advice banners can rotate without disrupting the working screen."),
            ("School-specific store", "The store points to the school linked to the user. Where no school web store is configured, the portal says so instead of advertising unrelated products."),
        ]),
        ("Safeguarding and responsible data use", "Privacy and child protection", [
            ("Consent choices", "Parent onboarding includes separate consent choices for internal learning updates and optional marketing imagery."),
            ("Protected records", "Medical, emergency-contact, pickup and report data are separated by role. The portal is structured to restrict parent access to their own children and teacher access to assigned classes."),
            ("Pickup and incident controls", "Pickup details, check-in records, incident forms, medication authorisation, visual allergy flags, PIN checks, and signed acknowledgement support safer daily handovers."),
            ("Compliance readiness", "Staff verification fields, consent records, access controls, and legal notices support a POPIA- and Children\'s Act-aware operating approach. A school must still obtain its own legal and security review before production use."),
        ]),
        ("School operations in one place", "Administration and service delivery", [
            ("Accounts and registry", "Admins can create, link, rename and manage accounts against a school record, while self-registration supports parents, teachers and principals."),
            ("Finance and enrolment", "Subscriptions, payment-rule planning, sibling or subsidy considerations, invoicing requirements, and account-level entitlements have a clear home in the portal."),
            ("Care, safety and stock", "Medication logs, dietary/allergy information, ratio monitoring, incident records, supply requests and stock-intake workflows are accessible to the relevant operational teams."),
            ("Nearby school discovery", "The 20 km map uses a user\'s optional location and public OpenStreetMap data to group education facilities, show details when available, and distinguish the user\'s location."),
        ]),
        ("Subscription-based value", "Plans and access", [
            ("School subscription tiers", "Micro/ECD, Standard Primary and Enterprise Campus tiers can be shown with the supplied institutional pricing and operational advantages."),
            ("Parent access", "A parent\'s linked school and subscription determine which tabs and detailed features are available. LittleSteps Plus is positioned for enhanced family features, including richer progress insight."),
            ("Feature gates", "The navigation and page actions can be hidden or shown by role and subscription instead of presenting unavailable tools."),
            ("Integration boundaries", "Payments, Google/Yahoo/Microsoft sign-in, SMS, push notifications and external payroll connections require provider configuration, account approval and production security work."),
        ]),
        ("A reliable route to production", "Implementation priorities", [
            ("1. Secure foundation", "Use HTTPS, managed identity, server-enforced permissions, secure secret storage, backups, retention controls and audit logging."),
            ("2. Configure the school", "Create the school record, approve account roles, set subscription rules, add trusted staff and define consent and pickup practices."),
            ("3. Train by role", "Use the illustrated guide, schedule templates and staged onboarding so staff learn only the workflows they need."),
            ("4. Connect services", "Enable verified email/SMS/push, payment, payroll or identity providers only after a school has approved the appropriate contracts and data-processing arrangements."),
        ]),
        ("A transparent commercial model", "Trial, contract and service terms", [
            ("Two-week trial", "Offer a 14-day guided trial with a clearly scoped sandbox, onboarding support and no production child-data migration until the school approves go-live."),
            ("30-day money-back commitment", "A 30-day money-back guarantee can be offered from paid activation, subject to published eligibility, refund process and consumer-law review."),
            ("36-month agreement", "The proposed school agreement has a 36-month term. Pricing, renewal, service scope, data export and early-exit terms must be accepted in writing."),
            ("Fixed charges", "Cancellation requires two months' advance notice and is calculated from the school plan. Post-contract customisation work is quoted as a fixed plan-based fee before work begins."),
        ]),
        ("Finance without manual reconciliation", "Billing and accounting automation", [
            ("Payment reliability", "Use recurring debit/card collection with monitored failed payments, configurable retry timing, clear family notices and a finance-team review queue."),
            ("Flexible parent billing", "Support split-custody payers, partial government subsidies, sibling discounts, payment plans and school-approved exceptions through auditable invoice rules."),
            ("Accounting integrations", "Send approved payment, refund and invoice events to configured Xero, Sage or QuickBooks connectors so finance teams do not reconcile each transaction manually."),
            ("Controls and limits", "Each provider integration needs its own contract, API credentials, reconciliation testing, data-processing assessment and failure-handling process before launch."),
        ]),
        ("A calmer navigation experience", "Information architecture and dashboards", [
            ("Categorised sidebar", "Replace 23+ horizontal tabs with a responsive category menu: Academics, Family, Finance, Operations, Safety, Administration and Help. Keep a compact mobile drawer for small screens."),
            ("Relevant work only", "Parents, teachers, principals, districts and departments receive only the categories, events, records and actions needed for their role."),
            ("Fitted dashboards", "Use responsive cards, summary counts, action queues and contextual shortcuts so dashboards fit on phone, tablet, desktop and shared displays without overlap."),
            ("Accessible theme", "White mode must maintain readable text and contrast. Validate labels, inputs, notices and map popups in both themes before release."),
        ]),
        ("Trusted records from the start", "Data integrity, forms and templates", [
            ("Unique data basis", "Use primary keys, foreign keys and server-side unique constraints to prevent duplicate accounts, child records, imports and documents. Show a clear 'Duplicate record already exists' message."),
            ("Random identifier service", "Generate collision-resistant record codes server-side and never use a visible random number alone as an authority or access credential."),
            ("Import review", "For photo/OCR or template imports, extract supported fields, show a review screen, require 'Are you sure?', and offer Edit before any record is submitted."),
            ("Form library", "Provide required field forms and CSV/Excel/PDF-compatible templates per workflow, plus a controlled form-template editor for approved school-specific versions."),
        ]),
        ("Continuity when the primary service is unavailable", "Cloud, backup and failover", [
            ("Primary and recovery environment", "Host encrypted operational data in managed primary storage and a tested backup/recovery environment with documented recovery point and recovery-time objectives."),
            ("Replication", "Continuously replicate essential records with monitored lag and conflict controls. Test attendance and incident write paths during a planned failover; asynchronous replication cannot promise zero loss."),
            ("Automatic routing", "Use Cloudflare or Route 53 health checks and load-balancer failover so the normal school address routes to the healthy service without asking teachers to type a raw backup URL."),
            ("Maintenance status", "A global banner and live status signal can announce planned work, expected impact and the approved backup-service route when necessary."),
        ]),
        ("Errors that are actionable, not alarming", "Central error architecture", [
            ("Express middleware", "Capture exceptions in central Node/Express error middleware, assign a unique code such as ERR-AUTH-001 or ERR-DB-502, and record safe execution context for administrators."),
            ("Right information for each role", "Staff see a calm message and Support Desk action. Administrators see the correlation code, event time, safe diagnostic details and protected source context where authorised."),
            ("Help Desk handoff", "The client can direct a user to Support Desk with an error reference. Avoid exposing stack traces, database names, tokens or sensitive child data in browser messages."),
            ("Operational monitoring", "Track error rate, severity, code frequency, maintenance state and recovery status through protected monitoring - not through an unprotected public page."),
        ]),
        ("Child identity with privacy safeguards", "Confidential learner records", [
            ("Encrypted personal information", "Encrypt child names, identifiers, medical details and sensitive contacts in transit and at rest, with managed keys, access logging, retention rules and least-privilege access."),
            ("School-issued child code", "Assign a non-predictable child reference code for physical registers. Entering the code identifies the record only after an authorised user is authenticated; the code must not replace access control."),
            ("Required school fields", "The child profile form includes grade, class, identity and contact data, care and medical flags, authorised pickups, consent choices and school-required forms."),
            ("Recovery and exports", "Admins can revoke a lost code and issue a replacement with an audit trail. Generate carefully controlled PDF, CSV and Excel code-register templates for authorised physical recordkeeping."),
        ]),
        ("Safe school discovery and applications", "Map, admissions and departments", [
            ("School information", "Map data should use verified public sources, label missing details honestly and avoid inventing contacts. Only public building or campus photos may be displayed - never child photos."),
            ("Apply or link", "A map pin can offer Apply or Link to School. The request contains the approved application form and is delivered by authorised email or in-portal notification."),
            ("Two-way approval", "The receiving school verifies or declines the request before creating the active relationship. Applicants can see status without gaining school data prematurely."),
            ("Department-aware setup", "Configure education, administration, finance, human resources, care/safety, operations, stock, communication and support roles per school. Do not enable a department merely because the tab exists."),
        ]),
        ("Defence against account and data misuse", "Security response and POPIA readiness", [
            ("Suspicious activity response", "Detect excessive child-record queries, repeated failed logins or abnormal exports. Notify authorised administrators/principals with the account, IP, event timing and affected service context."),
            ("Immediate account containment", "Revoke server-side sessions/JWTs, cancel authorised download streams, block further API access, and push a locked-screen state. A browser app cannot turn off a device's physical internet connection."),
            ("Investigate before broad shutdown", "Use rate limits, IP/WAF controls, audit evidence and an incident workflow. Avoid automatically taking every school user offline without a documented risk decision and incident authority."),
            ("Section 22 workflow", "Provide an incident-report pack for the responsible party and information officer. Where there are reasonable grounds for unauthorised access or acquisition, POPIA section 22 requires notification of the Information Regulator and affected data subjects as soon as reasonably possible, subject to the Act and legal advice."),
        ]),
        ("People and compliance never expire silently", "Human resources and safety controls", [
            ("HR compliance vault", "Store approved First Aid, criminal-clearance and ECD-qualification records with document dates, owner, verification state and protected access."),
            ("30-day expiry warnings", "Notify administrators 30 days before a monitored credential expires and show an action queue for renewal, verification, suspension or escalation."),
            ("Staff-to-child monitoring", "Track checked-in children and available staff against school-set room ratios, surfacing exceptions to authorised supervisors."),
            ("Safeguarding boundaries", "Credential monitoring supports school governance but does not verify a qualification, clearance or legal right to work by itself. The school must complete the required checks."),
        ]),
    ]
    for idx,(title,kicker,cards) in enumerate(pages,2):
        page_base(c,w,h,title,kicker,idx)
        cols = 3 if len(cards)==3 else 2
        gap=18; left=40; top=h-95; cardw=(w-80-gap*(cols-1))/cols; cardh=118 if len(cards)<=3 else 108
        for i,item in enumerate(cards):
            row=i//cols; col=i%cols
            card(c,left+col*(cardw+gap),top-row*(cardh+18),cardw,cardh,"Feature",item[0],item[1], TEAL if i%2==0 else GOLD)
        c.showPage()
    c.save()
    return path

def manual():
    path = OUT / "LittleSteps_User_Manual_2026.pdf"
    w,h=A4; c=canvas.Canvas(str(path),pagesize=(w,h)); c.setTitle("LittleSteps User Manual")
    cover(c,w,h,"LittleSteps User Manual","A practical guide for parents, educators, principals, district users and administrators.","Portal guide", False); c.showPage()
    page_base(c,w,h,"Start here","Getting started",2,True)
    y=h-95
    y=bullet_list(c,48,y,[
        ("Sign in securely", "Use your approved staff ID or parent email and password/PIN. Keep the device-save option enabled only on a personal, protected device."),
        ("Choose your role", "Your school link, role and subscription decide which tabs are visible. Ask an administrator or use self-registration if your account is not yet created."),
        ("Read notices", "The Terms and Privacy notice explains the school\'s data-use expectations. Review it before continuing and update consent choices when your circumstances change."),
        ("Use the tab view", "On a phone or tablet, use the compact menu to reach every available section. On large screens, the same tabs remain in the header."),
    ], w-96,10.2)
    c.setFillColor(PANEL); c.roundRect(48,88,w-96,92,10,fill=1,stroke=0)
    c.setFillColor(MINT); c.setFont("Helvetica-Bold",11); c.drawString(65,154,"Quick support")
    text_block(c,65,134,"If the portal shows an unexpected error, open Support Desk. The report includes a plain-language summary and relevant technical reference for the school support team; do not paste sensitive child data into a support ticket.",w-130,9.5,SOFT,13)
    c.showPage()
    page_base(c,w,h,"Home and navigation","Portal tour",3,True)
    screenshot(c,IMG['home'],40,h-105,w-80,300)
    y=h-430
    y=bullet_list(c,48,y,[
        ("Home", "Start with session information, notices, the optional nearby-school map and shortcuts to the most-used functions."),
        ("Nearby schools", "Choose Detect My Location only when you consent to use location. Pins are grouped for clarity; public contact details may be incomplete when the source does not publish them."),
        ("Service indicator", "The header uses green for online, yellow for slow/traffic conditions, and red for offline. It is an operational status cue, not a guarantee of service availability."),
    ],w-96,9.6)
    c.showPage()
    page_base(c,w,h,"Schedules and learning records","Educator workflow",4,True)
    screenshot(c,IMG['schedule'],40,h-105,w-80,300)
    bullet_list(c,48,h-435,[
        ("Create a schedule", "Select the learner, day, time block and activity, then save. Use consistent activity names so reporting remains clear."),
        ("Use a template", "Download the schedule template, complete it in a spreadsheet, then import it. Export current schedules when you need a review copy."),
        ("Record learning", "Add worksheets, observations, milestone tags and appropriate photo evidence only for children you are authorised to view."),
        ("Share reports safely", "Publish a report for the linked parent. Teacher and parent signatures, protected by separate PINs, are required before final completion."),
    ],w-96,9.5)
    c.showPage()
    page_base(c,w,h,"Attendance, care and progress","Everyday records",5,True)
    y=h-100
    y=bullet_list(c,48,y,[
        ("Attendance", "Record check-in and check-out with the correct learner name. Use the import template for an approved roster; review the daily registry before clearing anything."),
        ("Daily care", "Use one-tap logs for meals, naps, mood, toileting/diaper checks and care notes. Record factual, respectful information only."),
        ("Medical and safety", "Check allergy cards and authorised pickup details before care or dismissal. Medication requires the school\'s required approval and staff sign-off process."),
        ("Analytics", "Select the child and calculate metrics to compare recorded results. The view highlights percentage movement and best/worst assessed results; detailed analytics are shown only when the parent subscription permits them."),
        ("Reports by month", "Store work and reports against the correct month so families and teachers can locate an accurate history later."),
    ],w-96,10)
    c.showPage()
    page_base(c,w,h,"Communication and alerts","Keeping families informed",6,True)
    screenshot(c,IMG['chat'],40,h-105,(w-95)/2,225); screenshot(c,IMG['alerts'],(w+15)/2,h-105,(w-95)/2,225)
    bullet_list(c,48,h-365,[
        ("Staff chat", "Select the group or direct conversation, write a concise message and send. Keep child-sensitive details within approved school channels."),
        ("Broadcast alerts", "Choose the alert type, audience and area carefully. Area-aware alerts are intended for users within the configured area, with a short sound cue for urgency."),
        ("Notice board", "Read new portal updates and school announcements. You can close optional advice banners; the portal remembers the dismissal preference."),
        ("Support desk", "Create a ticket when help is needed and include the screen, action and time. Avoid passwords, ID numbers and medical details in the message."),
    ],w-96,9.5)
    c.showPage()
    page_base(c,w,h,"School services and administration","Accounts, school links and store",7,True)
    screenshot(c,IMG['store'],40,h-105,w-80,260)
    bullet_list(c,48,h-395,[
        ("School store", "This area is specific to the school linked to your account. If no store URL or catalogue is configured, the portal displays that the school has no web store."),
        ("Account management", "Administrators can create accounts, connect them to a school, set a role, change a display name, deactivate access and review records."),
        ("Self-registration", "Parents, teachers and principals can request an account from the login screen. An authorised school administrator should verify the link before sensitive access is granted."),
        ("Operations", "Finance, stock intake, resources, safeguarding, progress and engagement tools should be used only by staff whose role gives them access."),
    ],w-96,9.4)
    c.showPage()
    page_base(c,w,h,"Privacy, safety and consent","Responsible use",8,True)
    y=h-100
    y=bullet_list(c,48,y,[
        ("Consent first", "Only publish a child\'s media or learning update within the consent choices recorded for that family. Internal class updates and marketing imagery are separate decisions."),
        ("Keep information private", "Do not share login details, export records without authority, or expose another family\'s information in messages, reports or incident records."),
        ("Protect pickup", "Confirm the approved pickup adult and use the configured PIN/QR verification process. Escalate uncertainty to a manager before releasing a child."),
        ("Write objective records", "Incident notes should describe what happened, what care was provided, and the next action. Do not include another child\'s identifying information."),
        ("Know the limits", "The portal supports POPIA- and Children\'s Act-aware workflows, but each school remains responsible for legal review, training, security configuration, retention policy and incident response."),
    ],w-96,9.8)
    c.showPage()
    page_base(c,w,h,"Phone, tablet and shared screen use","Responsive tips",9,True)
    y=h-100
    y=bullet_list(c,48,y,[
        ("Phone", "Use the compact tab menu, work one card at a time, and rotate to landscape only where a table or signature box needs more space."),
        ("Tablet", "Use templates for fast classroom entry. Keep the device locked between learners and ensure signatures are completed by the authorised adult."),
        ("TV or shared display", "Use the home dashboard, notices and non-sensitive schedules. Avoid displaying child records, contact details, alerts or medical information on public screens."),
        ("Accessibility", "Use clear labels, high contrast mode where available, and larger browser text. Tell the school if an important task cannot be completed accessibly."),
    ],w-96,10.2)
    c.setFillColor(PANEL);c.roundRect(48,118,w-96,88,10,fill=1,stroke=0)
    c.setFillColor(MINT);c.setFont("Helvetica-Bold",11);c.drawString(65,178,"Before you leave")
    text_block(c,65,157,"Save your work, sign out on shared devices, and report any unexpected access or data issue through Support Desk immediately.",w-130,10,SOFT,14)
    c.showPage()
    page_base(c,w,h,"Common questions","Troubleshooting",10,True)
    y=h-100
    y=bullet_list(c,48,y,[
        ("I cannot see a tab", "Your role, school link or subscription may not include it. Ask an administrator to check your account rather than using another person\'s login."),
        ("A report will not complete", "Confirm that the teacher and parent have each entered their own PIN and drawn their signature. Refresh only after saving the current work."),
        ("The school map is slow", "Location lookup and public map data can take time. Reduce the map area, wait for the status message, or try again on a stable connection."),
        ("I need technical help", "Open Support Desk. If the portal detects an application error, it can direct you there with a support reference and relevant context for the school\'s technical team."),
        ("Who owns the data?", "The school is responsible for its learner and family data. Follow the school\'s privacy notice, consent settings and retention policy."),
    ],w-96,10)
    c.setFillColor(TEAL); c.roundRect(48,96,w-96,54,10,fill=1,stroke=0)
    c.setFillColor(WHITE); c.setFont("Helvetica-Bold",12); c.drawCentredString(w/2,119,"Need help? Start with Support Desk or your school administrator.")
    c.save(); return path

if __name__ == '__main__':
    print(presentation())
    print(manual())
