/**
 * One-off CLI to create a staff login. There is no public registration
 * endpoint on purpose — new accounts on a health system should be created
 * deliberately, not self-served.
 *
 * Usage:
 *   npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [verifier|staff|admin]
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { StaffUserModel } from '../models/StaffUser';
import { hashPassword } from '../utils/password';
import type { StaffRole } from '../utils/token';

const ROLES: StaffRole[] = ['verifier', 'staff', 'admin'];

async function main() {
  const [username, password, fullName, roleArg] = process.argv.slice(2);
  if (!username || !password || !fullName) {
    console.error('Usage: npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [verifier|staff|admin]');
    process.exit(1);
  }
  const role: StaffRole = ROLES.includes(roleArg as StaffRole) ? (roleArg as StaffRole) : 'staff';

  await connectDatabase();

  const passwordHash = await hashPassword(password);
  const user = await StaffUserModel.findOneAndUpdate(
    { username: username.toLowerCase().trim() },
    { username: username.toLowerCase().trim(), passwordHash, fullName, role },
    { upsert: true, returnDocument: 'after' }
  );

  console.log(`Created/updated staff user: ${user.username} (${user.role})`);
  await disconnectDatabase();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
