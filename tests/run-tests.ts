/* eslint-disable no-console */
// Real end-to-end smoke test: boots the actual app on an ephemeral in-memory
// DB and hits it over real HTTP with fetch — verify against reality, not mocks.

import './testEnv';
import { app } from '../src/app';
import { connectDatabase, disconnectDatabase } from '../src/config/db';
import { isValidChinFormat, generateChin } from '../src/services/chin.service';
import { StaffUserModel } from '../src/models/StaffUser';
import { hashPassword } from '../src/utils/password';
import { ChildModel } from '../src/models/Child';
import { CaregiverModel } from '../src/models/Caregiver';
import { FacilityModel } from '../src/models/Facility';
import { ReminderLogModel } from '../src/models/ReminderLog';
import { EscalationModel } from '../src/models/Escalation';
import { CertificateModel } from '../src/models/Certificate';
import { ReminderService } from '../src/services/reminder.service';
import { issueToken } from '../src/utils/token';
import { buildVerificationUrl } from '../src/services/card.service';
import { signChin } from '../src/services/verification-token.service';
import { computeMilestones, nextMilestone } from '../src/services/milestone.service';
import { DoseAdministrationModel } from '../src/models/DoseAdministration';
import { VELOCITY_MAX_IN_WINDOW } from '../src/services/fraud.service';
import type { SmsMessage, SmsProvider, SmsSendResult } from '../src/providers/sms';

type TestFn = () => Promise<void>;
const suites: [string, TestFn][] = [];
function test(name: string, fn: TestFn) {
  suites.push([name, fn]);
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

let baseUrl = '';
let authToken = '';

async function json(method: string, path: string, body?: unknown, opts?: { auth?: boolean }) {
  const useAuth = opts?.auth !== false; // default: send the staff bearer token
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (useAuth && authToken) headers.Authorization = `Bearer ${authToken}`;

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

let facilityAId = '';
let facilityBId = '';
let caregiverId = '';
let chin = '';

test('health check responds', async () => {
  const { status, body } = await json('GET', '/health');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.ok === true, 'expected ok:true');
});

test('readiness reports the database is connected', async () => {
  const { status, body } = await json('GET', '/ready');
  assert(status === 200, `expected 200 when the DB is up, got ${status}`);
  assert(body.ready === true && body.db === 'connected', `expected ready:true, got ${JSON.stringify(body)}`);
});

test('a staff endpoint rejects a request with no token', async () => {
  const { status } = await json('POST', '/api/facilities', { name: 'x', lgaName: 'x', stateName: 'x', lat: 0, lng: 0 }, { auth: false });
  assert(status === 401, `expected 401 with no token, got ${status}`);
});

test('a staff endpoint rejects a garbage token', async () => {
  const saved = authToken;
  authToken = 'not.a.realtoken';
  const { status } = await json('GET', '/api/facilities');
  authToken = saved;
  assert(status === 401, `expected 401 with a garbage token, got ${status}`);
});

test('login rejects a wrong password, then succeeds and yields a working token', async () => {
  // Seed the account the way ops would — the CLI script, not an open
  // registration endpoint (see src/scripts/createStaffUser.ts).
  await StaffUserModel.create({
    username: 'nurse.amina',
    passwordHash: await hashPassword('correct horse battery staple'),
    fullName: 'Amina Bello',
    role: 'staff'
  });

  const bad = await json('POST', '/api/auth/login', { username: 'nurse.amina', password: 'wrong password' }, { auth: false });
  assert(bad.status === 401, `expected 401 for wrong password, got ${bad.status}`);

  const good = await json(
    'POST',
    '/api/auth/login',
    { username: 'nurse.amina', password: 'correct horse battery staple' },
    { auth: false }
  );
  assert(good.status === 200, `expected 200 for correct login, got ${good.status}: ${JSON.stringify(good.body)}`);
  assert(typeof good.body.token === 'string' && good.body.token.length > 0, 'expected a token in the login response');
  authToken = good.body.token;

  const me = await json('GET', '/api/auth/me');
  assert(me.status === 200, `expected /api/auth/me to accept the fresh token, got ${me.status}`);
  assert(me.body.user.username === 'nurse.amina', 'token did not resolve back to the right user');
});

test('CHIN follows the NCIHAP format (NG-YY-MM-serial) with a working check digit', async () => {
  const c = generateChin();
  assert(/^NG-\d{2}-\d{2}-\d{8}$/.test(c), `CHIN should be NG-YY-MM-<8 digits>, got ${c}`);
  assert(isValidChinFormat(c), `freshly generated CHIN ${c} should validate`);
  // Flipping the check digit must fail.
  const last = c.slice(-1);
  const tampered = c.slice(0, -1) + (last === '0' ? '1' : '0');
  assert(!isValidChinFormat(tampered), 'a flipped check digit must be rejected');
});

test('create two facilities', async () => {
  const a = await json('POST', '/api/facilities', {
    name: 'Wuse PHC',
    lgaName: 'AMAC',
    stateName: 'FCT',
    lat: 9.0765,
    lng: 7.3986
  });
  assert(a.status === 201, `expected 201, got ${a.status}: ${JSON.stringify(a.body)}`);
  facilityAId = a.body._id;

  const b = await json('POST', '/api/facilities', {
    name: 'Garki PHC',
    lgaName: 'AMAC',
    stateName: 'FCT',
    lat: 9.0325,
    lng: 7.4897
  });
  assert(b.status === 201, `expected 201, got ${b.status}`);
  facilityBId = b.body._id;
});

test('nearest-facility lookup returns the closer one', async () => {
  const { status, body } = await json('GET', '/api/facilities/nearest?lat=9.077&lng=7.399');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.facility._id === facilityAId, 'expected Wuse PHC to be nearest');
});

test('create a caregiver', async () => {
  const { status, body } = await json('POST', '/api/caregivers', {
    fullName: 'Amina Yusuf',
    phone: '+2348010000000'
  });
  assert(status === 201, `expected 201, got ${status}`);
  caregiverId = body._id;
});

test('register a child issues a valid CHIN and a full dose schedule', async () => {
  const { status, body } = await json('POST', '/api/children', {
    fullName: 'Baby Yusuf',
    sex: 'female',
    dateOfBirth: '2026-06-01',
    caregiverId,
    homeFacilityId: facilityAId
  });
  assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(isValidChinFormat(body.chin), `CHIN ${body.chin} failed its own check digit`);
  assert(body.doses.length > 10, 'expected a full schedule of doses');
  assert(body.status === 'RED' || body.status === 'AMBER' || body.status === 'GREEN', `unexpected status ${body.status}`);
  chin = body.chin;
});

test('registration checks the details before creating anything', async () => {
  const carersBefore = await CaregiverModel.countDocuments();
  const base = { sex: 'male', homeFacilityId: facilityAId };
  const dayAgo = new Date(Date.now() - 20 * DAY).toISOString().slice(0, 10);

  // A caregiver given inline is created with the child.
  const ok = await json('POST', '/api/children', {
    ...base, fullName: 'Inline  Carer Child', dateOfBirth: dayAgo, caregiver: { fullName: 'Hauwa Musa', phone: '+234 803 555 0101' }
  });
  assert(ok.status === 201, `inline caregiver registration expected 201, got ${ok.status}: ${JSON.stringify(ok.body)}`);
  assert((await CaregiverModel.countDocuments()) === carersBefore + 1, 'the inline caregiver should be created once');
  assert(ok.body.fullName === 'Inline Carer Child', `extra spaces in the name should be tidied, got ${JSON.stringify(ok.body.fullName)}`);

  // Rejected registrations leave no caregiver behind.
  const noPhone = await json('POST', '/api/children', { ...base, fullName: 'No Phone', dateOfBirth: dayAgo, caregiver: { fullName: 'Nobody', phone: '' } });
  assert(noPhone.status === 400 && /phone/i.test(noPhone.body.error), `missing phone expected 400 about the phone, got ${noPhone.status}: ${noPhone.body.error}`);
  const future = await json('POST', '/api/children', {
    ...base, fullName: 'Not Born Yet', dateOfBirth: new Date(Date.now() + 10 * DAY).toISOString().slice(0, 10), caregiver: { fullName: 'Early', phone: '+2348035550102' }
  });
  assert(future.status === 400 && /future/i.test(future.body.error), `future DOB expected 400, got ${future.status}: ${future.body.error}`);
  const tooOld = await json('POST', '/api/children', {
    ...base, fullName: 'Too Old', dateOfBirth: '2015-01-01', caregiver: { fullName: 'Late', phone: '+2348035550103' }
  });
  assert(tooOld.status === 400 && /under 5/.test(tooOld.body.error), `DOB over 5 years ago expected 400, got ${tooOld.status}: ${tooOld.body.error}`);

  // The same child again (name in another case and spacing, phone in local
  // format) is refused with the existing CHIN.
  const dup = await json('POST', '/api/children', {
    ...base, fullName: 'inline carer child', dateOfBirth: dayAgo, caregiver: { fullName: 'Hauwa Musa', phone: '08035550101' }
  });
  assert(dup.status === 409 && dup.body.existingChin === ok.body.chin, `duplicate expected 409 with ${ok.body.chin}, got ${dup.status}: ${JSON.stringify(dup.body)}`);
  assert((await CaregiverModel.countDocuments()) === carersBefore + 1, 'rejected registrations must not create caregivers');

  // A twin (same caregiver and birthday, different name) is not a duplicate.
  const twin = await json('POST', '/api/children', {
    ...base, fullName: 'Inline Carer Twin', dateOfBirth: dayAgo, caregiver: { fullName: 'Hauwa Musa', phone: '08035550101' }
  });
  assert(twin.status === 201, `a twin should register, got ${twin.status}: ${JSON.stringify(twin.body)}`);
});

test('a tampered CHIN fails format validation', async () => {
  const tampered = chin.slice(0, -1) + (chin.slice(-1) === '0' ? '1' : '0');
  assert(!isValidChinFormat(tampered), 'tampered CHIN should fail check digit');
});

test('verify endpoint rejects a missing/forged token', async () => {
  const { status } = await json('GET', `/api/verify/${encodeURIComponent(chin)}?t=notarealtoken`);
  assert(status === 401, `expected 401, got ${status}`);
});

