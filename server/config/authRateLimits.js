const minute = 60_000;
const hour = 60 * minute;

export const AUTH_RATE_LIMITS = Object.freeze({
  storage: Object.freeze({ maximumKeys: 20_000 }),
  login: Object.freeze({
    ipShort: Object.freeze({ limit: 30, windowMs: 5 * minute }),
    ipLong: Object.freeze({ limit: 200, windowMs: hour }),
    identifierFailures: Object.freeze({ limit: 5, windowMs: 15 * minute }),
  }),
  context: Object.freeze({
    ip: Object.freeze({ limit: 20, windowMs: 5 * minute }),
    challengeFailures: Object.freeze({ limit: 5, windowMs: 5 * minute }),
  }),
  passwordChange: Object.freeze({
    ip: Object.freeze({ limit: 10, windowMs: 10 * minute }),
    challenge: Object.freeze({ limit: 5, windowMs: 10 * minute }),
  }),
  invitationInspection: Object.freeze({
    ip: Object.freeze({ limit: 60, windowMs: minute }),
  }),
  invitationAcceptance: Object.freeze({
    ip: Object.freeze({ limit: 10, windowMs: 15 * minute }),
    token: Object.freeze({ limit: 5, windowMs: 15 * minute }),
  }),
  invitationAdministration: Object.freeze({
    actor: Object.freeze({ limit: 10, windowMs: hour }),
    hotelEmail: Object.freeze({ limit: 5, windowMs: hour }),
  }),
  companyPasswordReset: Object.freeze({
    actor: Object.freeze({ limit: 10, windowMs: hour }),
    target: Object.freeze({ limit: 3, windowMs: hour }),
  }),
});
