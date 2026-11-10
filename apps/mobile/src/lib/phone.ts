/**
 * Phone field helpers: the field shows a fixed "+255" prefix and the patient
 * types the 9 local digits. Whatever they type or paste — "0712 345 678",
 * "712345678", "+255 712 345 678", "255712345678" — is reduced to those 9
 * digits; the server's tzPhoneSchema still validates the result.
 */

/** Up to 9 local digits from any typed/pasted form (country code / trunk 0 removed). */
export function localDigits(input: string): string {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('255') && digits.length > 9) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return digits.slice(0, 9);
}

/** "712345678" → "712 345 678" (groups of three while typing). */
export function formatLocal(digits: string): string {
  return digits.replace(/(\d{3})(?=\d)/g, '$1 ');
}

/** Local digits → the +255 form the API expects ("" stays "" so "required" errors stay clear). */
export function toE164(digits: string): string {
  return digits === '' ? '' : `+255${digits}`;
}

/** Inverse for prefilling: "+255712345678" → "712345678". */
export function fromE164(phone: string | null | undefined): string {
  return phone === null || phone === undefined ? '' : localDigits(phone);
}