test('printable card carries child info AND parent info (per the BSMODEL note)', async () => {
  const res = await fetch(`${baseUrl}/api/children/${encodeURIComponent(chin)}/card.svg`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const svg = await res.text();
  assert(svg.includes('<svg'), 'response is not SVG');
  assert(svg.includes(chin), 'card does not contain the CHIN');
  assert(svg.includes('Baby Yusuf'), 'card must show the child name');
  // The note: "the card will contain the child info and parents info".
  assert(/Parent \/ Guardian/.test(svg), 'card must have a Parent/Guardian section');
  assert(svg.includes('Amina Yusuf'), 'card must show the parent/guardian name');
  assert(svg.includes('+2348010000000'), 'card must show the parent contact');
});

test('recording every dose issues a completion certificate', async () => {
  const { body: child } = await json('GET', `/api/children/${encodeURIComponent(chin)}`);
  for (const dose of child.doses) {
    const { status } = await json('POST', `/api/children/${encodeURIComponent(chin)}/doses`, {
      vaccineCode: dose.vaccineCode,
      doseNumber: dose.doseNumber,
      facilityId: facilityAId
    });
    assert(status === 200, `expected 200 recording ${dose.vaccineCode}#${dose.doseNumber}, got ${status}`);
  }

  const { body: after } = await json('GET', `/api/children/${encodeURIComponent(chin)}`);
  assert(after.status === 'BLUE', `expected BLUE after full schedule, got ${after.status}`);
  assert(after.completedAt, 'expected completedAt to be set');

  const cert = await json('GET', `/api/children/${encodeURIComponent(chin)}/certificate`);
  assert(cert.status === 200, `expected certificate to exist, got ${cert.status}`);
  assert(cert.body.nhiaIntegrationStatus === 'not_connected', 'certificate must not silently claim a real NHIA link');
  // Completion UNLOCKS the NHIA "Healthy Start" coverage window (§12).
  assert(cert.body.coverageProgramme === 'Healthy Start', 'expected Healthy Start coverage on completion');
  assert(cert.body.coverageMonths === 12, 'expected 12 months coverage');
  assert(new Date(cert.body.coverageExpiresAt) > new Date(cert.body.coverageStartsAt), 'coverage window must be forward');
});

test('the journey endpoint tells the whole story: next dose then coverage', async () => {
  // The child from the test above is complete → no next dose, coverage active.
  const done = await json('GET', `/api/children/${encodeURIComponent(chin)}/journey`);
  assert(done.status === 200, `expected 200, got ${done.status}`);
  assert(done.body.nextDue === null, 'a completed child has no next dose');
  assert(done.body.progress.remaining === 0 && done.body.progress.administered === done.body.progress.total, 'progress should be full');
  assert(done.body.coverage && done.body.coverage.active === true, 'coverage should be unlocked and active');
  assert(done.body.coverage.programme === 'Healthy Start', 'coverage programme name');

  // A fresh, incomplete child: the journey names the single next vaccine.
  const cg = await json('POST', '/api/caregivers', { fullName: 'Journey Carer', phone: '+2348012340000' });
  const reg = await json('POST', '/api/children', {
    fullName: 'Journey Child', sex: 'male', dateOfBirth: new Date(NOON.getTime() - 20 * DAY).toISOString().slice(0, 10),
    caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  const j = await json('GET', `/api/children/${encodeURIComponent(reg.body.chin)}/journey`);
  assert(j.body.nextDue && typeof j.body.nextDue.vaccine === 'string', 'journey must name the next vaccine');
  assert(j.body.coverage === null, 'no coverage until the schedule is complete');
  assert(j.body.progress.total > 0, 'journey must know the full schedule size');

  // Don't let this incomplete child leak into the later reminder-engine scans.
  await ChildModel.updateOne({ chin: reg.body.chin }, { completedAt: NOON });
});

test('a facility handoff moves the child and is logged with geolocation', async () => {
  const { status, body } = await json('POST', `/api/children/${encodeURIComponent(chin)}/handoff`, {
    toFacilityId: facilityBId,
    lat: 9.03,
    lng: 7.49,
    reason: 'Family relocated'
  });
  assert(status === 201, `expected 201, got ${status}: ${JSON.stringify(body)}`);
  assert(body.toFacilityId === facilityBId, 'handoff did not record the target facility');

  const { body: child } = await json('GET', `/api/children/${encodeURIComponent(chin)}`);
  assert(child.currentFacilityId === facilityBId, 'child currentFacilityId was not updated after handoff');
});

// --- Reminder engine tests (drive the service directly with a fake provider
// and a controlled clock, so cooldown/cap/quiet-hours are deterministic) ---

const DAY = 24 * 60 * 60 * 1000;
const NOON = new Date('2026-08-21T12:00:00'); // inside the 08–20 send window

class FakeSms implements SmsProvider {
  readonly name = 'fake';
  readonly sent: SmsMessage[] = [];
  async send(message: SmsMessage): Promise<SmsSendResult> {
    this.sent.push(message);
    return { ok: true, providerMessageId: `fake_${this.sent.length}` };
  }
}

// Create an isolated facility + caregiver + child with a single dose due
// `dueDaysAgo` days before NOON. Returns the child's id and CHIN.
async function makeReminderChild(dueDaysAgo: number, opts: { phone?: string | null } = {}) {
  const facility = await FacilityModel.create({
    name: 'Reminder Test PHC',
    lgaName: 'AMAC',
    stateName: 'FCT',
    location: { lat: 9.05, lng: 7.4 }
  });
  const caregiver = await CaregiverModel.create({
    fullName: 'Test Caregiver',
    phone: opts.phone === undefined ? '+2348030000000' : (opts.phone ?? '')
  });
  const chin = generateChin();
  const child = await ChildModel.create({
    chin,
    fullName: 'Test Child',
    sex: 'male',
    dateOfBirth: new Date(NOON.getTime() - 400 * DAY),
    caregiverId: caregiver._id,
    homeFacilityId: facility._id,
    currentFacilityId: facility._id,
    doses: [
      {
        vaccineCode: 'PENTA',
        displayName: 'Pentavalent (DPT-HepB-Hib)',
        doseNumber: 1,
        dueDate: new Date(NOON.getTime() - dueDaysAgo * DAY),
        administeredDate: null
      }
    ]
  });
  return { childId: child._id, chin };
}

// Remove a test child from later scans without deleting the audit trail.
async function retireChild(childId: unknown) {
  await ChildModel.updateOne({ _id: childId }, { completedAt: NOON });
}

test('reminder engine texts an overdue caregiver and logs it', async () => {
  const { childId, chin } = await makeReminderChild(10); // 10 days overdue -> RED
  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake,
    now: () => NOON,
    cooldownHours: 48,
    maxPerDose: 3,
    sendStartHour: 8,
    sendEndHour: 20
  });

  const summary = await svc.runCycle();
  assert(summary.sent >= 1, `expected at least one send, got ${summary.sent}`);
  assert(fake.sent.length >= 1, 'fake provider received no message');
  assert(fake.sent[0].to === '+2348030000000', 'sent to the wrong number');
  assert(/overdue/i.test(fake.sent[0].body), 'RED reminder should say overdue');

  const logs = await ReminderLogModel.find({ childId });
  assert(logs.length === 1, `expected 1 reminder log, got ${logs.length}`);
  assert(logs[0].chin === chin && logs[0].status === 'sent', 'log row is wrong');

  await retireChild(childId);
});

test('reminder engine sends ONE consolidated text for a child with several overdue doses', async () => {
  // Build a child with 3 distinct overdue doses (not the single-dose helper).
  const facility = await FacilityModel.create({
    name: 'Multi PHC', lgaName: 'AMAC', stateName: 'FCT', location: { lat: 9, lng: 7 }
  });
  const caregiver = await CaregiverModel.create({ fullName: 'Multi Carer', phone: '+2348055554444' });
  const chin = generateChin();
  const child = await ChildModel.create({
    chin, fullName: 'Multi Child', sex: 'female',
    dateOfBirth: new Date(NOON.getTime() - 400 * DAY),
    caregiverId: caregiver._id, homeFacilityId: facility._id, currentFacilityId: facility._id,
    doses: [
      { vaccineCode: 'PENTA', displayName: 'Pentavalent', doseNumber: 1, dueDate: new Date(NOON.getTime() - 30 * DAY), administeredDate: null },
      { vaccineCode: 'OPV', displayName: 'Oral Polio Vaccine', doseNumber: 1, dueDate: new Date(NOON.getTime() - 20 * DAY), administeredDate: null },
      { vaccineCode: 'PCV', displayName: 'Pneumococcal', doseNumber: 1, dueDate: new Date(NOON.getTime() - 10 * DAY), administeredDate: null }
    ]
  });

  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake, now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });

  const summary = await svc.runCycle();
  assert(fake.sent.length === 1, `expected exactly ONE text for the child, got ${fake.sent.length}`);
  assert(summary.remindableChildren >= 1, 'expected child counted as remindable');
  // Lead vaccine is the most overdue (Pentavalent, 30 days), and it should
  // mention the 2 others are also due.
  assert(/Pentavalent/.test(fake.sent[0].body), 'lead vaccine should be the most overdue one');
  assert(/2 other vaccines are also due/.test(fake.sent[0].body), `expected the "2 others" note, got: ${fake.sent[0].body}`);

  const logs = await ReminderLogModel.find({ childId: child._id });
  assert(logs.length === 1, `expected 1 log row, got ${logs.length}`);

  await retireChild(child._id);
});

test('reminder engine respects the cooldown window', async () => {
  const { childId } = await makeReminderChild(10);
  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake,
    now: () => NOON,
    cooldownHours: 48,
    maxPerDose: 3,
    sendStartHour: 8,
    sendEndHour: 20
  });

  await svc.runCycle(); // first send
  const after1 = fake.sent.length;
  const second = await svc.runCycle(); // same clock -> within cooldown
  assert(fake.sent.length === after1, 'cooldown did not suppress the second send');
  assert(second.skippedCooldown >= 1, 'expected a cooldown skip to be reported');

  await retireChild(childId);
});

test('reminder engine sends again once the cooldown has elapsed', async () => {
  const { childId } = await makeReminderChild(10);
  const fake = new FakeSms();
  let clock = NOON;
  const svc = new ReminderService({
    smsProvider: fake,
    now: () => clock,
    cooldownHours: 48,
    maxPerDose: 3,
    sendStartHour: 8,
    sendEndHour: 20
  });

  await svc.runCycle(); // send #1 at NOON
  clock = new Date(NOON.getTime() + 3 * DAY); // past the 48h cooldown, still RED (13d)
  await svc.runCycle(); // send #2
  assert(fake.sent.length === 2, `expected 2 sends across the gap, got ${fake.sent.length}`);

  await retireChild(childId);
});

test('reminder engine escalates instead of texting forever past the attempt cap', async () => {
  const { childId, chin } = await makeReminderChild(10);
  const fake = new FakeSms();
  let clock = NOON;
  const svc = new ReminderService({
    smsProvider: fake,
    now: () => clock,
    cooldownHours: 24,
    maxPerDose: 1, // one reminder, then it's a human's problem
    sendStartHour: 8,
    sendEndHour: 20
  });

  await svc.runCycle(); // the single allowed send
  assert(fake.sent.length === 1, 'expected exactly one send at cap=1');

  clock = new Date(NOON.getTime() + 2 * DAY); // past cooldown, but cap is reached
  const escalated = await svc.runCycle();
  assert(fake.sent.length === 1, 'should not send beyond the attempt cap');
  assert(escalated.skippedMaxAttempts >= 1, 'expected a max-attempts skip');
  assert(
    escalated.escalations.some((e) => e.startsWith(chin)),
    'capped dose should be flagged for human escalation'
  );

  await retireChild(childId);
});

test('a severely overdue child stays RED (not GREY) and is still reminded', async () => {
  // NCIHAP §10: overdue is RED however long it stays overdue — it does NOT age
  // into GREY. With a reachable caregiver, it must still get a reminder.
  const { childId, chin } = await makeReminderChild(200); // 200 days overdue
  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake, now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });

  await svc.runCycle();
  assert(fake.sent.length === 1, `severely-overdue reachable child should be texted, sent=${fake.sent.length}`);

  const view = await json('GET', `/api/children/${encodeURIComponent(chin)}`);
  assert(view.body.status === 'RED', `expected RED for a very overdue child, got ${view.body.status}`);

  await retireChild(childId);
});

test('an overdue child with no phone cannot be reminded, so it escalates', async () => {
  const { childId, chin } = await makeReminderChild(200, { phone: null }); // overdue + unreachable
  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake, now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });

  const summary = await svc.runCycle();
  assert(fake.sent.length === 0, 'a child with no phone cannot be texted');
  assert(summary.skippedNoPhone >= 1, 'expected the no-phone skip to be counted');
  assert(
    summary.escalations.some((e) => e.startsWith(chin)),
    'overdue + unreachable child should be flagged for human tracing'
  );

  await retireChild(childId);
});

test('a record flagged for reconciliation reports GREY', async () => {
  // NCIHAP §10: GREY = unverified/incomplete record needing reconciliation.
  const { childId, chin } = await makeReminderChild(10);
  await ChildModel.updateOne({ _id: childId }, { needsReconciliation: true });
  const view = await json('GET', `/api/children/${encodeURIComponent(chin)}`);
  assert(view.body.status === 'GREY', `expected GREY for a reconciliation-flagged record, got ${view.body.status}`);
  await retireChild(childId);
});

test('reminder engine stays silent outside the send window', async () => {
  const { childId } = await makeReminderChild(10);
  const fake = new FakeSms();
  const svc = new ReminderService({
    smsProvider: fake,
    now: () => new Date('2026-08-21T03:00:00'), // 3am, outside 08–20
    cooldownHours: 48,
    maxPerDose: 3,
    sendStartHour: 8,
    sendEndHour: 20
  });

  const summary = await svc.runCycle();
  assert(summary.quietHoursSkipped === true, 'expected quietHoursSkipped');
  assert(fake.sent.length === 0, 'nothing should be sent at 3am');

  await retireChild(childId);
});

// --- Escalation queue: the reminder engine hands stuck cases to humans ---

let escChin = '';
let escId = '';

test('an unreachable overdue child is raised as an escalation and appears in the work queue', async () => {
  const { childId, chin } = await makeReminderChild(200, { phone: null }); // overdue + unreachable
  escChin = chin;
  const svc = new ReminderService({
    smsProvider: new FakeSms(), now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });
  await svc.runCycle();

  const { status, body } = await json('GET', '/api/escalations');
  assert(status === 200, `expected 200, got ${status}`);
  const mine = body.escalations.find((e: any) => e.chin === chin);
  assert(mine, 'my unreachable child should be in the open escalation queue');
  assert(mine.reason === 'lost_to_followup', `expected lost_to_followup, got ${mine.reason}`);
  assert(typeof mine.reasonLabel === 'string' && mine.reasonLabel.length > 0, 'expected a human reason label');
  assert(typeof mine.daysOverdue === 'number' && mine.daysOverdue > 90, `expected >90 days overdue, got ${mine.daysOverdue}`);
  escId = mine.id;

  // leave the child in place for the resolve test below; don't retire yet
  void childId;
});

test('running the cycle again does not duplicate the open escalation', async () => {
  const child = await ChildModel.findOne({ chin: escChin });
  const svc = new ReminderService({
    smsProvider: new FakeSms(), now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });
  await svc.runCycle();
  const open = await EscalationModel.countDocuments({ childId: child!._id, status: 'open' });
  assert(open === 1, `expected exactly 1 open escalation after re-run, got ${open}`);
});

