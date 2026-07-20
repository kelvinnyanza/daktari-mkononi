/**
 * Output gate — REVIEWABLE CONSTANTS.
 *
 * Crude regex backstop that runs over EVERY assistant reply before it is
 * returned: if the model slipped a medication-dosage pattern past the system
 * prompt, the reply is replaced with a safe fallback and a
 * SCREENING_OUTPUT_BLOCKED audit event is written.
 */

const DOSAGE_PATTERNS: readonly RegExp[] = [
  // "500 mg", "5 ml", "2 g", "10 mcg", "2.5mg"
  /\d+(?:\.\d+)?\s*(?:mg|mcg|ml|g)\b/i,
  // "2 tablets", "vidonge 2", "3 capsules", "kidonge kimoja"
  /\d+\s*(?:tablets?|capsules?|pills?|vidonge)/i,
  /(?:vidonge|kidonge)\s*\d+/i,
  // "mara 3 kwa siku" (3 times a day), "mara mbili kwa siku"
  /mara\s+(?:\d+|moja|mbili|tatu|nne)\s+kwa\s+siku/i,
  // "3 times a day", "twice per day"
  /\d+\s+times?\s+(?:a|per)\s+day/i,
  /(?:once|twice)\s+(?:a|per)\s+day/i,
];

/** True when the text contains a medication-dosage pattern. */
export function containsDosagePattern(text: string): boolean {
  return DOSAGE_PATTERNS.some((pattern) => pattern.test(text));
}
