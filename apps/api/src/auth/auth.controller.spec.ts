import { AuthController } from './auth.controller';

describe('AuthController native mobile sessions', () => {
  const auth = {
    register: jest.fn(),
    login: jest.fn(),
    refresh: jest.fn(),
    logout: jest.fn(),
    issueAuthenticatedSession: jest.fn(),
  };
  const accountSecurity = { requestEmailVerification: jest.fn() };
  const mfa = { verifyLoginChallenge: jest.fn() };
  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(auth as any, accountSecurity as any, mfa as any);
  });

  it('creates a native account and requests email verification', async () => {
    auth.register.mockResolvedValue({ verificationRequired: true, user: { id: 'user-1' } });
    accountSecurity.requestEmailVerification.mockResolvedValue({ success: true });
    const result = await controller.mobileRegister({ email: 'listener@example.com' } as any);
    expect(result.verificationRequired).toBe(true);
    expect(accountSecurity.requestEmailVerification).toHaveBeenCalledWith('listener@example.com');
  });

  it('returns a rotating refresh credential to a native client after login', async () => {
    const session = { accessToken: 'access', refreshToken: 'refresh', user: { id: 'user-1' } };
    auth.login.mockResolvedValue(session);
    await expect(controller.mobileLogin({ email: 'listener@example.com', password: 'secret' } as any)).resolves.toBe(session);
  });

  it('rotates the supplied native refresh credential', async () => {
    const session = { accessToken: 'next-access', refreshToken: 'next-refresh' };
    auth.refresh.mockResolvedValue(session);
    await expect(controller.mobileRefresh({ refreshToken: 'old-refresh' } as any)).resolves.toBe(session);
    expect(auth.refresh).toHaveBeenCalledWith('old-refresh');
  });

  it('revokes the supplied native refresh credential on logout', async () => {
    auth.logout.mockResolvedValue({ success: true });
    await expect(controller.mobileLogout({ refreshToken: 'refresh' } as any)).resolves.toEqual({ success: true });
    expect(auth.logout).toHaveBeenCalledWith('refresh');
  });

  it('issues a native session after MFA verification', async () => {
    const user = { id: 'user-1', email: 'listener@example.com', displayName: 'Listener', role: 'USER' };
    const session = { accessToken: 'access', refreshToken: 'refresh', user };
    mfa.verifyLoginChallenge.mockResolvedValue(user);
    auth.issueAuthenticatedSession.mockResolvedValue(session);
    await expect(controller.mobileMfaChallenge({ token: 'challenge', code: '123456' } as any)).resolves.toBe(session);
    expect(mfa.verifyLoginChallenge).toHaveBeenCalledWith('challenge', '123456');
  });
});
