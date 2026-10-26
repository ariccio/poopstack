import type { Register } from 'claude-code';

// The scaffold the repository's gates run against (milestone M1). It changes nothing:
// its one hook passes `session.start` on unchanged. The features arrive in M2.
export const register: Register = (on) => {
  on('session.start', (_$, e, next) => next(e)).catch((_$, e, next) => next(e));
};
