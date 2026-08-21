/**
 * One-off CLI to create a staff login. There is no public registration
 * endpoint on purpose — new accounts on a health system should be created
 * deliberately, not self-served.
 *
 * Usage:
 *   npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [role]
 */
import { connectDatabase, disconnectDatabase } from '../config/db';
import { StaffUserModel } from '../models/StaffUser';
import { hashPassword } from '../utils/password';

async function main() {
  const [username, password, fullName, role] = process.argv.slice(2);
  if (!username || !password || !fullName) {
    console.error('Usage: npx tsx src/scripts/createStaffUser.ts <username> <password> "<Full Name>" [staff|admin]');
    process.exit(1);
  }

  await connectDatabase();

  const passwordHash = await hashPassword(password);
  const user = await StaffUserModel.findOneAndUpdate(
    { username: username.toLowerCase().trim() },
    { username: username.toLowerCase().trim(), passwordHash, fullName, role: role === 'admin' ? 'admin' : 'staff' },
    { upsert: true, returnDocument: 'after' }
  );

  console.log(`Created/updated staff user: ${user.username} (${user.role})`);
  await disconnectDatabase();
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