test('staff can resolve an escalation, and it leaves the open queue', async () => {
  const { status, body } = await json('POST', `/api/escalations/${escId}/resolve`, {
    outcome: 'reached',
    note: 'Visited the family; rescheduled the visit.'
  });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.status === 'resolved', 'escalation should be resolved');
  assert(body.resolvedBy === 'nurse.amina', `expected resolvedBy nurse.amina, got ${body.resolvedBy}`);
  assert(body.outcome === 'reached', 'outcome not recorded');

  const openList = await json('GET', '/api/escalations');
  const days = openList.body.escalations.map((e: any) => e.daysOverdue ?? -1);
  assert(days.every((d: number, i: number) => i === 0 || days[i - 1] >= d), `open queue should be longest-overdue first, got ${JSON.stringify(days)}`);
  assert(!openList.body.escalations.some((e: any) => e.id === escId), 'resolved item still in open queue');

  const resolvedList = await json('GET', '/api/escalations?status=resolved');
  assert(resolvedList.body.escalations.some((e: any) => e.id === escId), 'resolved item missing from resolved list');

  const child = await ChildModel.findOne({ chin: escChin });
  await retireChild(child!._id);
});

test('resolving an already-resolved escalation is rejected', async () => {
  const { status } = await json('POST', `/api/escalations/${escId}/resolve`, { outcome: 'other' });
  assert(status === 409, `expected 409 on double-resolve, got ${status}`);
});

test('recording the dose auto-resolves its escalation', async () => {
  const { childId, chin } = await makeReminderChild(200, { phone: null }); // overdue + unreachable
  const svc = new ReminderService({
    smsProvider: new FakeSms(), now: () => NOON, cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });
  await svc.runCycle();
  let open = await EscalationModel.countDocuments({ childId, status: 'open' });
  assert(open === 1, `expected 1 open escalation before recording, got ${open}`);

  // Claiming 'immunized' by hand while the dose is still missing is refused,
  // and the case stays open.
  const esc = await EscalationModel.findOne({ childId, status: 'open' });
  const claim = await json('POST', `/api/escalations/${esc?._id}/resolve`, { outcome: 'immunized' });
  assert(claim.status === 409, `manual 'immunized' without the dose expected 409, got ${claim.status}`);
  open = await EscalationModel.countDocuments({ childId, status: 'open' });
  assert(open === 1, `the case should still be open after a refused claim, got open=${open}`);

  // Record the dose over real HTTP — this should auto-close the escalation.
  const rec = await json('POST', `/api/children/${encodeURIComponent(chin)}/doses`, {
    vaccineCode: 'PENTA', doseNumber: 1, facilityId: facilityAId
  });
  assert(rec.status === 200, `expected 200 recording dose, got ${rec.status}`);

  open = await EscalationModel.countDocuments({ childId, status: 'open' });
  assert(open === 0, `escalation should be auto-resolved after the dose, still open=${open}`);
  const resolved = await EscalationModel.findOne({ childId, status: 'resolved' });
  assert(resolved?.outcome === 'immunized' && resolved?.resolvedBy === 'system', 'auto-resolution not recorded correctly');
});

// --- Escalation queue: extra edge cases (auth + input validation) beyond the
// core flows tested above. An overdue + unreachable child raises an escalation
// on the first cycle. ---

function reminderSvc(now: Date = NOON) {
  return new ReminderService({
    smsProvider: new FakeSms(), now: () => now,
    cooldownHours: 48, maxPerDose: 3, sendStartHour: 8, sendEndHour: 20
  });
}

test('escalation queue requires a staff token', async () => {
  const { status } = await json('GET', '/api/escalations', undefined, { auth: false });
  assert(status === 401, `expected 401 without a token, got ${status}`);
});

test('escalation resolve rejects an invalid outcome', async () => {
  const { childId, chin } = await makeReminderChild(200, { phone: null });
  await reminderSvc().runCycle();
  const { body } = await json('GET', '/api/escalations');
  const mine = body.escalations.find((e: any) => e.chin === chin);
  const bad = await json('POST', `/api/escalations/${mine.id}/resolve`, { outcome: 'not-a-real-outcome' });
  assert(bad.status === 400, `expected 400 for a bad outcome, got ${bad.status}`);
  await retireChild(childId);
});

test('escalation resolve rejects a malformed id with 400, not a 500', async () => {
  const { status } = await json('POST', '/api/escalations/not-an-object-id/resolve', { outcome: 'other' });
  assert(status === 400, `expected 400 for a malformed id, got ${status}`);
});

// --- ATM front door: the authorised verification terminal (NCIHAP §16/§24) ---

async function jsonAs(token: string, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

let termChin = '';
const verifierToken = issueToken({ id: 'v1', username: 'gatekeeper', role: 'verifier' });
const staffToken = issueToken({ id: 's1', username: 'health.worker', role: 'staff' });
const adminTokenT = issueToken({ id: 'a1', username: 'sys.admin', role: 'admin' });

test('terminal setup: register an overdue child for verification', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Terminal Carer', phone: '+2348090000000' });
  const dob = new Date(NOON.getTime() - 120 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Terminal Child', sex: 'male', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  assert(reg.status === 201, `expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);
  termChin = reg.body.chin;
});

test('search finds a child by name, caregiver, phone or part of the CHIN', async () => {
  const find = async (q: string) => (await json('GET', `/api/children/search?q=${encodeURIComponent(q)}`)).body.results as Array<{ chin: string }>;
  const has = (rs: Array<{ chin: string }>) => rs.some((r) => r.chin === termChin);
  assert(has(await find('terminal child')), 'by child name, any case');
  assert(has(await find('child  TERMINAL')), 'by name words in any order');
  assert(has(await find('Terminal Carer')), 'by caregiver name');
  assert(has(await find('0809 000 0000')), 'by caregiver phone in local format');
  assert(has(await find(termChin.slice(-6))), 'by the last digits of the CHIN');
  const exact = await find(termChin.toLowerCase());
  assert(exact[0]?.chin === termChin, 'exact CHIN comes first');
  assert((await find('t')).length === 0, 'one character returns nothing');
  assert((await find('.*')).length === 0, 'regex characters are taken literally');
});

test('parent lookup by phone finds the family and their children', async () => {
  const { status, body } = await json('GET', `/api/caregivers/by-phone?phone=${encodeURIComponent('0809 000 0000')}`);
  assert(status === 200, `expected 200, got ${status}`);
  const carer = body.caregivers.find((c: { fullName: string }) => c.fullName === 'Terminal Carer');
  assert(carer, 'finds the parent from a local-format number');
  assert(carer.children.some((k: { chin: string }) => k.chin === termChin), 'lists their child');
  const short = await json('GET', '/api/caregivers/by-phone?phone=0809');
  assert(short.body.caregivers.length === 0, 'a partial number matches nobody');
  const v = await jsonAs(verifierToken, 'GET', '/api/caregivers/by-phone?phone=08090000000');
  assert(v.status === 403, `verifier should get 403, got ${v.status}`);
});

test('a second child can join an existing parent', async () => {
  const found = await json('GET', '/api/caregivers/by-phone?phone=08090000000');
  const carer = found.body.caregivers.find((c: { fullName: string }) => c.fullName === 'Terminal Carer');
  const dob = new Date(NOON.getTime() - 3 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Terminal Sibling', sex: 'female', dateOfBirth: dob, caregiverId: carer._id, homeFacilityId: facilityAId
  });
  assert(reg.status === 201, `expected 201, got ${reg.status}`);
  const again = await json('GET', '/api/caregivers/by-phone?phone=08090000000');
  const same = again.body.caregivers.filter((c: { fullName: string }) => c.fullName === 'Terminal Carer');
  assert(same.length === 1, 'still one parent record');
  assert(same[0].children.length === 2, `both children listed, got ${same[0].children.length}`);
});

test('search is for staff and admins only', async () => {
  const r = await jsonAs(verifierToken, 'GET', '/api/children/search?q=terminal');
  assert(r.status === 403, `expected 403, got ${r.status}`);
});

test('verifier sees ONLY the status headline, not the medical record (least-privilege)', async () => {
  const { status, body } = await jsonAs(verifierToken, 'POST', '/api/terminal/lookup', { chin: termChin });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.tier === 'verifier', `expected verifier tier, got ${body.tier}`);
  assert(body.headline === 'ATTENTION REQUIRED', `expected ATTENTION REQUIRED, got ${body.headline}`);
  assert(body.record.chin === termChin && typeof body.record.childName === 'string', 'missing minimal identity');
  assert(body.record.status && body.record.statusHeadline, 'missing status');
  // §24: a verifier must NOT get the full medical record.
  assert(body.record.doses === undefined, 'verifier must not see the dose history');
  assert(body.record.dateOfBirth === undefined, 'verifier must not see DOB');
  assert(body.record.caregiver === undefined, 'verifier must not see caregiver contact');
});

test('verifier cannot read the follow-up queue (caregiver contacts)', async () => {
  const list = await jsonAs(verifierToken, 'GET', '/api/escalations');
  assert(list.status === 403, `expected 403 for the list, got ${list.status}`);
  const count = await jsonAs(verifierToken, 'GET', '/api/escalations/count');
  assert(count.status === 403, `expected 403 for the count, got ${count.status}`);
});

test('follow-up count matches the open list', async () => {
  const list = await jsonAs(staffToken, 'GET', '/api/escalations');
  const { status, body } = await jsonAs(staffToken, 'GET', '/api/escalations/count');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.open === list.body.count, `count ${body.open} should match list ${list.body.count}`);
});

test('health worker sees the full record needed to continue care', async () => {
  const { status, body } = await jsonAs(staffToken, 'POST', '/api/terminal/lookup', { chin: termChin });
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.tier === 'staff', `expected staff tier, got ${body.tier}`);
  assert(Array.isArray(body.record.doses) && body.record.doses.length > 0, 'staff should see the dose schedule');
  assert(body.record.caregiver && body.record.caregiver.phone === '+2348090000000', 'staff should see caregiver contact');
  assert(body.record.dateOfBirth, 'staff should see DOB');
});

test('lookup by scanned QR works and is marked as a QR access', async () => {
  const qr = buildVerificationUrl(termChin); // the exact string the card encodes
  const { status, body } = await jsonAs(staffToken, 'POST', '/api/terminal/lookup', { qr });
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  assert(body.method === 'qr', `expected method qr, got ${body.method}`);
  assert(body.record.chin === termChin, 'QR lookup resolved the wrong child');
});

test('a forged QR token is rejected', async () => {
  const forged = buildVerificationUrl(termChin).replace(/t=.*$/, 't=forgedtoken00');
  const { status } = await jsonAs(staffToken, 'POST', '/api/terminal/lookup', { qr: forged });
  // 403 rather than 401: a 401 tells the app the user's own session is invalid.
  assert(status === 403, `expected 403 for a forged QR, got ${status}`);
});

test('a mistyped CHIN is caught before it hits the database', async () => {
  const typo = termChin.slice(0, -1) + (termChin.slice(-1) === '0' ? '1' : '0');
  const { status } = await jsonAs(staffToken, 'POST', '/api/terminal/lookup', { chin: typo });
  assert(status === 400, `expected 400 for a mistyped CHIN, got ${status}`);
});

test('a valid but unknown CHIN returns 404 and is still audited', async () => {
  let ghost = generateChin();
  while (ghost === termChin) ghost = generateChin();
  const { status } = await jsonAs(staffToken, 'POST', '/api/terminal/lookup', { chin: ghost });
  assert(status === 404, `expected 404 for an unknown CHIN, got ${status}`);
  // The not-found lookup is still recorded (admin can review it).
  const log = await jsonAs(adminTokenT, 'GET', `/api/children/${encodeURIComponent(ghost)}/access-log`);
  assert(log.body.count >= 1 && log.body.accesses[0].outcome === 'not_found', 'not-found access was not audited');
});

test('every terminal access is written to the audit trail (admin can review)', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', `/api/children/${encodeURIComponent(termChin)}/access-log`);
  assert(status === 200, `expected 200, got ${status}`);
  // verifier + staff(chin) + staff(qr) = at least 3 successful accesses logged.
  assert(body.count >= 3, `expected >=3 audited accesses, got ${body.count}`);
  const roles = body.accesses.map((a: any) => a.accessorRole);
  assert(roles.includes('verifier') && roles.includes('staff'), 'audit trail missing accessor roles');
  assert(body.accesses.every((a: any) => a.accessedBy && a.at), 'audit rows must record who and when');
});

test('the audit trail is admin-only', async () => {
  const { status } = await jsonAs(staffToken, 'GET', `/api/children/${encodeURIComponent(termChin)}/access-log`);
  assert(status === 403, `expected 403 for non-admin audit access, got ${status}`);
});

// --- National Command Dashboard (NCIHAP §11) ---

