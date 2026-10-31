import { createKeepAwakeController, type KeepAwakeConditions } from './keep-awake';

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const ALL: KeepAwakeConditions = { focused: true, foreground: true, inCall: true };

function setup(activate: () => Promise<void> = async () => undefined) {
  const deps = {
    activate: jest.fn(activate),
    deactivate: jest.fn(async () => undefined),
    log: jest.fn(),
  };
  return { deps, controller: createKeepAwakeController(deps) };
}

describe('call keep-awake controller', () => {
  it('activates only when focused AND foreground AND in a call — once', () => {
    const { deps, controller } = setup();
    controller.update({ ...ALL, foreground: false });
    controller.update({ ...ALL, focused: false });
    controller.update({ ...ALL, inCall: false });
    expect(deps.activate).not.toHaveBeenCalled();
    controller.update(ALL);
    controller.update(ALL); // re-render: no second activation
    expect(deps.activate).toHaveBeenCalledTimes(1);
  });

  it('deactivates when the app goes to the background, re-activates on return', () => {
    const { deps, controller } = setup();
    controller.update(ALL);
    controller.update({ ...ALL, foreground: false });
    expect(deps.deactivate).toHaveBeenCalledTimes(1);
    controller.update(ALL);
    expect(deps.activate).toHaveBeenCalledTimes(2);
  });

  it('"Unable to activate keep awake" is caught and logged, never thrown, and retried later', async () => {
    const { deps, controller } = setup(() => Promise.reject(new Error('Unable to activate keep awake')));
    expect(() => controller.update(ALL)).not.toThrow();
    await flush();
    expect(deps.log).toHaveBeenCalledWith('keep-awake: activate failed', expect.any(Error));
    controller.update({ ...ALL, foreground: false });
    expect(deps.deactivate).not.toHaveBeenCalled(); // nothing was held
    controller.update(ALL);
    expect(deps.activate).toHaveBeenCalledTimes(2); // retried on return to foreground
  });

  it('leaving the call screen releases it; releasing twice is a no-op', () => {
    const { deps, controller } = setup();
    controller.update(ALL);
    controller.release();
    controller.release();
    expect(deps.deactivate).toHaveBeenCalledTimes(1);
  });
});
