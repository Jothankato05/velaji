# Velaji

A coined name, chosen deliberately over a real local-language compound:
every short, meaningful Yoruba/Igbo/Hausa word tried for this (toju, dagba,
kwado, aabo...) turned out to already belong to a real company somewhere —
this space is heavily mined. Velaji is short, easy to say, and — as far as
search engines, npm, and GitHub can confirm — genuinely not in use anywhere
yet.

A working software prototype for the parts of the "National Child Immunisation
& Health Assurance Programme" (NCIHAP) concept that are actually buildable as
software by one team, right now — separate from ImmuniReach, though the two
could integrate later (e.g. ImmuniReach's reminder/voice-call engine could
dial caregivers using data from this system).

The name was chosen after checking it against search engines, npm, and
GitHub — as a single word it returns no existing product, company, notable
person, or package with this name. That's not a substitute for a real
trademark/CAC search before any formal launch, but it's clean as far as
open research can confirm.

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
6. **Staff authentication** — every `/api/*` endpoint except
   `POST /api/auth/login` and the public `GET /api/verify/:chin` requires a
   bearer token (`Authorization: Bearer <token>`) from `/api/auth/login`.
   Passwords are scrypt-hashed, tokens are self-signed HMAC (12h TTL), no
   new dependency — same approach as ImmuniReach's `requireAuth`. There is
   no open registration endpoint on purpose: accounts are created with
   `npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [staff|admin]`,
   deliberately, by someone with server access — not self-served.

## Explicit known gaps (do not treat as production-ready)

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
  models/       Mongoose schemas: Child, Caregiver, Facility, Certificate, FacilityHandoff, StaffUser
  services/     chin, schedule/status, card+QR, verification token, certificate, handoff
  controllers/  request handlers (incl. auth)
  middleware/   requireAuth, error handling
  routes/       route wiring — public routes registered before the auth layer
  scripts/      createStaffUser.ts (CLI-only account creation)
tests/
  run-tests.ts  end-to-end smoke suite over real HTTP, incl. auth success/failure paths
```
