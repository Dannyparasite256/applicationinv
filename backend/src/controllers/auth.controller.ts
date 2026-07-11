import { Request, Response } from 'express';
import * as authService from '../services/auth.service';
import { success, created } from '../utils/response';
import { asyncHandler } from '../utils/asyncHandler';

export const register = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.registerCompany(req.body);
  return created(res, result, 'Company registered successfully');
});

export const login = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.login({
    ...req.body,
    ip: req.ip,
    userAgent: req.get('user-agent') || undefined,
  });
  return success(res, result, 'Login successful');
});

export const refresh = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.refreshTokens(req.body.refreshToken);
  return success(res, result, 'Token refreshed');
});

export const logout = asyncHandler(async (req: Request, res: Response) => {
  await authService.logout(req.body.refreshToken, req.user?.id);
  return success(res, null, 'Logged out');
});

export const logoutAll = asyncHandler(async (req: Request, res: Response) => {
  await authService.logoutAll(req.user!.id);
  return success(res, null, 'Logged out from all sessions');
});

export const forgotPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.forgotPassword(req.body.email);
  return success(res, result);
});

export const resetPassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.resetPassword({
    token: req.body.token,
    email: req.body.email,
    code: req.body.code,
    password: req.body.password,
  });
  return success(res, result, result.message || 'Password reset successful');
});

export const verifyEmail = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.verifyEmail(req.body.token);
  return success(res, result);
});

export const me = asyncHandler(async (req: Request, res: Response) => {
  const profile = await authService.getProfile(req.user!.id);
  return success(res, profile);
});

export const changePassword = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.changePassword(
    req.user!.id,
    req.body.currentPassword,
    req.body.newPassword
  );
  return success(res, result);
});

export const setup2FA = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.setup2FA(req.user!.id);
  return success(res, result);
});

export const enable2FA = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.enable2FA(req.user!.id, req.body.code);
  return success(res, result);
});

export const disable2FA = asyncHandler(async (req: Request, res: Response) => {
  const result = await authService.disable2FA(req.user!.id, req.body.code);
  return success(res, result);
});

export const sessions = asyncHandler(async (req: Request, res: Response) => {
  const data = await authService.listSessions(req.user!.id);
  return success(res, data);
});

export const loginHistory = asyncHandler(async (req: Request, res: Response) => {
  const data = await authService.listLoginHistory(req.user!.id);
  return success(res, data);
});

export const devices = asyncHandler(async (req: Request, res: Response) => {
  const data = await authService.listDevices(req.user!.id);
  return success(res, data);
});