function dashDose(code: string, name: string, dnum: number, offsetDays: number, administered: boolean) {
  // The dashboard endpoints evaluate status against the real clock, so base the
  // fixture's due dates on real "now" too — otherwise a dose meant to be "due in
  // 3 days" silently becomes overdue once the wall clock passes NOON+3.
  const due = new Date(Date.now() + offsetDays * DAY);
  return { vaccineCode: code, displayName: name, doseNumber: dnum, dueDate: due, administeredDate: administered ? due : null };
}
async function dashFacility(state: string, lga: string, ward: string, name: string) {
  return FacilityModel.create({ name, wardName: ward, lgaName: lga, stateName: state, location: { lat: 9, lng: 7 } });
}
let dashCgId: any = '';
async function dashChild(facId: any, doses: ReturnType<typeof dashDose>[]) {
  return ChildModel.create({
    chin: generateChin(), fullName: 'Dashboard Child', sex: 'male',
    dateOfBirth: new Date(NOON.getTime() - 400 * DAY),
    caregiverId: dashCgId, homeFacilityId: facId, currentFacilityId: facId, doses
  });
}

const ST = 'Zamfara-Test'; // unique state so the scoped assertions are isolated

test('dashboard setup: build a controlled state dataset', async () => {
  const cg = await CaregiverModel.create({ fullName: 'Dash Carer', phone: '+2348060000000' });
  dashCgId = cg._id;
  const f1 = await dashFacility(ST, 'LGA-1', 'Ward-A', 'PHC Alpha');
  const f2 = await dashFacility(ST, 'LGA-1', 'Ward-B', 'PHC Beta');
  const f3 = await dashFacility(ST, 'LGA-2', 'Ward-C', 'PHC Gamma');

  // A: complete (BLUE) — 2 administered
  await dashChild(f1, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('OPV', 'OPV', 1, -30, true)]);
  // B: zero-dose, on track (GREEN) — due in 20d
  await dashChild(f1, [dashDose('PCV', 'PCV', 1, 20, false)]);
  // C: dropout (started then overdue, RED) — 1 administered + 1 overdue, plus
  // another dose due in 3 days: overdue AND due this week, but only one status.
  await dashChild(f2, [dashDose('BCG', 'BCG', 1, -40, true), dashDose('PENTA', 'Pentavalent', 1, -10, false), dashDose('OPV', 'OPV', 2, 3, false)]);
  // D: due this week (AMBER), zero-dose — due in 3d
  await dashChild(f3, [dashDose('MEASLES', 'Measles', 1, 3, false)]);
  // E: overdue (RED), zero-dose — never started
  await dashChild(f3, [dashDose('OPV', 'OPV', 1, -20, false)]);
});

test('dashboard is admin-only', async () => {
  const { status } = await jsonAs(staffToken, 'GET', '/api/dashboard/summary');
  assert(status === 403, `expected 403 for non-admin, got ${status}`);
});

test('scoped state summary aggregates exactly, with no individual PII', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', `/api/dashboard/summary?state=${encodeURIComponent(ST)}`);
  assert(status === 200, `expected 200, got ${status}: ${JSON.stringify(body)}`);
  const t = body.totals;
  assert(t.registered === 5, `registered expected 5, got ${t.registered}`);
  assert(t.dosesAdministered === 3, `dosesAdministered expected 3, got ${t.dosesAdministered}`);
  assert(t.completed === 1, `completed expected 1, got ${t.completed}`);
  assert(t.overdue === 2, `overdue expected 2, got ${t.overdue}`);
  assert(t.zeroDose === 3, `zeroDose expected 3, got ${t.zeroDose}`);
  // dueThisWeek counts any child with a dose due within 7 days (D and C); the
  // status counts are exclusive, one per child, and partition the registered.
  assert(t.dueThisWeek === 2, `dueThisWeek expected 2, got ${t.dueThisWeek}`);
  assert(t.onTrack === 1, `onTrack expected 1, got ${t.onTrack}`);
  assert(t.dueSoon === 1, `dueSoon expected 1 (D only; C is overdue), got ${t.dueSoon}`);
  const byStatus = t.onTrack + t.dueSoon + t.overdue + t.completed + t.needsReconciliation;
  assert(byStatus === t.registered, `status counts should add up to registered (${t.registered}), got ${byStatus}`);
  assert(t.dropout === 1, `dropout expected 1, got ${t.dropout}`);
  assert(t.completionRate === 0.2, `completionRate expected 0.2, got ${t.completionRate}`);
  assert(t.dropoutRate === 0.5, `dropoutRate expected 0.5, got ${t.dropoutRate}`);

  // Breakdown one level down = by LGA.
  assert(body.breakdownBy === 'lga', `expected breakdownBy lga, got ${body.breakdownBy}`);
  const l1 = body.breakdown.find((b: any) => b.key === 'LGA-1');
  const l2 = body.breakdown.find((b: any) => b.key === 'LGA-2');
  assert(l1 && l1.metrics.registered === 3, `LGA-1 expected 3, got ${l1?.metrics.registered}`);
  assert(l2 && l2.metrics.registered === 2, `LGA-2 expected 2, got ${l2?.metrics.registered}`);

  // Vaccine utilisation (administered): BCG x2 (A,C), OPV x1 (A).
  const bcg = body.vaccineUtilisation.find((v: any) => v.vaccineCode === 'BCG');
  assert(bcg && bcg.administered === 2, `BCG utilisation expected 2, got ${bcg?.administered}`);

  // §24 privacy: the payload must not carry any individual identifier.
  const raw = JSON.stringify(body);
  assert(!/CHN-/.test(raw), 'dashboard leaked a CHIN');
  assert(!/Dashboard Child/.test(raw), 'dashboard leaked a child name');
  assert(!/2348060000000/.test(raw), 'dashboard leaked a phone number');
});

test('summary counts Healthy Start and the follow-up queue within the scope', async () => {
  // One child in a fresh state gets a certificate and an open follow-up; a
  // child elsewhere gets a certificate too. The state's cards must show 1 each.
  const f = await dashFacility('Kpi-State', 'KP-1', 'W', 'Kpi PHC');
  const other = await dashFacility('Kpi-Other', 'KO-1', 'W', 'Kpi Other PHC');
  const inState = await dashChild(f, [dashDose('BCG', 'BCG', 1, -60, true)]);
  await dashChild(f, [dashDose('PENTA', 'Pentavalent', 1, -10, false)]);
  const elsewhere = await dashChild(other, [dashDose('BCG', 'BCG', 1, -60, true)]);
  const cert = (c: any, code: string) => ({
    childId: c._id, chin: c.chin, verificationCode: code, issuedAt: new Date(),
    coverageStartsAt: new Date(), coverageExpiresAt: new Date(Date.now() + 365 * DAY)
  });
  const certs = await CertificateModel.insertMany([cert(inState, 'kpi-test-1'), cert(elsewhere, 'kpi-test-2')]);
  const esc = await EscalationModel.create({
    childId: inState._id, chin: inState.chin, doseKey: 'PENTA#1', reason: 'max_attempts', raisedAt: new Date(), lastSeenAt: new Date()
  });
  try {
    const scoped = await jsonAs(adminTokenT, 'GET', '/api/dashboard/summary?state=Kpi-State');
    assert(scoped.body.healthyStartActive === 1, `scoped healthyStartActive expected 1, got ${scoped.body.healthyStartActive}`);
    assert(scoped.body.openEscalations === 1, `scoped openEscalations expected 1, got ${scoped.body.openEscalations}`);
    const national = await jsonAs(adminTokenT, 'GET', '/api/dashboard/summary');
    assert(national.body.healthyStartActive >= 2, `national healthyStartActive should include both, got ${national.body.healthyStartActive}`);
  } finally {
    await EscalationModel.deleteOne({ _id: esc._id });
    await CertificateModel.deleteMany({ _id: { $in: certs.map((c) => c._id) } });
  }
});

test('dashboard drills down State → LGA → Ward', async () => {
  const { body } = await jsonAs(adminTokenT, 'GET', `/api/dashboard/summary?state=${encodeURIComponent(ST)}&lga=LGA-1`);
  assert(body.breakdownBy === 'ward', `expected breakdownBy ward, got ${body.breakdownBy}`);
  const wa = body.breakdown.find((b: any) => b.key === 'Ward-A');
  const wb = body.breakdown.find((b: any) => b.key === 'Ward-B');
  assert(wa && wa.metrics.registered === 2, `Ward-A expected 2, got ${wa?.metrics.registered}`);
  assert(wb && wb.metrics.registered === 1, `Ward-B expected 1, got ${wb?.metrics.registered}`);
});

test('stock forecast counts upcoming demand per vaccine', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', `/api/dashboard/stock-forecast?weeks=4&state=${encodeURIComponent(ST)}`);
  assert(status === 200, `expected 200, got ${status}`);
  // Within 4 weeks: B's PCV (+20d) and D's Measles (+3d). Overdue doses excluded.
  const pcv = body.byVaccine.find((v: any) => v.vaccineCode === 'PCV');
  const measles = body.byVaccine.find((v: any) => v.vaccineCode === 'MEASLES');
  assert(pcv && pcv.dueCount === 1, `PCV forecast expected 1, got ${pcv?.dueCount}`);
  assert(measles && measles.dueCount === 1, `Measles forecast expected 1, got ${measles?.dueCount}`);
  assert(!body.byVaccine.some((v: any) => v.vaccineCode === 'PENTA'), 'overdue PENTA must not be in the forecast');
  // Weekly split: Measles (+3d) falls in week 1, PCV (+20d) in week 3.
  assert(JSON.stringify(measles.byWeek) === '[1,0,0,0]', `Measles byWeek expected [1,0,0,0], got ${JSON.stringify(measles.byWeek)}`);
  assert(JSON.stringify(pcv.byWeek) === '[0,0,1,0]', `PCV byWeek expected [0,0,1,0], got ${JSON.stringify(pcv.byWeek)}`);
});

test('§18 supply plan turns demand into cold-chain, staffing and deployment', async () => {
  const f1 = await dashFacility('Supply-State', 'SL-1', 'W', 'Supply PHC 1');
  const f2 = await dashFacility('Supply-State', 'SL-2', 'W', 'Supply PHC 2');
  for (let i = 0; i < 3; i++) await dashChild(f1, [dashDose('OPV', 'OPV', 1, 5, false)]); // 3 doses due soon in SL-1
  for (let i = 0; i < 2; i++) await dashChild(f2, [dashDose('PCV', 'PCV', 1, 10, false)]); // 2 in SL-2

  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/supply-plan?weeks=4&state=Supply-State');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.totalDoses === 5, `expected 5 doses due, got ${body.totalDoses}`);
  assert(body.coldChain.doses === 5, 'cold-chain doses must match total');
  assert(body.staffing.vaccinatorsNeeded >= 1, 'must recommend at least one vaccinator');
  assert(body.breakdownBy === 'lga', `expected lga breakdown, got ${body.breakdownBy}`);
  const sl1 = body.deployment.find((d: any) => d.area === 'SL-1');
  const sl2 = body.deployment.find((d: any) => d.area === 'SL-2');
  assert(sl1 && sl1.dueCount === 3 && sl2 && sl2.dueCount === 2, `deployment breakdown wrong: ${JSON.stringify(body.deployment)}`);
  assert(body.deployment[0].dueCount >= body.deployment[1].dueCount, 'deployment must be highest-demand first');
  assert(typeof body.outreach.overdue === 'number' && typeof body.outreach.zeroDose === 'number', 'outreach counts present');
  assert(body.assumptions.dosesPerVaccinatorPerDay > 0, 'planning assumptions are surfaced');

  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/supply-plan');
  assert(denied.status === 403, `supply plan must be admin-only, got ${denied.status}`);
});

test('§18 cold-chain volume uses per-antigen WHO figures, not a flat constant', async () => {
  // Two facilities, same dose count, different antigens: BCG (~0.9 cm³/dose) is
  // far more compact than MR (~5.2 cm³/dose incl. diluent). A flat per-dose
  // constant would give both the same volume — which is what misled planners.
  const fb = await dashFacility('ColdChain-State', 'CC-BCG', 'W', 'BCG PHC');
  const fm = await dashFacility('ColdChain-State', 'CC-MR', 'W', 'MR PHC');
  for (let i = 0; i < 10; i++) await dashChild(fb, [dashDose('BCG', 'BCG', 1, 5, false)]);
  for (let i = 0; i < 10; i++) await dashChild(fm, [dashDose('MR', 'Measles–Rubella', 1, 5, false)]);

  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/supply-plan?weeks=4&state=ColdChain-State');
  assert(status === 200, `expected 200, got ${status}`);

  const bcg = body.demandByVaccine.find((v: any) => v.vaccineCode === 'BCG');
  const mr = body.demandByVaccine.find((v: any) => v.vaccineCode === 'MR');
  assert(bcg && mr, `expected BCG and MR rows, got ${JSON.stringify(body.demandByVaccine)}`);
  assert(bcg.dueCount === 10 && mr.dueCount === 10, 'both antigens should have 10 doses due');
  assert(bcg.cm3PerDose < mr.cm3PerDose, `BCG (${bcg.cm3PerDose}) must be more compact than MR (${mr.cm3PerDose})`);
  assert(mr.totalCm3 > bcg.totalCm3 * 2, 'MR total volume must dominate BCG for the same dose count');
  assert(body.assumptions.perAntigenVolumes === true, 'plan must declare it uses per-antigen volumes');
});

