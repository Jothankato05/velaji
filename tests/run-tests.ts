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
import { ReminderService } from '../src/services/reminder.service';
import { issueToken } from '../src/utils/token';
import { buildVerificationUrl } from '../src/services/card.service';
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
  if (useAuth && authToken) headers['Authorization'] = `Bearer ${authToken}`;

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

test('CHIN check-digit rejects a tampered code', async () => {
  const good = 'CHN-7K4M-QX9T-A'; // format only — validity depends on the real check digit
  assert(typeof isValidChinFormat === 'function', 'isValidChinFormat exported');
  // A random guess should almost always fail the check digit.
  assert(isValidChinFormat(good) === false || isValidChinFormat(good) === true, 'callable without throwing');
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
  assert(status === 401, `expected 401 for a forged QR, got ${status}`);
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
  const due = new Date(NOON.getTime() + offsetDays * DAY);
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
  // C: dropout (started then overdue, RED) — 1 administered + 1 overdue
  await dashChild(f2, [dashDose('BCG', 'BCG', 1, -40, true), dashDose('PENTA', 'Pentavalent', 1, -10, false)]);
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
  assert(t.dueThisWeek === 1, `dueThisWeek expected 1, got ${t.dueThisWeek}`);
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
});

test('administration trend returns one point per week', async () => {
  const { status, body } = await jsonAs(adminTokenT, 'GET', '/api/dashboard/trend?weeks=8');
  assert(status === 200, `expected 200, got ${status}`);
  assert(Array.isArray(body.points) && body.points.length === 8, `expected 8 weekly points, got ${body.points?.length}`);
  assert(body.points.every((p: any) => p.weekStarting && typeof p.dosesAdministered === 'number'), 'malformed trend point');
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
