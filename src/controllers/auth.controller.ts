import type { Request, Response } from 'express';
import { StaffUserModel } from '../models/StaffUser';
import { verifyPassword } from '../utils/password';
import { issueToken, type StaffRole } from '../utils/token';
import { AppError } from '../utils/AppError';
import { exchangePrimersCode, readPrimersInput } from '../utils/primersId';

export async function login(req: Request, res: Response) {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    throw new AppError('username and password are required');
  }

  const user = await StaffUserModel.findOne({ username: String(username).toLowerCase().trim() }).select(
    '+passwordHash +primersIdSub'
  );
  // Same generic error whether the username doesn't exist or the password is
  // wrong — don't hand an attacker a username-enumeration oracle.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('Invalid username or password', 401);
  }

  const token = issueToken({ id: String(user._id), username: user.username, role: user.role as StaffRole });
  res.json({
    token,
    user: { id: user._id, username: user.username, fullName: user.fullName, role: user.role, primersIdLinked: Boolean(user.primersIdSub) }
  });
}

/** Sign in with a Primers ID that its owner has already connected to their staff account. */
export async function loginWithPrimers(req: Request, res: Response) {
  const who = await exchangePrimersCode(readPrimersInput(req.body));
  const user = await StaffUserModel.findOne({ primersIdSub: who.sub });
  if (!user) {
    throw new AppError(
      "This Primers ID isn't connected to a Velaji staff account yet. Sign in with your username and password, then choose Connect Primers ID in the menu.",
      401
    );
  }
  const token = issueToken({ id: String(user._id), username: user.username, role: user.role as StaffRole });
  res.json({
    token,
    user: { id: user._id, username: user.username, fullName: user.fullName, role: user.role, primersIdLinked: true }
  });
}

/** Connect the signed-in staff member's Primers ID. */
export async function linkPrimers(req: Request, res: Response) {
  const who = await exchangePrimersCode(readPrimersInput(req.body));
  const me = req.user?.sub;
  if (!me) throw new AppError('Not authenticated', 401);
  const other = await StaffUserModel.findOne({ primersIdSub: who.sub }).select('_id');
  if (other && String(other._id) !== String(me)) {
    throw new AppError('That Primers ID is already connected to another Velaji staff account.', 409);
  }
  const updated = await StaffUserModel.findByIdAndUpdate(me, { $set: { primersIdSub: who.sub } }, { new: true });
  if (!updated) throw new AppError('Staff account not found', 404);
  res.json({ user: { id: updated._id, username: updated.username, fullName: updated.fullName, role: updated.role, primersIdLinked: true } });
}

export async function me(req: Request, res: Response) {
  res.json({ user: req.user });
}
