import type { SmsPort } from './port.js';

/** Thrown when the gateway is used without credentials (e.g. placeholder env). */
export class SmsNotConfiguredError extends Error {
  readonly code = 'NOT_CONFIGURED';
  constructor() {
    super("Africa's Talking SMS gateway is not configured (missing apiKey/username)");
    this.name = 'SmsNotConfiguredError';
  }
}

export interface AfricasTalkingConfig {
  apiKey: string;
  username: string;
  senderId: string;
}

const PLACEHOLDER = /^(your-|change-?me|sandbox-key)/i;

/**
 * Africa's Talking SMS gateway (production). Typed stub for Phase 3: the
 * request shape is real, but delivery reporting, retries, and queueing land
 * with the notification service in a later phase.
 */
export class AfricasTalkingSms implements SmsPort {
  constructor(private readonly config: AfricasTalkingConfig) {}

  private isConfigured(): boolean {
    return (
      this.config.apiKey.length > 0 &&
      this.config.username.length > 0 &&
      !PLACEHOLDER.test(this.config.apiKey)
    );
  }

  async sendSms(to: string, body: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new SmsNotConfiguredError();
    }
    const response = await fetch('https://api.africastalking.com/version1/messaging', {
      method: 'POST',
      headers: {
        apiKey: this.config.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams({
        username: this.config.username,
        to,
        message: body,
        from: this.config.senderId,
      }),
    });
    if (!response.ok) {
      // Never include the body (may contain an OTP) in the error.
      throw new Error(`SMS gateway responded ${response.status} for ${to}`);
    }
  }
}
