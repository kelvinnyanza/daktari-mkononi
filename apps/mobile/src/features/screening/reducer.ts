/**
 * Screening chat state machine — pure and fully testable. The SERVER drives
 * all triage logic; this reducer only renders responses and reacts to status.
 */

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface TriageResult {
  triageLevel: 'SELF_CARE' | 'TELECONSULTATION' | 'IN_PERSON_VISIT' | 'EMERGENCY';
  urgencyScore: number | null;
  recommendedSpecialty: string | null;
}

export interface SuggestedDoctor {
  id: string;
  fullName: string;
  specialty: string;
  consultationFeeTzs: number;
  averageRating: number;
}

export type ScreeningPhase =
  | 'idle' // nothing yet — show start button
  | 'starting'
  | 'active' // conversation ongoing, input enabled
  | 'sending' // request in flight, input disabled
  | 'emergency' // COMPLETED + EMERGENCY → full-screen 112/115 layout
  | 'completed' // COMPLETED, non-emergency → triage card + doctors
  | 'expired'; // session expired → offer a fresh session

export interface ScreeningState {
  phase: ScreeningPhase;
  sessionId: string | null;
  messages: ChatMessage[];
  triage: TriageResult | null;
  suggestedDoctors: SuggestedDoctor[];
  /** Rendered VERBATIM (e.g. the 429 carries the emergency guidance). */
  error: string | null;
}

export const initialScreeningState: ScreeningState = {
  phase: 'idle',
  sessionId: null,
  messages: [],
  triage: null,
  suggestedDoctors: [],
  error: null,
};

export type ScreeningAction =
  | { type: 'START_REQUESTED' }
  | { type: 'STARTED'; sessionId: string; opening: string }
  | { type: 'RESUMED'; sessionId: string; messages: ChatMessage[] }
  | { type: 'SEND'; message: string }
  | {
      type: 'REPLY';
      reply: string;
      status: 'ACTIVE' | 'COMPLETED';
      triage?: TriageResult | undefined;
      suggestedDoctors?: SuggestedDoctor[] | undefined;
    }
  | { type: 'FAIL'; message: string }
  | { type: 'SESSION_EXPIRED' }
  | { type: 'RESET' };

export function screeningReducer(state: ScreeningState, action: ScreeningAction): ScreeningState {
  switch (action.type) {
    case 'START_REQUESTED':
      return { ...initialScreeningState, phase: 'starting' };
    case 'STARTED':
      return {
        ...initialScreeningState,
        phase: 'active',
        sessionId: action.sessionId,
        messages: [{ role: 'assistant', content: action.opening }],
      };
    case 'RESUMED':
      return {
        ...initialScreeningState,
        phase: 'active',
        sessionId: action.sessionId,
        messages: action.messages,
      };
    case 'SEND':
      if (state.phase !== 'active') return state; // no double-send
      return {
        ...state,
        phase: 'sending',
        error: null,
        messages: [...state.messages, { role: 'user', content: action.message }],
      };
    case 'REPLY': {
      const messages = [...state.messages, { role: 'assistant' as const, content: action.reply }];
      if (action.status === 'COMPLETED') {
        const emergency = action.triage?.triageLevel === 'EMERGENCY';
        return {
          ...state,
          phase: emergency ? 'emergency' : 'completed',
          messages,
          triage: action.triage ?? null,
          suggestedDoctors: action.suggestedDoctors ?? [],
        };
      }
      return { ...state, phase: 'active', messages };
    }
    case 'FAIL':
      // The failed user message stays visible; input re-enables; the server's
      // message (bilingual, verbatim — incl. 429 emergency guidance) shows.
      return { ...state, phase: state.sessionId === null ? 'idle' : 'active', error: action.message };
    case 'SESSION_EXPIRED':
      return { ...state, phase: 'expired', error: null };
    case 'RESET':
      return initialScreeningState;
    default:
      return state;
  }
}
