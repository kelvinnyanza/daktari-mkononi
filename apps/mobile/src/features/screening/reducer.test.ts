import {
  initialScreeningState,
  screeningReducer,
  type ScreeningState,
} from './reducer';

const started = (): ScreeningState =>
  screeningReducer(initialScreeningState, {
    type: 'STARTED',
    sessionId: 's1',
    opening: 'Karibu! Piga 112 au 115 kama ni dharura.',
  });

describe('screening reducer', () => {
  it('start renders the canned opener immediately', () => {
    const state = started();
    expect(state.phase).toBe('active');
    expect(state.messages).toEqual([
      { role: 'assistant', content: 'Karibu! Piga 112 au 115 kama ni dharura.' },
    ]);
  });

  it('SEND disables input (sending) and blocks double-send', () => {
    const sending = screeningReducer(started(), { type: 'SEND', message: 'Nina homa' });
    expect(sending.phase).toBe('sending');
    expect(sending.messages.at(-1)).toEqual({ role: 'user', content: 'Nina homa' });

    // A second SEND while in flight is ignored entirely.
    const doubled = screeningReducer(sending, { type: 'SEND', message: 'Nina homa tena' });
    expect(doubled).toBe(sending);
  });

  it('ACTIVE reply appends the assistant bubble and re-enables input', () => {
    const sending = screeningReducer(started(), { type: 'SEND', message: 'Nina homa' });
    const replied = screeningReducer(sending, {
      type: 'REPLY',
      reply: 'Pole! Homa imeanza lini?',
      status: 'ACTIVE',
    });
    expect(replied.phase).toBe('active');
    expect(replied.messages.at(-1)).toEqual({ role: 'assistant', content: 'Pole! Homa imeanza lini?' });
  });

  it('COMPLETED + EMERGENCY branches into the full-screen emergency layout', () => {
    const sending = screeningReducer(started(), { type: 'SEND', message: 'maumivu ya kifua' });
    const emergency = screeningReducer(sending, {
      type: 'REPLY',
      reply: 'Piga 112 au 115 SASA HIVI.',
      status: 'COMPLETED',
      triage: { triageLevel: 'EMERGENCY', urgencyScore: 10, recommendedSpecialty: null },
    });
    expect(emergency.phase).toBe('emergency');
    expect(emergency.triage?.triageLevel).toBe('EMERGENCY');
    expect(emergency.suggestedDoctors).toEqual([]); // emergency layout offers no other actions
  });

  it('COMPLETED + TELECONSULTATION shows the triage card and suggested doctors', () => {
    const sending = screeningReducer(started(), { type: 'SEND', message: 'Homa siku tatu' });
    const completed = screeningReducer(sending, {
      type: 'REPLY',
      reply: 'Ninapendekeza uongee na daktari.',
      status: 'COMPLETED',
      triage: { triageLevel: 'TELECONSULTATION', urgencyScore: 5, recommendedSpecialty: 'GENERAL_PRACTICE' },
      suggestedDoctors: [
        { id: 'd1', fullName: 'Dr Neema', specialty: 'GENERAL_PRACTICE', consultationFeeTzs: 25_000, averageRating: 4.8 },
      ],
    });
    expect(completed.phase).toBe('completed');
    expect(completed.suggestedDoctors).toHaveLength(1);
  });

  it('FAIL keeps the session active and stores the server message VERBATIM (429 guidance intact)', () => {
    const verbatim =
      'Maombi mengi mno — jaribu tena baadaye. Kama ni dharura, piga 112 au 115 sasa hivi.';
    const sending = screeningReducer(started(), { type: 'SEND', message: 'Nina swali' });
    const failed = screeningReducer(sending, { type: 'FAIL', message: verbatim });
    expect(failed.phase).toBe('active'); // input re-enabled
    expect(failed.error).toBe(verbatim); // no paraphrasing
    expect(failed.messages.at(-1)).toEqual({ role: 'user', content: 'Nina swali' }); // bubble kept
  });

  it('session expiry offers a fresh session; RESET returns to idle', () => {
    const expired = screeningReducer(started(), { type: 'SESSION_EXPIRED' });
    expect(expired.phase).toBe('expired');
    expect(screeningReducer(expired, { type: 'RESET' })).toEqual(initialScreeningState);
  });

  it('RESUMED restores a decrypted transcript into an active chat', () => {
    const resumed = screeningReducer(initialScreeningState, {
      type: 'RESUMED',
      sessionId: 's2',
      messages: [
        { role: 'assistant', content: 'Karibu!' },
        { role: 'user', content: 'Nina kikohozi' },
        { role: 'assistant', content: 'Tangu lini?' },
      ],
    });
    expect(resumed.phase).toBe('active');
    expect(resumed.sessionId).toBe('s2');
    expect(resumed.messages).toHaveLength(3);
  });
});
