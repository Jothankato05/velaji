# NCIHAP prototype

A working software prototype for the parts of the "National Child Immunisation
& Health Assurance Programme" concept that are actually buildable as software
by one team, right now — separate from ImmuniReach, though the two could
integrate later (e.g. ImmuniReach's reminder/voice-call engine could dial
caregivers using data from this system).

## What this is NOT

The source concept is a national policy proposal: 36-month rollout across all
774 LGAs, real NIMC/NPC identity interoperability, and a live NHIA financial
settlement integration. None of that is something a codebase can produce —
it requires government authority, inter-agency agreements, and money this
repo has no access to. This prototype does not pretend to have solved that
layer. Where it would need to plug in, it stops at an explicit, visible seam
(see `nhiaIntegrationStatus: 'not_connected'` on every certificate) instead
of faking a connection — the same pattern ImmuniReach uses for its stubbed
EMR/DHIS2 provider.

**CHIN is explicitly not Nigeria's NIN.** It's a system-generated ID scoped
to this software only, for tracking a child across visits and facilities
when they have no birth certificate or NIN yet. See `src/services/chin.service.ts`.

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
   full routine immunization schedule from date of birth and computes a
   five-color status (`GREEN`/`AMBER`/`RED`/`GREY`/`BLUE`) matching the
   at-a-glance model from the programme notes. `GREY` means severely
   overdue — needs active tracing, not just another reminder.
4. **Geolocation-based facility handoff** — when a family moves or shows up
   at a different facility, `POST /api/children/:chin/handoff` logs the
   transfer with coordinates, and `GET /api/facilities/nearest` finds the
   closest known facility to a reported location (haversine distance).
5. **Completion certificate as a flag** — once every scheduled dose is
   recorded, a certificate record is issued automatically. It is a
   completion flag with a verification code, nothing more.

## Explicit known gaps (do not treat as production-ready)

- **No auth yet.** All `/api/*` endpoints except `/api/verify/:chin` are
  currently open. The verify endpoint is deliberately public/token-gated;
  the rest need facility-staff auth before this touches real data — see
  ImmuniReach's `requireAuth`/token pattern for a reusable approach.
- **No offline-first sync.** Endpoints assume a live connection. A
  low-connectivity rollout needs a local-first store + sync protocol; not
  built yet.
- **Schedule data needs clinical sign-off.** `src/data/routine-immunization-schedule.ts`
  reflects the commonly published NPHCDA routine schedule, but this is a
  software prototype, not a clinical source — verify against current
  guidance before any real child's care depends on it.

## Running it locally

```bash
npm install
cp .env.example .env
npm run dev
```

No MongoDB install required — `ALLOW_IN_MEMORY_DB=true` (the default in
`.env.example`) starts an ephemeral in-memory MongoDB. Data does not persist
across restarts; point `MONGODB_URI` at a real database once that matters.

Run the real end-to-end test suite (boots the app, hits it over actual HTTP):

```bash
npm test
```

## Layout

```
src/
  config/       env parsing + startup guards, DB connection
  data/         routine immunization schedule reference data
  models/       Mongoose schemas: Child, Caregiver, Facility, Certificate, FacilityHandoff
  services/     chin, schedule/status, card+QR, verification token, certificate, handoff
  controllers/  request handlers
  routes/       route wiring
tests/
  run-tests.ts  end-to-end smoke suite over real HTTP
```
