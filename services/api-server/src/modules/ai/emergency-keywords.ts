/**
 * Emergency keyword pre-screen — REVIEWABLE CONSTANTS.
 *
 * Checked BEFORE any model call on every patient message. A match short-
 * circuits the session: immediate EMERGENCY triage, 112/115 guidance, no
 * tokens spent. Clinical reviewers: keep phrases lowercase; single words are
 * matched on word boundaries, multi-word phrases as substrings.
 */
export interface EmergencyKeyword {
  /** Lowercase phrase to match. */
  phrase: string;
  /** Why it is on the list — shown in audit metadata, never to the patient. */
  category:
    | 'CHEST_PAIN'
    | 'BREATHING'
    | 'BLEEDING'
    | 'UNCONSCIOUS'
    | 'POISONING'
    | 'SEIZURE'
    | 'LABOR'
    | 'SUICIDE';
}

export const EMERGENCY_KEYWORDS: readonly EmergencyKeyword[] = [
  // Chest pain
  { phrase: 'chest pain', category: 'CHEST_PAIN' },
  { phrase: 'maumivu ya kifua', category: 'CHEST_PAIN' },
  { phrase: 'kifua kinauma', category: 'CHEST_PAIN' },
  // Breathing
  { phrase: "can't breathe", category: 'BREATHING' },
  { phrase: 'cannot breathe', category: 'BREATHING' },
  { phrase: 'difficulty breathing', category: 'BREATHING' },
  { phrase: 'kushindwa kupumua', category: 'BREATHING' },
  { phrase: 'siwezi kupumua', category: 'BREATHING' },
  { phrase: 'anashindwa kupumua', category: 'BREATHING' },
  // Heavy bleeding
  { phrase: 'heavy bleeding', category: 'BLEEDING' },
  { phrase: 'bleeding a lot', category: 'BLEEDING' },
  { phrase: 'kutokwa damu nyingi', category: 'BLEEDING' },
  { phrase: 'anatokwa damu nyingi', category: 'BLEEDING' },
  // Unconscious
  { phrase: 'unconscious', category: 'UNCONSCIOUS' },
  { phrase: 'amepoteza fahamu', category: 'UNCONSCIOUS' },
  { phrase: 'kupoteza fahamu', category: 'UNCONSCIOUS' },
  { phrase: 'amezimia', category: 'UNCONSCIOUS' },
  // Poisoning
  { phrase: 'poisoning', category: 'POISONING' },
  { phrase: 'poisoned', category: 'POISONING' },
  { phrase: 'amekunywa sumu', category: 'POISONING' },
  { phrase: 'kunywa sumu', category: 'POISONING' },
  { phrase: 'sumu', category: 'POISONING' },
  // Seizure
  { phrase: 'seizure', category: 'SEIZURE' },
  { phrase: 'convulsions', category: 'SEIZURE' },
  { phrase: 'degedege', category: 'SEIZURE' },
  { phrase: 'kifafa', category: 'SEIZURE' },
  // Labor complications
  { phrase: 'labor complications', category: 'LABOR' },
  { phrase: 'labour complications', category: 'LABOR' },
  { phrase: 'matatizo ya kujifungua', category: 'LABOR' },
  { phrase: 'uchungu wa kujifungua', category: 'LABOR' },
  // Suicidal intent
  { phrase: 'suicide', category: 'SUICIDE' },
  { phrase: 'suicidal', category: 'SUICIDE' },
  { phrase: 'kill myself', category: 'SUICIDE' },
  { phrase: 'end my life', category: 'SUICIDE' },
  { phrase: 'kujiua', category: 'SUICIDE' },
  { phrase: 'nataka kujiua', category: 'SUICIDE' },
  { phrase: 'kujidhuru', category: 'SUICIDE' },
] as const;

/** Single words match on word boundaries; phrases match as substrings. */
export function matchEmergencyKeyword(message: string): EmergencyKeyword | null {
  const normalized = ` ${message.toLowerCase().replace(/\s+/g, ' ').trim()} `;
  for (const keyword of EMERGENCY_KEYWORDS) {
    if (keyword.phrase.includes(' ')) {
      if (normalized.includes(keyword.phrase)) return keyword;
    } else if (new RegExp(`(^|[^a-z])${keyword.phrase}([^a-z]|$)`).test(normalized)) {
      return keyword;
    }
  }
  return null;
}
