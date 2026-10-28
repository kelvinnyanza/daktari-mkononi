import { BaseAi, JSON_ONLY_DIRECTIVE, type AiRequest, type AiResponse } from './port.js';

/** Every DevFakeAi reply starts with this — no one can mistake it for triage. */
export const DEV_FAKE_MARKER = '[JARIBIO]';

/** Patient turns after which the fake declares triage complete. */
export const DEV_FAKE_TURNS_TO_COMPLETE = 2;

/**
 * Dev-only stand-in so the screening flow can be clicked through locally with
 * no provider key (AI_PROVIDER=fake). Answers are canned, short, Swahili, and
 * marked [JARIBIO] ("test") so they can never pass for medical advice; the
 * production guard refuses to boot with it selected.
 *
 * Not the scripted FakeAi test double: this one needs no script. It tells the
 * structured triage check apart by the JSON-only directive BaseAi appends, and
 * answers it with a valid triageCheckSchema object — incomplete until the
 * patient has written DEV_FAKE_TURNS_TO_COMPLETE messages, then a
 * TELECONSULTATION/GENERAL_PRACTICE result so booking can be exercised too.
 *
 * The emergency keyword pre-screen, rate limits, caps and output gate all run
 * in ScreeningService before/after this, exactly as with a real provider.
 */
export class DevFakeAi extends BaseAi {
  readonly name = 'fake' as const;
  readonly model = 'dev-fake';

  complete(request: AiRequest): Promise<AiResponse> {
    const text = request.system.includes(JSON_ONLY_DIRECTIVE)
      ? JSON.stringify(this.triage(request))
      : `${DEV_FAKE_MARKER} Asante. Hili ni jibu la majaribio, si ushauri wa daktari. ` +
        'Dalili zilianza lini?';
    return Promise.resolve({
      text,
      stopReason: 'end_turn',
      // Small, non-zero usage so token accounting and admin/ai-usage move.
      usage: { inputTokens: 10, outputTokens: 10 },
    });
  }

  private triage(request: AiRequest): Record<string, unknown> {
    // The triage check sends the transcript as one block of "PATIENT: …" lines.
    const transcript = request.messages[0]?.content ?? '';
    const patientTurns = transcript.split('\n').filter((line) => line.startsWith('PATIENT:')).length;
    const rationale = `${DEV_FAKE_MARKER} Matokeo ya majaribio — si tathmini ya kitabibu.`;
    if (patientTurns < DEV_FAKE_TURNS_TO_COMPLETE) {
      return { triageComplete: false, urgencyScore: 3, confidence: 0.1, rationale };
    }
    return {
      triageComplete: true,
      triageLevel: 'TELECONSULTATION',
      urgencyScore: 4,
      suggestedSpecialty: 'GENERAL_PRACTICE',
      confidence: 0.1,
      rationale,
    };
  }
}
