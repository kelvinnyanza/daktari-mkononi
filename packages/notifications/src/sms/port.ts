/** Outbound SMS port. Implementations must never log message bodies through pino. */
export interface SmsPort {
  /**
   * Send an SMS.
   * @param to   normalized +255XXXXXXXXX number
   * @param body message text (may contain OTP codes — treat as sensitive)
   */
  sendSms(to: string, body: string): Promise<void>;
}