test('§19 antenatal: a pregnancy registers, takes visits, and converts to a child at birth', async () => {
  const fac = await dashFacility('Antenatal-State', 'AN-1', 'W', 'ANC PHC');
  const cg = await CaregiverModel.create({ fullName: 'Expectant Carer', phone: '+2348070000001' });
  const edd = new Date(Date.now() + 30 * DAY);

  const created = await jsonAs(staffToken, 'POST', '/api/pregnancies', {
    caregiverId: String(cg._id), facilityId: String(fac._id), expectedDeliveryDate: edd.toISOString()
  });
  assert(created.status === 201, `expected 201, got ${created.status}`);
  const ancId = created.body.ancId;
  assert(/^NG-ANC-\d{8}$/.test(ancId), `ANC id must be its own namespace, got ${ancId}`);
  assert(ancId.indexOf('NG-2') !== 0, 'an ANC id must never look like a CHIN');
  assert(created.body.visitCount === 0 && created.body.risk === 'at_risk',
    'a pregnancy with no recorded contacts starts at risk');
  assert(created.body.caregiverPhone === '+2348070000001',
    'the caregiver phone must carry through — it is what the USSD channel keys on');

  // Four contacts is the threshold where zero-dose risk roughly halves.
  for (let i = 0; i < 4; i++) {
    const v = await jsonAs(staffToken, 'POST', `/api/pregnancies/${ancId}/visits`, {});
    assert(v.status === 200, `visit ${i + 1} failed with ${v.status}`);
  }
  const fourth = await jsonAs(staffToken, 'GET', '/api/antenatal/follow-up');
  assert(fourth.status === 200, 'follow-up list must be readable by staff');

  // The birth: the antenatal record becomes a child record.
  const linked = await jsonAs(staffToken, 'POST', `/api/pregnancies/${ancId}/link-birth`, {
    fullName: 'Linked Newborn', sex: 'female', dateOfBirth: new Date().toISOString()
  });
  assert(linked.status === 201, `expected 201 on link, got ${linked.status}`);
  assert(/^NG-\d{2}-\d{2}-\d{8}$/.test(linked.body.chin), `expected a real CHIN, got ${linked.body.chin}`);
  assert(linked.body.ancVisits === 4, `expected 4 carried-over visits, got ${linked.body.ancVisits}`);

  // The child exists, carries the antenatal channel, and kept the same caregiver.
  const child = await ChildModel.findOne({ chin: linked.body.chin });
  assert(child, 'linking must actually create the child');
  assert(child!.registrationChannel === 'antenatal', `expected antenatal channel, got ${child!.registrationChannel}`);
  assert(String(child!.caregiverId) === String(cg._id), 'the caregiver must carry across from the pregnancy');
  assert(child!.doses.length > 0, 'the linked child must get a full schedule');

  // Linking twice must not mint a second child for the same pregnancy.
  const again = await jsonAs(staffToken, 'POST', `/api/pregnancies/${ancId}/link-birth`, {
    fullName: 'Duplicate', sex: 'male', dateOfBirth: new Date().toISOString()
  });
  assert(again.status === 409, `re-linking must be refused, got ${again.status}`);
});

test('§19 antenatal: a pregnancy loss closes quietly and stops generating follow-up', async () => {
  const fac = await dashFacility('Antenatal-State', 'AN-2', 'W', 'ANC PHC 2');
  const cg = await CaregiverModel.create({ fullName: 'Second Carer', phone: '+2348070000002' });
  const created = await jsonAs(staffToken, 'POST', '/api/pregnancies', {
    caregiverId: String(cg._id), facilityId: String(fac._id),
    expectedDeliveryDate: new Date(Date.now() - 40 * DAY).toISOString() // already overdue
  });
  const ancId = created.body.ancId;

  const before = await jsonAs(staffToken, 'GET', '/api/antenatal/follow-up');
  assert(before.body.pregnancies.some((p: any) => p.ancId === ancId),
    'an overdue pregnancy must appear on the follow-up list');

  const closed = await jsonAs(staffToken, 'POST', `/api/pregnancies/${ancId}/close`, { reason: 'not_a_live_birth' });
  assert(closed.status === 200, `expected 200 on close, got ${closed.status}`);
  assert(closed.body.status === 'closed', 'the record must be closed');

  const after = await jsonAs(staffToken, 'GET', '/api/antenatal/follow-up');
  assert(!after.body.pregnancies.some((p: any) => p.ancId === ancId),
    'a closed pregnancy must stop generating follow-up work');

  const cannotLink = await jsonAs(staffToken, 'POST', `/api/pregnancies/${ancId}/link-birth`, {
    fullName: 'X', sex: 'male', dateOfBirth: new Date().toISOString()
  });
  assert(cannotLink.status === 409, `a closed record must not be linkable, got ${cannotLink.status}`);
});

test('§19 antenatal pipeline: counts the unborn, flags low-contact, admin-only', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/antenatal?weeks=12');
  assert(status === 200, `expected 200, got ${status}`);
  assert(typeof body.active === 'number' && typeof body.linked === 'number', 'pipeline counts present');
  assert(body.byRisk.atRisk + body.byRisk.onTrack + body.byRisk.recommended === body.active,
    'every active pregnancy must fall in exactly one contact band');
  assert(body.linked >= 1, 'the linked birth from the earlier test must be counted');
  assert(body.conversionRate > 0 && body.conversionRate <= 1, `conversion rate out of range: ${body.conversionRate}`);
  assert(Array.isArray(body.byArea), 'expected births broken down by area');

  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/antenatal');
  assert(denied.status === 403, `the antenatal pipeline must be admin-only, got ${denied.status}`);

  const verifierDenied = await jsonAs(verifierToken, 'GET', '/api/antenatal/follow-up');
  assert(verifierDenied.status === 403, `verifiers must not see antenatal contact details, got ${verifierDenied.status}`);
});

test('§18 supply plan sees birth doses for children not yet born', async () => {
  const fac = await dashFacility('BirthDose-State', 'BD-1', 'W', 'Birth Dose PHC');
  const cg = await CaregiverModel.create({ fullName: 'Third Carer', phone: '+2348070000003' });
  // Three pregnancies due inside a 4-week horizon.
  for (let i = 0; i < 3; i++) {
    await jsonAs(staffToken, 'POST', '/api/pregnancies', {
      caregiverId: String(cg._id), facilityId: String(fac._id),
      expectedDeliveryDate: new Date(Date.now() + (7 + i) * DAY).toISOString()
    });
  }

  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/supply-plan?weeks=4');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.expectedBirths.births >= 3, `expected at least 3 births due, got ${body.expectedBirths.births}`);
  // Every birth needs BCG + OPV0 + HepB0.
  assert(body.expectedBirths.birthDoses === body.expectedBirths.births * 3,
    'each expected birth must budget three birth doses');
  assert(body.expectedBirths.coldChainLitres >= 0, 'birth-dose cold-chain volume must be reported');
});

test('§4 civil registration: refer to NPC, carry back the number and NIN', async () => {
  const fac = await dashFacility('Identity-State', 'ID-1', 'W', 'Identity PHC');
  const cg = await CaregiverModel.create({ fullName: 'Identity Carer', phone: '+2348090000001', nin: '11122233344' });
  const reg = await jsonAs(staffToken, 'POST', '/api/children', {
    fullName: 'Unregistered Child', sex: 'male', dateOfBirth: new Date(Date.now() - 30 * DAY).toISOString(),
    caregiverId: String(cg._id), homeFacilityId: String(fac._id), birthSetting: 'home', registrationChannel: 'chw'
  });
  const chin = reg.body.chin;

  // A child known to health but invisible to the state — the default, and the point.
  const child0 = await ChildModel.findOne({ chin });
  assert(child0!.birthRegistration.status === 'not_registered',
    'a newly registered child starts with no civil registration');

  const referred = await jsonAs(staffToken, 'POST', `/api/children/${chin}/birth-registration/refer`, {});
  assert(referred.status === 200, `expected 200 on refer, got ${referred.status}`);
  assert(referred.body.status === 'referred' && referred.body.referredAt, 'refer records status and time');

  const done = await jsonAs(staffToken, 'POST', `/api/children/${chin}/birth-registration`, {
    registrationNumber: 'BRN-2026-004417', nin: '99988877766'
  });
  assert(done.status === 200, `expected 200 on record, got ${done.status}`);
  assert(done.body.status === 'registered', 'status becomes registered');
  assert(done.body.registrationNumber === 'BRN-2026-004417', 'the NPC number is carried onto the health record');
  assert(done.body.nin === '99988877766', 'the NIN is carried too — it is what makes BHCPF enrolment possible');

  // Re-referring an already-registered child is refused, not silently re-run.
  const again = await jsonAs(staffToken, 'POST', `/api/children/${chin}/birth-registration/refer`, {});
  assert(again.status === 409, `re-referring a registered child must be refused, got ${again.status}`);

  const verifierDenied = await jsonAs(verifierToken, 'POST', `/api/children/${chin}/birth-registration/refer`, {});
  assert(verifierDenied.status === 403, `verifiers must not touch civil registration, got ${verifierDenied.status}`);
});

test('§4 identity gap rolls up into registration & mobility (admin-only)', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/registration-mobility');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.identity, 'the identity gap is reported alongside registration');
  assert(body.identity.registered >= 1, 'the registered child from the previous test is counted');
  assert(body.identity.withNin >= 1, 'children carrying a NIN are counted');
  assert(body.identity.known === body.registered,
    'the identity denominator must be every child the health system knows');
  assert(body.identity.unregistered === body.identity.known - body.identity.registered,
    'unregistered is everything not yet carrying a birth registration number');
  assert(Array.isArray(body.identity.byState) && body.identity.byState.length > 0,
    'the gap is broken down by state, worst-first');
});

test('§22 FHIR export: Patient, doses given, and what is still due', async () => {
  const fac = await dashFacility('Fhir-State', 'FH-1', 'W', 'FHIR PHC');
  const cg = await CaregiverModel.create({ fullName: 'Fhir Carer', phone: '+2348090000002' });
  const reg = await jsonAs(staffToken, 'POST', '/api/children', {
    fullName: 'Fhir Child', sex: 'female', dateOfBirth: new Date(Date.now() - 200 * DAY).toISOString(),
    caregiverId: String(cg._id), homeFacilityId: String(fac._id)
  });
  const chin = reg.body.chin;
  await jsonAs(staffToken, 'POST', `/api/children/${chin}/doses`, {
    vaccineCode: 'BCG', doseNumber: 1, facilityId: String(fac._id)
  });

  const { status, body } = await jsonAs(staffToken, 'GET', `/api/children/${chin}/fhir`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.resourceType === 'Bundle' && body.type === 'collection', 'a FHIR collection Bundle');

  const kinds = body.entry.map((e: any) => e.resource.resourceType);
  assert(kinds.includes('Patient'), 'Bundle carries the Patient');
  assert(kinds.includes('Immunization'), 'Bundle carries the administered dose');
  assert(kinds.includes('ImmunizationRecommendation'),
    'Bundle carries what is still DUE — the payload a reporting system does not hold');

  const patient = body.entry.find((e: any) => e.resource.resourceType === 'Patient').resource;
  assert(patient.identifier.some((i: any) => i.value === chin), 'the CHIN is the Patient identifier');
  assert(!patient.identifier.some((i: any) => i.system.includes('nin')),
    'no NIN identifier is emitted for an unregistered child — absence is the finding');
  assert(patient.gender === 'female' && patient.birthDate, 'core demographics are present');

  const imm = body.entry.find((e: any) => e.resource.resourceType === 'Immunization').resource;
  assert(imm.status === 'completed' && imm.vaccineCode.coding[0].code === 'BCG', 'the dose is coded');
  assert(imm.patient.reference === `Patient/${patient.id}`, 'the dose references the patient');

  const rec = body.entry.find((e: any) => e.resource.resourceType === 'ImmunizationRecommendation').resource;
  assert(rec.recommendation.length > 0 && rec.recommendation[0].dateCriterion[0].value,
    'each outstanding dose carries the date it is due');

  const verifierDenied = await jsonAs(verifierToken, 'GET', `/api/children/${chin}/fhir`);
  assert(verifierDenied.status === 403, `verifiers must not export child records, got ${verifierDenied.status}`);
});

