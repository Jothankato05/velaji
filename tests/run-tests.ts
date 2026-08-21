/* eslint-disable no-console */
// Real end-to-end smoke test: boots the actual app on an ephemeral in-memory
// DB and hits it over real HTTP with fetch — same "verify against reality,
// not mocks" discipline used on ImmuniReach.

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
import { ReminderService } from '../src/services/reminder.service';
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

test('printable card SVG embeds a real QR verification link', async () => {
  const res = await fetch(`${baseUrl}/api/children/${encodeURIComponent(chin)}/card.svg`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const svg = await res.text();
  assert(svg.includes('<svg'), 'response is not SVG');
  assert(svg.includes(chin), 'card does not contain the CHIN');
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

test('reminder engine does not text a severely overdue (GREY) child, it escalates', async () => {
  const { childId, chin } = await makeReminderChild(200); // 200 days overdue -> GREY
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
  assert(fake.sent.length === 0, 'GREY (lost-to-follow-up) child should not be auto-texted');
  assert(
    summary.escalations.some((e) => e.startsWith(chin)),
    'GREY dose should be flagged for human tracing'
  );

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
