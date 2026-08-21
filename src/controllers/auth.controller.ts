import type { Request, Response } from 'express';
import { StaffUserModel } from '../models/StaffUser';
import { verifyPassword } from '../utils/password';
import { issueToken } from '../utils/token';
import { AppError } from '../utils/AppError';

export async function login(req: Request, res: Response) {
  const { username, password } = req.body ?? {};
  if (!username || !password) {
    throw new AppError('username and password are required');
  }

  const user = await StaffUserModel.findOne({ username: String(username).toLowerCase().trim() }).select(
    '+passwordHash'
  );
  // Same generic error whether the username doesn't exist or the password is
  // wrong — don't hand an attacker a username-enumeration oracle.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new AppError('Invalid username or password', 401);
  }

  const token = issueToken({ id: String(user._id), username: user.username, role: user.role as 'staff' | 'admin' });
  res.json({
    token,
    user: { id: user._id, username: user.username, fullName: user.fullName, role: user.role }
  });
}

export async function me(req: Request, res: Response) {
  res.json({ user: req.user });
}