test('administration trend returns one point per week', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/trend?weeks=8');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.points) && body.points.length === 8, `expected 8 weekly points, got ${body.points?.length}`);
  assert(body.points.every((p: any) => p.weekStarting && typeof p.dosesAdministered === 'number'), 'malformed trend point');

  // Scoped to the dashboard fixture state: A's OPV (30 days ago) and C's BCG
  // (40 days ago) fall inside 8 weeks; A's BCG (60 days ago) does not.
  const scoped = await jsonAs(adminTokenT, 'GET', `/api/dashboard/trend?weeks=8&state=${encodeURIComponent(ST)}`);
  const total = scoped.body.points.reduce((a: number, p: any) => a + p.dosesAdministered, 0);
  assert(total === 2, `scoped trend expected 2 doses, got ${total}`);
  const empty = await jsonAs(adminTokenT, 'GET', '/api/dashboard/trend?weeks=8&state=No-Such-State');
  assert(empty.body.points.length === 8 && empty.body.points.every((p: any) => p.dosesAdministered === 0), 'an empty area should give 8 zero weeks');
});

test('outlier detection flags a facility with an unusual dropout rate', async () => {
  // Three facilities of 5 children each, in a separate state: two healthy
  // (0 dropout), one bad (all dropout). The bad one should be flagged.
  const good1 = await dashFacility('Outlier-State', 'OL-1', 'W', 'Healthy PHC 1');
  const good2 = await dashFacility('Outlier-State', 'OL-1', 'W', 'Healthy PHC 2');
  const bad = await dashFacility('Outlier-State', 'OL-2', 'W', 'Struggling PHC');
  for (let i = 0; i < 5; i++) {
    // healthy: started and complete → 0 dropout
    await dashChild(good1, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('OPV', 'OPV', 1, -30, true)]);
    await dashChild(good2, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('OPV', 'OPV', 1, -30, true)]);
    // bad: started then overdue → dropout
    await dashChild(bad, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('PENTA', 'Pentavalent', 1, -10, false)]);
  }

  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/outliers');
  assert(status === 200, `expected 200, got ${status}`);
  const flagged = body.outliers.find((o: any) => o.facility === 'Struggling PHC');
  assert(flagged, 'the struggling facility should be flagged as an outlier');
  assert(flagged.dropoutRate === 1, `expected dropoutRate 1, got ${flagged.dropoutRate}`);
  assert(!body.outliers.some((o: any) => o.facility === 'Healthy PHC 1'), 'a healthy facility must not be flagged');
  // The full ranking carries every eligible facility, worst first, with the
  // average and threshold, so the panel can show the ones below the line too.
  const healthy = body.facilities.find((f: any) => f.facility === 'Healthy PHC 1');
  assert(healthy && healthy.outlier === false, 'a healthy facility should be ranked but not flagged');
  assert(body.facilities.find((f: any) => f.facility === 'Struggling PHC')?.outlier === true, 'the struggling facility should be flagged in the ranking');
  assert(body.facilities.every((f: any, i: number, all: any[]) => i === 0 || all[i - 1].dropoutRate >= f.dropoutRate), 'ranking must be highest dropout first');
  assert(typeof body.average === 'number' && body.threshold > body.average, `threshold (${body.threshold}) should sit above the average (${body.average})`);

  // Scoped to one state: only that state's facilities are listed, each with its
  // ward (for drilling in), but the average and threshold stay national.
  const scoped = await jsonAs(adminTokenT, 'GET', '/api/dashboard/outliers?state=Outlier-State&lga=OL-2');
  assert(scoped.status === 200, `expected 200, got ${scoped.status}`);
  const names = scoped.body.facilities.map((f: any) => f.facility);
  assert(JSON.stringify(names) === '["Struggling PHC"]', `scoped list should hold only Struggling PHC, got ${JSON.stringify(names)}`);
  assert(scoped.body.facilities[0].ward === 'W', `facility should carry its ward, got ${scoped.body.facilities[0].ward}`);
  assert(scoped.body.average === body.average && scoped.body.threshold === body.threshold, 'average and threshold should be national, not recomputed for the area');
});

test('coverage by priority state ranks worst-first and flags each state', async () => {
  // A healthy state (all children complete) and a priority state (all overdue),
  // in freshly-named states so the assertions are isolated from other tests.
  const healthy = await dashFacility('Alpha-CBS', 'AL-1', 'W', 'Alpha PHC');
  const priority = await dashFacility('Zeta-CBS', 'ZE-1', 'W', 'Zeta PHC');
  for (let i = 0; i < 5; i++) {
    await dashChild(healthy, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('OPV', 'OPV', 1, -30, true)]); // BLUE, complete
    await dashChild(priority, [dashDose('PENTA', 'Pentavalent', 1, -10, false)]); // RED, overdue, 0% complete
  }

  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/coverage-by-state');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.states), 'coverage payload must carry a states array');

  const idx = (name: string) => body.states.findIndex((s: any) => s.state === name);
  const alpha = body.states.find((s: any) => s.state === 'Alpha-CBS');
  const zeta = body.states.find((s: any) => s.state === 'Zeta-CBS');
  assert(alpha && zeta, 'both test states must appear');

  assert(zeta.priority === 'red', `an all-overdue state should be red, got ${zeta.priority}`);
  assert(alpha.priority === 'green', `an all-complete state should be green, got ${alpha.priority}`);
  assert(zeta.overdueRate === 1 && zeta.completionRate === 0, `priority state metrics wrong: ${JSON.stringify(zeta)}`);
  assert(alpha.completionRate === 1 && alpha.overdue === 0, `healthy state metrics wrong: ${JSON.stringify(alpha)}`);
  // Worst-first: the priority state ranks above the healthy one.
  assert(idx('Zeta-CBS') < idx('Alpha-CBS'), 'the priority state must rank before the healthy one');
});

