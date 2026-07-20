import { describe, expect, it } from 'vitest';
import {
  effectiveStatus,
  evaluateDecision,
  isClaimedByMe,
  type DecisionContext,
} from './verification-rules';

const ADMIN = 'admin-1';

function context(overrides: Partial<DecisionContext> = {}): DecisionContext {
  return {
    verificationStatus: 'UNDER_REVIEW',
    claimedByUserId: ADMIN,
    adminUserId: ADMIN,
    documents: [
      { document: 'tmc_cert', reviewStatus: 'APPROVED' },
      { document: 'degree', reviewStatus: 'APPROVED' },
      { document: 'id', reviewStatus: 'APPROVED' },
    ],
    pendingReviews: {},
    rejectionNotes: '',
    ...overrides,
  };
}

describe('isClaimedByMe', () => {
  it('is false when nobody has claimed the review', () => {
    expect(isClaimedByMe({ claimedByUserId: null, adminUserId: ADMIN })).toBe(false);
  });

  it('is false when another admin holds it', () => {
    expect(isClaimedByMe({ claimedByUserId: 'admin-2', adminUserId: ADMIN })).toBe(false);
  });

  it('is true only for the holder', () => {
    expect(isClaimedByMe({ claimedByUserId: ADMIN, adminUserId: ADMIN })).toBe(true);
  });
});

describe('effectiveStatus', () => {
  it('falls back to PENDING for a document that was never uploaded', () => {
    expect(effectiveStatus('police_clearance', context())).toBe('PENDING');
  });

  it('reads the stored review when there is no local decision', () => {
    expect(effectiveStatus('tmc_cert', context())).toBe('APPROVED');
  });

  it('lets an unsaved local decision override the stored one', () => {
    const state = context({ pendingReviews: { tmc_cert: 'REJECTED' } });
    expect(effectiveStatus('tmc_cert', state)).toBe('REJECTED');
  });
});

describe('evaluateDecision', () => {
  it('blocks everything until the review is claimed', () => {
    const result = evaluateDecision(
      context({ claimedByUserId: null, rejectionNotes: 'a reason long enough' }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.canReject).toBe(false);
    expect(result.approveBlockedBy).toBe('verification.blockedNotClaimed');
    expect(result.rejectBlockedBy).toBe('verification.blockedNotClaimed');
  });

  it('blocks approval while a required document is unapproved', () => {
    const result = evaluateDecision(
      context({
        documents: [
          { document: 'tmc_cert', reviewStatus: 'APPROVED' },
          { document: 'degree', reviewStatus: 'PENDING' },
          { document: 'id', reviewStatus: 'APPROVED' },
        ],
      }),
    );
    expect(result.canApprove).toBe(false);
    expect(result.approveBlockedBy).toBe('verification.blockedDocuments');
    expect(result.unapprovedRequired).toEqual(['degree']);
  });

  it('does not require the optional police clearance', () => {
    // police_clearance is explicitly optional in the server's REQUIRED list.
    const result = evaluateDecision(context());
    expect(result.canApprove).toBe(true);
    expect(result.unapprovedRequired).toEqual([]);
  });

  it('counts unsaved local approvals toward the requirement', () => {
    const result = evaluateDecision(
      context({
        documents: [
          { document: 'tmc_cert', reviewStatus: 'APPROVED' },
          { document: 'degree', reviewStatus: 'PENDING' },
          { document: 'id', reviewStatus: 'APPROVED' },
        ],
        pendingReviews: { degree: 'APPROVED' },
      }),
    );
    expect(result.canApprove).toBe(true);
  });

  it('blocks approval when a required document is locally rejected', () => {
    const result = evaluateDecision(context({ pendingReviews: { id: 'REJECTED' } }));
    expect(result.canApprove).toBe(false);
    expect(result.unapprovedRequired).toEqual(['id']);
  });

  it('requires a rejection reason of at least 10 characters', () => {
    expect(evaluateDecision(context({ rejectionNotes: 'too short' })).canReject).toBe(false);
    expect(evaluateDecision(context({ rejectionNotes: '   short   ' })).canReject).toBe(false);
    expect(evaluateDecision(context({ rejectionNotes: 'TMC number does not match' })).canReject).toBe(
      true,
    );
  });

  it('allows rejection even when documents are unapproved', () => {
    // Unapproved documents are precisely why a rejection happens.
    const result = evaluateDecision(
      context({
        documents: [{ document: 'tmc_cert', reviewStatus: 'PENDING' }],
        rejectionNotes: 'Certificate is illegible, please re-upload',
      }),
    );
    expect(result.canReject).toBe(true);
    expect(result.canApprove).toBe(false);
  });
});
