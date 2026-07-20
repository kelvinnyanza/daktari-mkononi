import type { SmsPort } from './port.js';

/**
 * Dev implementation: prints the full message (including any OTP) straight to
 * stdout — deliberately NOT through pino, whose redaction would (correctly)
 * strip the code developers need to complete local flows. Structured logs
 * only ever see the recipient count, never the body.
 */
export class ConsoleSms implements SmsPort {
  sendSms(to: string, body: string): Promise<void> {
    process.stdout.write(`\n[SMS → ${to}] ${body}\n\n`);
    return Promise.resolve();
  }
}