test('coverage by priority state ranks by share overdue, not completion', async () => {
  // Pi: 2 of 4 overdue (50%), the other 2 complete. Qu: 2 of 5 overdue (40%),
  // the other 3 young and on track, none complete yet. Pi has more of its
  // children overdue, so it must rank first even though Qu's completion is lower.
  const pi = await dashFacility('Pi-CBS', 'PI-1', 'W', 'Pi PHC');
  const qu = await dashFacility('Qu-CBS', 'QU-1', 'W', 'Qu PHC');
  for (let i = 0; i < 2; i++) {
    await dashChild(pi, [dashDose('PENTA', 'Pentavalent', 1, -10, false)]);
    await dashChild(pi, [dashDose('BCG', 'BCG', 1, -60, true)]);
    await dashChild(qu, [dashDose('PENTA', 'Pentavalent', 1, -10, false)]);
  }
  for (let i = 0; i < 3; i++) await dashChild(qu, [dashDose('BCG', 'BCG', 1, -5, true), dashDose('PCV', 'PCV', 1, 30, false)]);

  const { body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/coverage-by-state');
  const idx = (name: string) => body.states.findIndex((s: any) => s.state === name);
  assert(idx('Pi-CBS') >= 0 && idx('Qu-CBS') >= 0, 'both test states must appear');
  assert(idx('Pi-CBS') < idx('Qu-CBS'), `50% overdue should rank above 40% overdue, got order ${JSON.stringify(body.states.map((s: any) => s.state))}`);
});

test('coverage by priority state is admin-only', async () => {
  const { status } = await jsonAs(staffToken, 'GET', '/api/dashboard/coverage-by-state');
  assert(status === 403, `expected 403 for a non-admin, got ${status}`);
});

test('geographic breakdown carries a priority flag per area (drill-down triage)', async () => {
  // National summary → breakdown by state; the same flag the priority table
  // uses must appear on every drill-down row so worst areas surface at any level.
  const { body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/summary');
  assert(Array.isArray(body.breakdown) && body.breakdown.length > 0, 'expected a national breakdown');
  assert(body.breakdown.every((b: any) => ['red', 'amber', 'green'].includes(b.priority)), 'every area must carry a priority flag');
  const zeta = body.breakdown.find((b: any) => b.key === 'Zeta-CBS');
  const alpha = body.breakdown.find((b: any) => b.key === 'Alpha-CBS');
  assert(zeta && zeta.priority === 'red', `the all-overdue state should flag red, got ${zeta?.priority}`);
  assert(alpha && alpha.priority === 'green', `the all-complete state should flag green, got ${alpha?.priority}`);
});

test('§17 duplicate-dose detection: a dose already given cannot be re-recorded', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Dup Carer', phone: '+2348070001111' });
  const reg = await json('POST', '/api/children', {
    fullName: 'Dup Child', sex: 'male', dateOfBirth: '2026-06-01', caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  const child = reg.body;
  const d = child.doses[0];

  const first = await json('POST', `/api/children/${encodeURIComponent(child.chin)}/doses`, { vaccineCode: d.vaccineCode, doseNumber: d.doseNumber, facilityId: facilityAId });
  assert(first.status === 200, `first recording should succeed, got ${first.status}`);
  const second = await json('POST', `/api/children/${encodeURIComponent(child.chin)}/doses`, { vaccineCode: d.vaccineCode, doseNumber: d.doseNumber, facilityId: facilityAId });
  assert(second.status === 409, `re-recording an already-given dose must be refused with 409, got ${second.status}`);

  const dupCount = await DoseAdministrationModel.countDocuments({ chin: child.chin, duplicate: true });
  assert(dupCount >= 1, 'the duplicate attempt must be written to the ledger');
  const genuine = await DoseAdministrationModel.countDocuments({ chin: child.chin, duplicate: false });
  assert(genuine >= 1, 'the genuine administration must be on the ledger');
  await ChildModel.updateOne({ chin: child.chin }, { completedAt: NOON });
});

test('§17 abnormal-activity detection flags impossible throughput; admin-only', async () => {
  // Relative to the real clock: the scan looks back a fixed number of days from
  // now, so a fixed calendar date here would age out and silently pass nothing.
  const base = new Date(Date.now() - 60 * 60 * 1000);
  const events = [];
  for (let i = 0; i < VELOCITY_MAX_IN_WINDOW + 3; i++) {
    events.push({
      chin: `NG-99-99-1000000${i % 10}`, childId: '64b7f1d2e4b0a12345678901', vaccineCode: 'X', doseNumber: 1,
      facilityId: null, recordedBy: 'suspect.worker', recordedByRole: 'staff', duplicate: false,
      recordedAt: new Date(base.getTime() + i * 10 * 1000) // 10s apart -> all inside one 10-min window
    });
  }
  await DoseAdministrationModel.insertMany(events);

  const res = await jsonAs(adminTokenT, 'GET', '/api/fraud/alerts');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const vel = res.body.alerts.find((a: any) => a.kind === 'velocity' && a.worker === 'suspect.worker');
  assert(vel && vel.count > VELOCITY_MAX_IN_WINDOW, `expected a velocity alert above the threshold, got ${JSON.stringify(res.body.alerts)}`);

  const denied = await jsonAs(staffToken, 'GET', '/api/fraud/alerts');
  assert(denied.status === 403, `integrity alerts must be admin-only, got ${denied.status}`);
});

test('milestone attainment funnel: counts within registered, admin-only', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/milestones');
  assert(status === 200, `expected 200, got ${status}`);
  assert(typeof body.registered === 'number' && body.registered > 0, 'a registered count is present');
  for (const k of ['birth', 'foundation', 'healthyStart'] as const) {
    assert(typeof body[k] === 'number' && body[k] >= 0 && body[k] <= body.registered, `${k} must be a count within registered`);
  }
  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/milestones');
  assert(denied.status === 403, `milestone attainment must be admin-only, got ${denied.status}`);
});

test('staged milestones (§14): birth badge earned, foundation is the next reward', async () => {
  const dob = new Date('2026-01-01T00:00:00');
  const mk = (offsetDays: number, administered: boolean) => ({
    vaccineCode: 'X', displayName: 'X', doseNumber: 1,
    dueDate: new Date(dob.getTime() + offsetDays * DAY),
    administeredDate: administered ? new Date(dob.getTime() + (offsetDays + 2) * DAY) : null
  });
  // 2 birth doses (given), then infant-series doses (one still pending), then a later dose.
  const doses = [mk(0, true), mk(0, true), mk(42, true), mk(98, false), mk(270, false)];
  const ms = computeMilestones(doses, dob);
  const byKey = Object.fromEntries(ms.map((m) => [m.key, m]));

  assert(ms.length === 3, `expected 3 milestones, got ${ms.length}`);
  assert(byKey.birth.attained === true, 'birth milestone should be earned (both birth doses given)');
  assert(typeof byKey.birth.attainedAt === 'string', 'an earned milestone records when it was earned');
  assert(byKey.foundation.attained === false, 'foundation not earned while a <200d dose is pending');
  assert(byKey.healthy_start.attained === false, 'healthy start not earned until the whole schedule is done');

  const nx = nextMilestone(ms);
  assert(nx && nx.key === 'foundation', `next reward should be foundation, got ${nx?.key}`);
  assert(nx!.dosesToGo === 1, `foundation should be 1 dose away, got ${nx?.dosesToGo}`);

  // A fully-immunised child has earned everything and has no next reward.
  const allDone = computeMilestones(doses.map((d) => ({ ...d, administeredDate: d.dueDate })), dob);
  assert(allDone.every((m) => m.attained), 'a complete schedule earns every milestone');
  assert(nextMilestone(allDone) === null, 'a complete schedule has no next reward');
});

test('§19/§20 registration is not facility-only, and mobility is tracked', async () => {
  // §19: a home birth registered by a community health worker is first-class.
  const cg = await json('POST', '/api/caregivers', { fullName: 'Home Carer', phone: '+2348014447777' });
  const dob = new Date(NOON.getTime() - 15 * DAY).toISOString().slice(0, 10);
  const home = await json('POST', '/api/children', {
    fullName: 'Home Birth Two', sex: 'male', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId,
    birthSetting: 'home', registrationChannel: 'chw'
  });
  assert(home.status === 201, `a home birth must register, got ${home.status}`);
  const stored = await ChildModel.findOne({ chin: home.body.chin });
  assert(stored?.birthSetting === 'home' && stored?.registrationChannel === 'chw', 'birth setting and channel must be recorded');

  // §20: relocating to another facility with a mobility reason, then the record continues there.
  const handoff = await json('POST', `/api/children/${encodeURIComponent(home.body.chin)}/handoff`, {
    toFacilityId: facilityBId, lat: 9.03, lng: 7.49, reason: 'Family displaced', reasonCategory: 'displacement'
  });
  assert(handoff.status === 201 && handoff.body.reasonCategory === 'displacement', `handoff must record the mobility reason: ${JSON.stringify(handoff.body)}`);

  // The Command Centre sees inclusion + mobility (admin-only aggregate).
  const rm = await jsonAs(adminTokenT, 'GET', '/api/dashboard/registration-mobility');
  assert(rm.status === 200, `expected 200, got ${rm.status}`);
  assert(rm.body.birth.home >= 1, 'home births must be counted');
  assert(rm.body.byChannel.some((c: any) => c.channel === 'chw' && c.count >= 1), 'the CHW channel must appear');
  assert(rm.body.mobility.childrenMoved >= 1, 'a relocated child must be counted');
  assert(rm.body.mobility.byReason.some((r: any) => r.reason === 'displacement'), 'the mobility reason must be counted');

  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/registration-mobility');
  assert(denied.status === 403, `registration-mobility must be admin-only, got ${denied.status}`);
  await ChildModel.updateOne({ chin: home.body.chin }, { completedAt: NOON });
});

test('§18 supply plan reports facility cold-chain and access readiness (admin-only)', async () => {
  await FacilityModel.create({
    name: 'Infra PHC', wardName: 'W', lgaName: 'IN-1', stateName: 'Infra-State', location: { lat: 9, lng: 7 },
    coldChainStatus: 'down', accessibility: 'security_compromised'
  });
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/supply-plan?weeks=8&state=Infra-State');
  assert(status === 200, `expected 200, got ${status}`);
  assert(body.infrastructure.facilities >= 1, 'the scoped facility must be counted');
  assert(body.infrastructure.coldChain.down >= 1, 'a down cold chain must be reported');
  assert(body.infrastructure.access.securityCompromised >= 1, 'a security-compromised facility must be reported');

  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/supply-plan');
  assert(denied.status === 403, `supply-plan must be admin-only, got ${denied.status}`);
});

test('§11 defaulting barriers: a traced case records why, and it rolls up (admin-only)', async () => {
  const { childId, chin } = await makeReminderChild(200, { phone: null }); // overdue + unreachable -> escalates
  await reminderSvc().runCycle();
  const list = await json('GET', '/api/escalations');
  const mine = list.body.escalations.find((e: any) => e.chin === chin);
  assert(mine, 'the case should be on the follow-up queue');

  // An unrecognised barrier is rejected (the escalation stays open).
  const bad = await json('POST', `/api/escalations/${mine.id}/resolve`, { outcome: 'reached', barrier: 'astrology' });
  assert(bad.status === 400, `an unknown barrier must be rejected, got ${bad.status}`);

  // Resolve with a real barrier (the documented top driver).
  const ok = await json('POST', `/api/escalations/${mine.id}/resolve`, { outcome: 'reached', barrier: 'hesitancy', note: 'Family declined — belief' });
  assert(ok.status === 200 && ok.body.barrier === 'hesitancy', `resolve must record the barrier: ${JSON.stringify(ok.body)}`);

  // It rolls up in the national "why children default" view (admin-only).
  const dr = await jsonAs(adminTokenT, 'GET', '/api/dashboard/defaulting-reasons');
  assert(dr.status === 200, `expected 200, got ${dr.status}`);
  assert(dr.body.reasons.some((r: any) => r.barrier === 'hesitancy' && r.count >= 1), `hesitancy must be counted: ${JSON.stringify(dr.body)}`);
  const denied = await jsonAs(staffToken, 'GET', '/api/dashboard/defaulting-reasons');
  assert(denied.status === 403, `defaulting-reasons must be admin-only, got ${denied.status}`);

  await retireChild(childId);
});

test('§21 Child Health Wallet: staff add records beyond immunisation; parent sees them; verifier denied', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Wallet Carer', phone: '+2348013335555' });
  const dob = new Date(NOON.getTime() - 60 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Wallet Child', sex: 'female', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  const wchin = reg.body.chin;

  // Empty wallet at first.
  const empty = await jsonAs(staffToken, 'GET', `/api/children/${encodeURIComponent(wchin)}/wallet`);
  assert(empty.status === 200 && Array.isArray(empty.body.records) && empty.body.records.length === 0, 'a new child has an empty wallet');

  // Add a growth record (staff).
  const add = await jsonAs(staffToken, 'POST', `/api/children/${encodeURIComponent(wchin)}/wallet`, { domain: 'growth', title: 'Weight-for-age', value: '6.1 kg · on track' });
  assert(add.status === 201, `expected 201, got ${add.status}: ${JSON.stringify(add.body)}`);
  assert(add.body.domainLabel === 'Growth monitoring' && add.body.value === '6.1 kg · on track', 'the record carries a domain label and value');

  // An unrecognised domain is rejected.
  const bad = await jsonAs(staffToken, 'POST', `/api/children/${encodeURIComponent(wchin)}/wallet`, { domain: 'astrology', title: 'x', value: 'y' });
  assert(bad.status === 400, `an unknown domain must be rejected, got ${bad.status}`);

  // A verifier may not read or write the wallet (child record, staff/admin only).
  const vGet = await jsonAs(verifierToken, 'GET', `/api/children/${encodeURIComponent(wchin)}/wallet`);
  assert(vGet.status === 403, `a verifier must not read the wallet, got ${vGet.status}`);

  // The parent sees the wallet through their card (MyChild).
  const token = signChin(wchin);
  const fam = await json('GET', `/api/family/${encodeURIComponent(wchin)}?t=${encodeURIComponent(token)}`, undefined, { auth: false });
  assert(fam.status === 200 && Array.isArray(fam.body.healthRecords), 'the family view carries the health record');
  assert(fam.body.healthRecords.some((r: any) => r.domain === 'growth' && r.title === 'Weight-for-age'), 'the parent sees the growth record');

  await ChildModel.updateOne({ chin: wchin }, { completedAt: NOON });
});

test('§8 USSD: a basic-phone caregiver gets status, next vaccine and rewards by phone number', async () => {
  const phone = '+2348012349999';
  const cg = await json('POST', '/api/caregivers', { fullName: 'USSD Carer', phone });
  const dob = new Date(NOON.getTime() - 30 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Ussd Child', sex: 'female', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  assert(reg.status === 201, `expected child, got ${reg.status}`);

  // The USSD gateway posts to a public webhook; the phone number identifies the caller.
  const menu = await json('POST', '/webhooks/ussd', { phoneNumber: phone, text: '' }, { auth: false });
  assert(menu.status === 200, `expected 200, got ${menu.status}`);
  assert(typeof menu.body === 'string' && menu.body.startsWith('CON'), `main screen must keep the session open, got: ${menu.body}`);
  assert(/1\. Next vaccine/.test(menu.body) && /Ussd/.test(menu.body), `menu must name the child and options: ${menu.body}`);

  const next = await json('POST', '/webhooks/ussd', { phoneNumber: phone, text: '1' }, { auth: false });
  assert(next.body.startsWith('END'), 'the next-vaccine screen closes the session');
  assert(/Next for/.test(next.body) && /At /.test(next.body), `next vaccine screen must name the vaccine and facility: ${next.body}`);

  const rewards = await json('POST', '/webhooks/ussd', { phoneNumber: phone, text: '2' }, { auth: false });
  assert(rewards.body.startsWith('END') && /reward/i.test(rewards.body), `rewards screen wrong: ${rewards.body}`);

  const unknown = await json('POST', '/webhooks/ussd', { phoneNumber: '+2340000000000', text: '' }, { auth: false });
  assert(unknown.body.startsWith('END') && /No child is registered/.test(unknown.body), `unknown number must be told to register: ${unknown.body}`);

  // A wrong key shows the menu again instead of ending the call, and the next
  // key pressed after it still works.
  const wrong = await json('POST', '/webhooks/ussd', { phoneNumber: phone, text: '7' }, { auth: false });
  assert(wrong.body.startsWith('CON') && /Invalid choice/.test(wrong.body) && /1\. Next vaccine/.test(wrong.body), `a wrong key should re-show the menu: ${wrong.body}`);
  const recovered = await json('POST', '/webhooks/ussd', { phoneNumber: phone, text: '7*1' }, { auth: false });
  assert(recovered.body.startsWith('END') && /Next for/.test(recovered.body), `after a wrong key, 1 should still work: ${recovered.body}`);

  await ChildModel.updateOne({ chin: reg.body.chin }, { completedAt: NOON });
});

test('USSD recognises a caregiver whose number was registered in local format', async () => {
  // Registered as typed at the clinic; the network reports the international form.
  const dob = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Local Format Child', sex: 'male', dateOfBirth: dob, homeFacilityId: facilityAId,
    caregiver: { fullName: 'Local Format Carer', phone: '0803 555 0199' }
  });
  assert(reg.status === 201, `expected child, got ${reg.status}: ${JSON.stringify(reg.body)}`);
  const menu = await json('POST', '/webhooks/ussd', { phoneNumber: '+2348035550199', text: '' }, { auth: false });
  assert(menu.body.startsWith('CON') && /Local:/.test(menu.body), `the caregiver should be recognised: ${menu.body}`);
});

test('the family view carries the staged rewards and the next reward', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Reward Carer', phone: '+2348079998888' });
  const dob = new Date(NOON.getTime() - 40 * DAY).toISOString().slice(0, 10); // ~40-day-old
  const reg = await json('POST', '/api/children', {
    fullName: 'Reward Child', sex: 'male', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  const chinR = reg.body.chin;
  const token = signChin(chinR);
  const fam = await json('GET', `/api/family/${encodeURIComponent(chinR)}?t=${encodeURIComponent(token)}`, undefined, { auth: false });
  assert(fam.status === 200, `expected 200, got ${fam.status}`);
  assert(Array.isArray(fam.body.rewards) && fam.body.rewards.length === 3, 'family view must carry the 3 staged rewards');
  assert(fam.body.rewards.every((r: any) => r.title && r.reward && typeof r.attained === 'boolean'), 'each reward needs a title, reward and attained flag');
  assert('nextReward' in fam.body, 'family view must include the next reward (or null)');
  await ChildModel.updateOne({ chin: chinR }, { completedAt: NOON }); // keep out of later scans
});

test('recovery list returns the overdue children in scope, worst-first, staff/admin only', async () => {
  const fac = await dashFacility('Rec-State', 'RC-1', 'W', 'Recovery PHC');
  await dashChild(fac, [dashDose('OPV', 'OPV', 1, -25, false)]); // overdue ~25d
  await dashChild(fac, [dashDose('PENTA', 'Pentavalent', 1, -5, false)]); // overdue ~5d
  await dashChild(fac, [dashDose('BCG', 'BCG', 1, -60, true), dashDose('OPV', 'OPV', 1, -30, true)]); // complete → excluded

  const adminRes = await jsonAs(adminTokenT, 'GET', '/api/recovery?state=Rec-State');
  assert(adminRes.status === 200, `expected 200, got ${adminRes.status}`);
  assert(adminRes.body.count === 2, `expected 2 overdue children, got ${adminRes.body.count}`);
  assert(adminRes.body.children[0].mostOverdueDays >= adminRes.body.children[1].mostOverdueDays, 'recovery list must be worst-first');
  assert(adminRes.body.children[0].chin && adminRes.body.children[0].overdueVaccines.length > 0, 'each row carries a CHIN and overdue vaccines');
  const codes = adminRes.body.children[0].overdueCodes;
  assert(Array.isArray(codes) && codes.length > 0 && new Set(codes).size === codes.length, `overdueCodes should be distinct vaccine codes, got ${JSON.stringify(codes)}`);

  const staffRes = await jsonAs(staffToken, 'GET', '/api/recovery?state=Rec-State');
  assert(staffRes.status === 200, 'staff may view the recovery list');
  const verifierRes = await jsonAs(verifierToken, 'GET', '/api/recovery?state=Rec-State');
  assert(verifierRes.status === 403, `a verifier must not see the recovery list, got ${verifierRes.status}`);
});

// --- Offline-first sync (NCIHAP §9) ---

let syncFacId = '';
let syncChin = '';

test('sync setup: a facility with a registered child', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Sync Carer', phone: '+2348065555555' });
  const fac = await json('POST', '/api/facilities', { name: 'Sync PHC', lgaName: 'AMAC', stateName: 'FCT', lat: 9, lng: 7 });
  syncFacId = fac.body._id;
  const dob = new Date(NOON.getTime() - 120 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Sync Child', sex: 'male', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: syncFacId
  });
  assert(reg.status === 201, `expected 201, got ${reg.status}`);
  syncChin = reg.body.chin;
});

