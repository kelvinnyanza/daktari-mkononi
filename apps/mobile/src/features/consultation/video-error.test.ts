import { classifyJoinError } from './video-error';

describe('classifyJoinError', () => {
  it('a Daily account/room error is NOT a permission problem — shows the code', () => {
    expect(classifyJoinError({ action: 'error', errorMsg: 'account-missing-payment-method' })).toEqual({
      kind: 'failed',
      detail: 'account-missing-payment-method',
    });
    expect(classifyJoinError(new Error('exp-token'))).toEqual({ kind: 'failed', detail: 'exp-token' });
  });

  it('real permission denials still get the settings screen', () => {
    expect(classifyJoinError({ errorMsg: 'NotAllowedError: Permission denied' })).toEqual({ kind: 'permission' });
    expect(classifyJoinError({ error: { type: 'permissions', msg: 'blocked' } })).toEqual({ kind: 'permission' });
  });

  it('camera busy is not a permission problem', () => {
    expect(classifyJoinError({ errorMsg: 'cam-in-use', error: { type: 'cam-in-use' } })).toEqual({
      kind: 'failed',
      detail: 'cam-in-use',
    });
  });

  it('unknown shapes fail with no detail', () => {
    expect(classifyJoinError(undefined)).toEqual({ kind: 'failed', detail: null });
    expect(classifyJoinError({})).toEqual({ kind: 'failed', detail: null });
  });
});
