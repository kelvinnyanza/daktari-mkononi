import type { Role } from '@daktari/auth';

/** Attached to authenticated requests by the authenticate middleware. */
export interface AuthContext {
  userId: string;
  role: Role;
  sessionId: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** Mark a route as reading PHI so the audit hook logs GETs too. */
    audit?: 'phi-read';
  }
}