test('pull returns the facility children with doses and a server cursor', async () => {
  const { status, body } = await json('GET', `/api/sync/pull?facilityId=${syncFacId}`);
  assert(status === 200, `expected 200, got ${status}`);
  assert(typeof body.serverTime === 'string', 'pull must return a serverTime cursor');
  const mine = body.children.find((c: any) => c.chin === syncChin);
  assert(mine && Array.isArray(mine.doses) && mine.doses.length > 0, 'child snapshot must carry its doses for offline use');
});

test('an offline record_dose syncs and marks the dose administered', async () => {
  const body = {
    deviceId: 'device-1',
    transactions: [{
      clientTxId: 'tx-rec-1', type: 'record_dose',
      recordedAt: new Date(NOON.getTime() - 1 * DAY).toISOString(),
      payload: { chin: syncChin, vaccineCode: 'BCG', doseNumber: 1, facilityId: syncFacId }
    }]
  };
  const res = await json('POST', '/api/sync/push', body);
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(res.body.applied === 1 && res.body.results[0].result === 'applied', `expected applied, got ${JSON.stringify(res.body)}`);

  const child = await json('GET', `/api/children/${syncChin}`);
  const bcg = child.body.doses.find((d: any) => d.vaccineCode === 'BCG' && d.doseNumber === 1);
  assert(bcg.administeredDate, 'BCG should be administered after the sync');
});

test('re-pushing the same transaction is idempotent — no double-apply', async () => {
  const body = {
    deviceId: 'device-1',
    transactions: [{
      clientTxId: 'tx-rec-1', type: 'record_dose', recordedAt: new Date().toISOString(),
      payload: { chin: syncChin, vaccineCode: 'BCG', doseNumber: 1, facilityId: syncFacId }
    }]
  };
  const res = await json('POST', '/api/sync/push', body);
  assert(res.body.duplicate === 1, `expected duplicate 1, got ${JSON.stringify(res.body)}`);
  assert(res.body.applied === 0, 'a replay must not re-apply');
});

test('a conflicting offline record flags the child for reconciliation (GREY)', async () => {
  const otherFac = (await json('POST', '/api/facilities', { name: 'Other PHC', lgaName: 'AMAC', stateName: 'FCT', lat: 9, lng: 7 })).body._id;
  const body = {
    deviceId: 'device-2',
    transactions: [{
      clientTxId: 'tx-conflict-1', type: 'record_dose',
      recordedAt: new Date(NOON.getTime() - 2 * DAY).toISOString(), // earlier, different facility
      payload: { chin: syncChin, vaccineCode: 'BCG', doseNumber: 1, facilityId: otherFac }
    }]
  };
  const res = await json('POST', '/api/sync/push', body);
  assert(res.body.conflict === 1, `expected conflict 1, got ${JSON.stringify(res.body)}`);
  const child = await json('GET', `/api/children/${syncChin}`);
  assert(child.body.status === 'GREY', `expected GREY (reconciliation) after conflict, got ${child.body.status}`);
});

test('an offline home-birth registration creates a child and returns a CHIN', async () => {
  const dob = new Date(NOON.getTime() - 10 * DAY).toISOString().slice(0, 10);
  const body = {
    deviceId: 'device-3',
    transactions: [{
      clientTxId: 'tx-reg-1', type: 'register_child', recordedAt: new Date().toISOString(),
      payload: { fullName: 'Home Birth', sex: 'female', dateOfBirth: dob, homeFacilityId: syncFacId, caregiver: { fullName: 'Home Carer', phone: '+2348066666666' } }
    }]
  };
  const res = await json('POST', '/api/sync/push', body);
  assert(res.body.applied === 1, `expected applied 1, got ${JSON.stringify(res.body)}`);
  const newChin = res.body.results[0].chin;
  assert(newChin && isValidChinFormat(newChin), `expected a valid CHIN assigned, got ${newChin}`);
  const child = await json('GET', `/api/children/${encodeURIComponent(newChin)}`);
  assert(child.status === 200 && child.body.fullName === 'Home Birth', 'the registered child was not found');
});

test('a batch with one bad transaction still applies the good ones', async () => {
  const body = {
    deviceId: 'device-4',
    transactions: [
      { clientTxId: 'tx-good-1', type: 'record_dose', recordedAt: new Date().toISOString(), payload: { chin: syncChin, vaccineCode: 'OPV', doseNumber: 0, facilityId: syncFacId } },
      { clientTxId: 'tx-bad-1', type: 'record_dose', recordedAt: new Date().toISOString(), payload: { chin: syncChin } } // missing fields
    ]
  };
  const res = await json('POST', '/api/sync/push', body);
  assert(res.body.applied === 1 && res.body.error === 1, `expected 1 applied + 1 error, got ${JSON.stringify(res.body)}`);
});

test('sync requires a staff/admin token — a verifier is refused', async () => {
  const { status } = await jsonAs(verifierToken, 'GET', `/api/sync/pull?facilityId=${syncFacId}`);
  assert(status === 403, `expected 403 for a verifier, got ${status}`);
});

test('incremental pull with a cursor returns only what changed', async () => {
  const first = await json('GET', `/api/sync/pull?facilityId=${syncFacId}`);
  const cursor = first.body.serverTime;
  await new Promise((r) => setTimeout(r, 15));
  await json('POST', '/api/sync/push', {
    deviceId: 'device-5',
    transactions: [{ clientTxId: 'tx-inc-1', type: 'record_dose', recordedAt: new Date().toISOString(), payload: { chin: syncChin, vaccineCode: 'PCV', doseNumber: 1, facilityId: syncFacId } }]
  });
  const inc = await json('GET', `/api/sync/pull?facilityId=${syncFacId}&since=${encodeURIComponent(cursor)}`);
  assert(inc.body.children.some((c: any) => c.chin === syncChin), 'the changed child should appear in the incremental pull');
});

// --- Authorization: a child's record is care data, scoped to staff/admin and
// audited (NCIHAP §24). A verifier is refused the direct record and must use
// the role-scoped terminal instead. ---

let authzChin = '';

test('authz setup: register a child for the record-access checks', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Authz Carer', phone: '+2348070000000' });
  const dob = new Date(NOON.getTime() - 90 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Authz Child', sex: 'female', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  assert(reg.status === 201, `expected 201, got ${reg.status}: ${JSON.stringify(reg.body)}`);
  authzChin = reg.body.chin;
});

test('a verifier is DENIED the direct child record (must use the terminal)', async () => {
  const journey = await jsonAs(verifierToken, 'GET', `/api/children/${encodeURIComponent(authzChin)}/journey`);
  assert(journey.status === 403, `expected 403 for a verifier on /journey, got ${journey.status}`);
  const detail = await jsonAs(verifierToken, 'GET', `/api/children/${encodeURIComponent(authzChin)}`);
  assert(detail.status === 403, `expected 403 for a verifier on the record, got ${detail.status}`);
  const card = await jsonAs(verifierToken, 'GET', `/api/children/${encodeURIComponent(authzChin)}/card.svg`);
  assert(card.status === 403, `expected 403 for a verifier on the card, got ${card.status}`);
});

test('registration is staff/admin only — a verifier cannot register a child', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'X', phone: '+2348070000001' });
  const reg = await jsonAs(verifierToken, 'POST', '/api/children', {
    fullName: 'Nope', sex: 'male', dateOfBirth: '2026-06-01', caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  assert(reg.status === 403, `expected 403 for a verifier registering, got ${reg.status}`);
});

test('staff and admin may read the record', async () => {
  const s = await jsonAs(staffToken, 'GET', `/api/children/${encodeURIComponent(authzChin)}/journey`);
  assert(s.status === 200, `expected 200 for staff, got ${s.status}`);
  const a = await jsonAs(adminTokenT, 'GET', `/api/children/${encodeURIComponent(authzChin)}/journey`);
  assert(a.status === 200, `expected 200 for admin, got ${a.status}`);
});

test('every direct record access is audited — including the refused ones (§24)', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', `/api/children/${encodeURIComponent(authzChin)}/access-log`);
  assert(status === 200, `expected 200, got ${status}`);
  const apiRows = body.accesses.filter((r: any) => r.method === 'api');
  assert(apiRows.some((r: any) => r.accessorRole === 'verifier' && r.outcome === 'denied'), 'a denied verifier access must be on the audit trail');
  assert(apiRows.some((r: any) => r.accessorRole === 'staff' && r.outcome === 'ok'), 'a successful staff access must be on the audit trail');
});

// --- MyChild family endpoint: card-gated, returns the parent name, the flat
// per-dose list, and the assigned facility that the app's sub-views render. ---

test('the family endpoint returns the parent, the dose list, and the facility', async () => {
  const cg = await json('POST', '/api/caregivers', { fullName: 'Fatima Sani', phone: '+2348071112222' });
  const dob = new Date(NOON.getTime() - 200 * DAY).toISOString().slice(0, 10);
  const reg = await json('POST', '/api/children', {
    fullName: 'Family Child', sex: 'female', dateOfBirth: dob, caregiverId: cg.body._id, homeFacilityId: facilityAId
  });
  const famChin = reg.body.chin;

  const bad = await json('GET', `/api/family/${encodeURIComponent(famChin)}?t=wrongtoken`, undefined, { auth: false });
  assert(bad.status === 401, `family view must reject a bad card token, got ${bad.status}`);

  const token = signChin(famChin);
  const ok = await json('GET', `/api/family/${encodeURIComponent(famChin)}?t=${encodeURIComponent(token)}`, undefined, { auth: false });
  assert(ok.status === 200, `expected 200 with a valid card token, got ${ok.status}: ${JSON.stringify(ok.body)}`);
  assert(ok.body.parentName === 'Fatima Sani', `family view must carry the parent name, got ${ok.body.parentName}`);
  assert(Array.isArray(ok.body.doses) && ok.body.doses.length > 0, 'family view must carry the per-dose list');
  assert(ok.body.doses[0].state && ok.body.doses[0].vaccine, 'each dose needs a state and a vaccine name');
  assert(ok.body.facility && typeof ok.body.facility.name === 'string', 'family view must carry the assigned facility');

  await ChildModel.updateOne({ chin: famChin }, { completedAt: NOON }); // keep out of later scans
});

// --- Pre-launch hardening: security headers, body cap, login rate limit ---

test('every response carries the baseline security headers', async () => {
  const res = await fetch(`${baseUrl}/health`);
  assert(res.headers.get('content-security-policy')?.includes("default-src 'none'"), 'missing or weak CSP');
  assert(res.headers.get('x-content-type-options') === 'nosniff', 'missing nosniff');
  assert(res.headers.get('x-frame-options') === 'DENY', 'missing X-Frame-Options DENY');
  assert(res.headers.get('referrer-policy') === 'no-referrer', 'missing Referrer-Policy');
  assert(!res.headers.get('x-powered-by'), 'X-Powered-By must be removed');
});

test('an oversized JSON body is rejected with 413, not a 500', async () => {
  const big = JSON.stringify({ x: 'A'.repeat(70 * 1024) });
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: big });
  assert(res.status === 413, `expected 413 for an oversized body, got ${res.status}`);
});

test('malformed JSON is rejected with 400, not a 500', async () => {
  const res = await fetch(`${baseUrl}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{not valid json' });
  assert(res.status === 400, `expected 400 for malformed JSON, got ${res.status}`);
});

test('login is rate limited — repeated attempts eventually get 429 with Retry-After', async () => {
  let saw429 = false;
  let retryAfter: string | null = null;
  // The window is per-IP and shared with earlier login tests; 20 rapid tries
  // is comfortably past the limit of 10.
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'nobody', password: 'nope' })
    });
    if (res.status === 429) { saw429 = true; retryAfter = res.headers.get('retry-after'); break; }
  }
  assert(saw429, 'expected login to start returning 429 under repeated attempts');
  assert(retryAfter && Number(retryAfter) > 0, `429 must carry a positive Retry-After, got ${retryAfter}`);
});

async function main() {
  await connectDatabase();
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;

  let passed = 0;
  let failed = 0;

  for (const [name, fn] of suites) {
    try {
      await fn();
      console.log(`  ok  - ${name}`);
      passed++;
    } catch (error) {
      console.log(`  FAIL - ${name}`);
      console.log(`         ${(error as Error).message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed (${suites.length} total)`);

  server.close();
  await disconnectDatabase();
  process.exit(failed > 0 ? 1 : 0);
}

void main();
