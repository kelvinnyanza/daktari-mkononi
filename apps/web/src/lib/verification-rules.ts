/**
 * Client-side mirror of the server's verification decision rules.
 *
 * The server is still the authority — every rule here is enforced again in
 * `doctor.service.ts` (`REQUIRED_DOCUMENTS_NOT_APPROVED`, the claim check, the
 * Zod `notes` refinement). Duplicating them buys the reviewer an explanation
 * *before* they click, instead of a 409 after. Kept pure and separate from the
 * React tree so the rules can be unit-tested directly.
 */
import type { DoctorDocumentField } from '@daktari/schemas';

export const REQUIRED_DOCUMENT_FIELDS: readonly DoctorDocumentField[] = [
  'tmc_cert',
  'degree',
  'id',
];

export type DocumentReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface ReviewDocument {
  document: DoctorDocumentField | null;
  reviewStatus: string;
}

export interface DecisionContext {
  verificationStatus: string;
  /** Who currently holds the review, per the server. */
  claimedByUserId: string | null;
  /** The signed-in admin. */
  adminUserId: string;
  documents: ReviewDocument[];
  /** Local (not yet submitted) per-document decisions. */
  pendingReviews: Partial<Record<DoctorDocumentField, DocumentReviewStatus>>;
  rejectionNotes: string;
}

/** Blocking reasons, as translation keys, in the order they should be shown. */
export type BlockReason =
  | 'verification.blockedNotClaimed'
  | 'verification.blockedDocuments'
  | 'verification.blockedReason';

export interface DecisionAvailability {
  canApprove: boolean;
  canReject: boolean;
  /** Why approve is blocked (first blocking rule), or null when it is allowed. */
  approveBlockedBy: BlockReason | null;
  rejectBlockedBy: BlockReason | null;
  /** Required documents not yet approved — surfaced next to the block reason. */
  unapprovedRequired: DoctorDocumentField[];
}

/** The effective status of a document: a local decision overrides the server's. */
export function effectiveStatus(
  document: DoctorDocumentField,
  context: Pick<DecisionContext, 'documents' | 'pendingReviews'>,
): DocumentReviewStatus {
  const local = context.pendingReviews[document];
  if (local !== undefined) return local;
  const stored = context.documents.find((entry) => entry.document === document);
  if (stored === undefined) return 'PENDING';
  return stored.reviewStatus === 'APPROVED' || stored.reviewStatus === 'REJECTED'
    ? stored.reviewStatus
    : 'PENDING';
}

/** True when this admin holds the review (the server's claim guard). */
export function isClaimedByMe(context: Pick<DecisionContext, 'claimedByUserId' | 'adminUserId'>): boolean {
  return context.claimedByUserId !== null && context.claimedByUserId === context.adminUserId;
}

export function evaluateDecision(context: DecisionContext): DecisionAvailability {
  const claimed = isClaimedByMe(context);
  const unapprovedRequired = REQUIRED_DOCUMENT_FIELDS.filter(
    (field) => effectiveStatus(field, context) !== 'APPROVED',
  );
  // The server's Zod refinement: a rejection carries notes of >= 10 chars.
  const notesOk = context.rejectionNotes.trim().length >= 10;

  const approveBlockedBy: BlockReason | null = !claimed
    ? 'verification.blockedNotClaimed'
    : unapprovedRequired.length > 0
      ? 'verification.blockedDocuments'
      : null;

  const rejectBlockedBy: BlockReason | null = !claimed
    ? 'verification.blockedNotClaimed'
    : !notesOk
      ? 'verification.blockedReason'
      : null;

  return {
    canApprove: approveBlockedBy === null,
    canReject: rejectBlockedBy === null,
    approveBlockedBy,
    rejectBlockedBy,
    unapprovedRequired,
  };
}
