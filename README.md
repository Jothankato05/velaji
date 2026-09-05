# Velaji

**Author:** Jothan Jerry Kato ([@Jothankato05](https://github.com/Jothankato05))

> **Velaji is the platform. NCIHAP is the programme.**
> **Velaji** is the software platform — the product built, owned, and
> maintained here. The **National Child Immunisation & Health Assurance
> Programme (NCIHAP)** is the programme concept Velaji is designed to deliver.
> The two are deliberately kept separate: a programme is owned and named by
> whoever runs it; Velaji is the *technology* underneath. This repository is
> Velaji.

A coined name, chosen deliberately over a real local-language compound:
every short, meaningful Yoruba/Igbo/Hausa word tried for this (toju, dagba,
kwado, aabo...) turned out to already belong to a real company somewhere —
this space is heavily mined. Velaji is short, easy to say, and — as far as
search engines, npm, and GitHub can confirm — genuinely not in use anywhere
yet.

A working software prototype for the parts of the NCIHAP concept that are
actually buildable as software by one team, right now.

The name was chosen after checking it against search engines, npm, and
GitHub — as a single word it returns no existing product, company, notable
person, or package with this name. That's not a substitute for a real
trademark/CAC search before any formal launch, but it's clean as far as
open research can confirm.

## The problem this targets (real numbers)

The design choices here are aimed at a real, documented situation, not a
hypothetical one:

- **~2.3 million zero-dose children** — children who have received no routine
  vaccine — live in Nigeria, the second-highest burden in the world, with more
  than two million added each year ([Gavi ZDLH](https://zdlh.gavi.org/sites/default/files/2023-12/ZDLH_Nigeria_Situation_Analysis_2023.pdf), [UNICEF DATA](https://data.unicef.org/topic/child-health/immunization/)).
- National coverage is low and drops across the schedule: **DTP1 ≈ 71%, DTP3 ≈
  67%, MCV1 ≈ 57%** (WHO/UNICEF 2024) — the fall from first contact to
  completion is exactly the "defaulting" this system is built to catch.
- The burden is **geographically concentrated** in the north-west and
  north-east: **Katsina, Sokoto and Zamfara record coverage below 40%** — among
  the lowest anywhere for a high-burden country ([spatiotemporal analysis](https://www.medrxiv.org/content/10.64898/2026.01.19.26344414v1.full)).
- Low routine coverage has real consequences: the **2022–2025 diphtheria
  outbreak** reached ~43,700 suspected cases across 37 states, with **Kano alone
  accounting for over half** ([ReliefWeb](https://reliefweb.int/report/nigeria/nigeria-diphtheria-outbreak-operation-update-mdrng037)).
- Published national targets — a **30% cut in zero-dose children by 2025, 50% by
  2028**, with **100 priority LGAs** — are the kind of objective a national
  command view and a facility-level recovery workflow would have to support.
  They are cited here as context, not as a brief: nothing in this repository is
  commissioned by, affiliated with, or endorsed by any agency.
- The routine schedule is itself moving: NPHCDA **introduced the
  Measles–Rubella (MR) vaccine in the 2025/26 integrated campaign** — "Africa's
  largest", targeting 100M+ children — alongside nOPV2, malaria (R21) and HPV
  ([WHO Afro](https://www.afro.who.int/countries/nigeria/news/nigeria-intensifies-fight-against-vaccine-preventable-diseases-nationwide-measles-rubella-and-polio), [NPHCDA](https://nphcda.gov.ng/measles-rubella-vaccine/)). The bundled schedule tracks that (`src/data/routine-immunization-schedule.ts`).

- **The zero-dose child and the unregistered child overlap strongly, and often
  are the same child.** Only **57%** of under-five births are registered with
  civil authorities (MICS 2021; the administrative figure is 53%), and Nigeria
  accounts for **11% of all unregistered children in West Africa**. Measured
  across all 37 states from the same survey, registration and Penta3 correlate
  at **r = 0.70** — a strong overlap, not an identity. **Twenty-five of 37
  states** sit on the same side of the national average on both and **eleven
  fall below on both**, while **twelve break the pattern**, Katsina (67.9%
  registered against 41% Penta3) and Bayelsa (28.2% against 70%) most visibly.
  The extremes line up — **Lagos 94% and FCT 87%, against Jigawa 23.6% and
  Sokoto 22.5%** — and for the same documented reason: births at home, without a
  skilled attendant, in rural areas ([UNICEF](https://www.unicef.org/nigeria/press-releases/only-43-cent-nigerian-childrens-births-registered-unicef), [MICS 2021](https://www.nigerianstat.gov.ng/download/1241212)).
  This matters beyond identity: BHCPF's Vulnerable Group Fund covers under-fives
  and pregnant women, but enrolment runs on the **social register and the NIN** —
  so a child with no birth registration has no NIN, and **cannot be enrolled in
  the fund that exists for her**. Registering the child in a health record that
  can later carry across to civil registration is what breaks that loop, and it
  is why §4 of the concept ties the CHIN to the NPC record and the NIN.

Two more findings shape the design:

- **Reminders work, and multi-channel matters.** SMS reminder + defaulter-tracing
  programmes in northern Nigeria (e.g. IRISS in Kebbi) raised demand and cut
  health-worker workload at **under a quarter of the cost of home visits**, with
  defaulter tracing done by a **repeat message ~7 days after a missed
  appointment** — but **low phone ownership and low literacy** meant the message
  had to reach people by **voice or a relay contact**, not text alone
  ([BMC Public Health](https://bmcpublichealth.biomedcentral.com/articles/10.1186/s12889-022-14822-1)).
  That is why the reminder engine is channel-agnostic and why **USSD** is
  first-class here.
- **The incentive rides real machinery.** The **NHIA Act 2022** made health
  insurance mandatory, and the **Basic Health Care Provision Fund (BHCPF)** —
  funded by ≥1% of the Consolidated Revenue Fund (₦125.7b in 2024 → ₦282.7b in
  2025) — names **reducing zero-dose children and raising 0–12-month full
  immunisation among its explicit outcomes**, delivered through NHIA and State
  Social Health Insurance Agencies ([NHIA](https://www.nhia.gov.ng/), [Nigeria Health Watch](https://nigeriahealthwatch.com/articles/thought-leadership/nigerias-state-health-insurance-schemes-are-expanding-enrolment-must-now-lead-to-care/)).
  The "Healthy Start" reward is modelled on exactly this — a completion incentive
  positioned as health coverage, not payment for vaccination.

This is why the system leads with **zero-dose and defaulter recovery**,
**geographic priority triage** (worst states/LGAs/facilities first), **capturing
the real barrier** on each traced case (hesitancy, distance, insecurity, …), and
**reaching caregivers who have no smartphone** (USSD) — the north-west/north-east
reality, not an idealised one.

## What this is NOT

The source concept describes national-scale ambitions — a multi-year rollout,
interoperability with national identity systems, and integration with a
health-insurance settlement layer. None of that is something a codebase can
produce: it requires authority, inter-organisation agreements, and funding
this repo has no access to. This prototype does not pretend to have solved
that layer. Where it would need to plug into an external system, it stops at
an explicit, visible seam (e.g. `nhiaIntegrationStatus: 'not_connected'` on
every certificate) instead of faking a connection.

**CHIN is not a national identity number.** It's a system-generated ID scoped
to this software only, for tracking a child across visits and facilities
when they have no birth certificate or national ID yet. See `src/services/chin.service.ts`.

**This is not a greenfield, and nothing here is unprecedented.** Nigeria already
runs **EMID** (Electronic Management of Immunization Data) — built in 2021,
DHIS2-interoperable, Gavi-funded, and under active optimisation with NPHCDA —
plus an [NPHCDA Immunization FHIR IG](https://build.fhir.org/ig/Nigeria-FHIR-Community/NPHCDA-ImmunizationIG/)
that any serious system should build to rather than around. Demand-side
incentives are already operating at scale in the north: **New Incentives / All
Babies Are Equal** reaches ~1.5M children across 9 states with RCT-measured
gains of **14–21 percentage points** ([GiveWell](https://www.givewell.org/charities/new-incentives)).
And the registry-plus-antenatal model this repo implements exists nationally
elsewhere — **India's U-WIN** completed its nationwide rollout in November 2024,
covering 19M pregnant women and 58M children.

What is *not* already joined up in Nigeria is the seam between the immunisation
record, civil registration, and health-insurance entitlement — three systems
that fail the same child without sharing an identifier. That intersection, not
the registry itself, is what this prototype is exploring.

## What this is

Four buildable pieces, wired together and tested against a real (in-memory)
database over real HTTP — not mocked:

1. **CHIN issuance** — a Child Health Identification Number with a real
   Luhn-mod-N check character, so a hand-copied or misheard ID actually gets
   caught rather than silently pointing at the wrong child.
2. **QR-verifiable digital card** — `GET /api/children/:chin/card.svg`
   renders a printable card with a QR code. The QR encodes a link signed
   with an HMAC token (same "sign what you'll be asked to prove" pattern as
   Twilio webhook validation), so scanning it can't be forged and doesn't
   require staff login.
3. **Status + reminder-ready schedule** — registering a child builds their
   full routine immunization schedule from date of birth and computes the
   five-colour status exactly per NCIHAP §10: `GREEN` on track, `AMBER` due
   soon, `RED` overdue (however long — overdue does not age into GREY),
   `GREY` = unverified/incomplete record needing reconciliation (a record
   property, not a lateness level), `BLUE` schedule complete.
4. **Geolocation-based facility handoff** — when a family moves or shows up
   at a different facility, `POST /api/children/:chin/handoff` logs the
   transfer with coordinates, and `GET /api/facilities/nearest` finds the
   closest known facility to a reported location (haversine distance).
5. **Completion certificate as a flag** — once every scheduled dose is
   recorded, a certificate record is issued automatically. It is a
   completion flag with a verification code, nothing more.
6. **Staff authentication** — every `/api/*` endpoint except
   `POST /api/auth/login` and the public `GET /api/verify/:chin` requires a
   bearer token (`Authorization: Bearer <token>`) from `/api/auth/login`.
   Passwords are scrypt-hashed, tokens are self-signed HMAC (12h TTL), no
   new dependency. There is no open registration endpoint on purpose:
   accounts are created with
   `npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [verifier|staff|admin]`,
   deliberately, by someone with server access — not self-served.
7. **Reminder engine** — a background job (`REMINDER_ENGINE_ENABLED=true`)
   scans outstanding children each cycle and sends caregivers **one** SMS per
   child, leading with the most-overdue vaccine and noting how many others
   are due (never one text per dose — that's spam and, on a paid gateway,
   money). It enforces a per-dose cooldown and an attempt cap; a child whose
   caregiver ignores the cap, or who is overdue with no reachable phone, is
   **escalated to the follow-up queue for human tracing** (NCIHAP §7
   continued-default) rather than chased by SMS forever. Sending is confined to a
   daytime window so nobody is woken at 3am. The SMS provider is a seam
   (`SMS_PROVIDER`, currently a console `stub`) — a real gateway (Twilio,
   Africa's Talking, Termii) drops in without touching the reminder logic.
   Endpoints: `POST /api/reminders/run` (admin, run a cycle on demand),
   `GET /api/children/:chin/reminders` (a child's reminder history).
8. **Escalation queue** — the reminder engine's flags don't vanish into a log;
   each becomes a durable, workable item. `GET /api/escalations` is the
   health worker's queue: every child the engine gave up texting, enriched
   with caregiver phone, facility, which vaccine, the reason (not responding
   vs. lost to follow-up), and how overdue it is — everything needed to go
   trace the family. `POST /api/escalations/:id/resolve` closes one with an
   outcome and note; recording the missing dose **auto-resolves** it, so the
   queue never shows stale work. One open item per child+dose, no duplicates.
9. **Authorised verification terminal ("the ATM front door")** — NCIHAP §16:
   an authenticated worker looks a child up by **typed CHIN or scanned QR**
   (`POST /api/terminal/lookup`) and gets back the §16 headline —
   `CURRENT` or `ATTENTION REQUIRED` — plus **only what their role is
   authorised to see** (§24 least-privilege). A `verifier` sees status and
   identity only; a `staff` health worker sees the record needed to continue
   care (schedule, DOB, caregiver contact). A scanned QR must carry a valid
   signed token or it's rejected as a possible forgery; a typed CHIN is
   check-digit-validated before it hits the database. **Every access is
   written to an append-only audit trail** (§17/§24) — who looked at which
   record, when, and how — reviewable by an admin at
   `GET /api/children/:chin/access-log`. Roles are `verifier` < `staff` <
   `admin`.
10. **National Command Dashboard** — NCIHAP §11, "the intelligence created
    behind the card." Aggregated, **privacy-protected** (counts and rates
    only — never individual child data), **admin-only**, and drillable
    **Nigeria → State → LGA → Ward → PHC**:
    - `GET /api/dashboard/summary?state=&lga=&ward=` — registered, doses
      administered, due-this-week, overdue, zero-dose, completion rate,
      dropout rate, and vaccine utilisation for the scope, plus a breakdown
      one geographic level down.
    - `GET /api/dashboard/stock-forecast?weeks=` — upcoming demand per vaccine
      (§11 stock pressure / §18: "N children will need Vaccine X in N weeks").
    - `GET /api/dashboard/trend?weeks=` — doses administered per week (§11
      performance trends).
    - `GET /api/dashboard/outliers` — facilities with a statistically unusual
      dropout rate (§11), flagged as mean + 1 s.d. among facilities with
      enough children.
11. **Offline-first sync** — NCIHAP §9, designed for Nigeria's actual
    connectivity. A health-worker device works offline and syncs when the
    network returns:
    - `GET /api/sync/pull?facilityId=&since=` — seed/refresh the device's
      local store with the facility's children (doses, status, caregiver
      contact) plus a `serverTime` cursor; pass it back as `since` for an
      incremental pull of only what changed.
    - `POST /api/sync/push` — upload a batch of transactions recorded offline
      (`record_dose`, `register_child` for home births). Each carries a
      device-generated `clientTxId` so a flaky network's **retries are
      idempotent** — a replay is recognised and never double-applied. A
      **conflict** (two sources recording the same dose differently) keeps the
      earlier vaccination and flags the record **GREY** for reconciliation
      (§10). One bad transaction in a batch doesn't block the good ones.
12. **Web frontend** (`web/`) — a React + Vite + TypeScript staff/admin app:
    login, a role-aware shell, the **National Command Dashboard** with live
    geographic drill-down (Nigeria → State → LGA → Ward → PHC), doses-trend
    and stock-pressure charts, child lookup/registration/dose-recording with
    an inline card preview, the verification terminal, and the follow-up
    queue. Its own design system (deep clinical green, Lora + IBM Plex,
    full light/dark). Run it with `npm --prefix web run dev` (dev-proxies
    `/api` to the backend on :4100).

## Explicit known gaps (do not treat as production-ready)

- **No real SMS gateway yet.** The reminder engine is fully wired but ships
  with a console `stub` provider — it logs what it would send. A real
  gateway plugs into `src/providers/sms` behind the existing seam.
- **The offline-first _client_** (a local store on the device that queues
  transactions) isn't built — the web app is online. The server-side sync
  protocol it would consume is built and tested; a field device app / PWA is
  the next layer.
- **Schedule data needs clinical sign-off.** `src/data/routine-immunization-schedule.ts`
  reflects a commonly published national routine immunization schedule, but
  this is a software prototype, not a clinical source — verify against current
  guidance before any real child's care depends on it.

## Running it locally

```bash
npm install
cp .env.example .env
npm run dev
```

No MongoDB install required — `ALLOW_IN_MEMORY_DB=true` (the default in
`.env.example`) starts an ephemeral in-memory MongoDB. Data does not persist
across restarts; point `MONGODB_URI` at a real database once that matters
(a staff account created against one in-memory instance won't exist in a
different process's instance — point both at the same `MONGODB_URI` if you
need to log in against a separately-running dev server).

Create a staff login, then log in to get a bearer token:

```bash
npx tsx src/scripts/createStaffUser.ts nurse.amina "a real password" "Amina Bello" staff

curl -X POST http://localhost:4100/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"nurse.amina","password":"a real password"}'
# -> { "token": "...", "user": { ... } }
# Use it as: -H "Authorization: Bearer <token>"
```

Run the real end-to-end test suite (boots the app, hits it over actual HTTP):

```bash
npm test
```

## Layout

```
src/
  config/       env parsing + startup guards, DB connection
  data/         routine immunization schedule reference data
  models/       Mongoose schemas: Child, Caregiver, Facility, Certificate, FacilityHandoff, StaffUser, ReminderLog, Escalation, AccessLog, SyncTransaction
  services/     chin, schedule/status, card+QR, verification token, certificate, handoff, reminder engine + content, escalations, terminal, dashboard, sync
  providers/    sms/ — pluggable SMS provider seam (stub for now)
  controllers/  request handlers (incl. auth, reminders, escalations, terminal, dashboard, sync)
  middleware/   requireAuth, error handling
  jobs/         reminder.job.ts — the background scan-and-dispatch scheduler
  routes/       route wiring — public routes registered before the auth layer
  scripts/      createStaffUser.ts (CLI-only account creation)
tests/
  run-tests.ts  end-to-end smoke suite over real HTTP, plus reminder-engine unit tests (cooldown, cap, quiet hours, escalation)
```
