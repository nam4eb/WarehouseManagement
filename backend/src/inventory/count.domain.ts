export type CountStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'RECOUNT_REQUIRED'
  | 'APPROVED'
  | 'ADJUSTED'
  | 'CANCELLED';

const transitions: Record<CountStatus, CountStatus[]> = {
  DRAFT: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['SUBMITTED', 'CANCELLED'],
  SUBMITTED: ['RECOUNT_REQUIRED', 'APPROVED'],
  RECOUNT_REQUIRED: ['IN_PROGRESS', 'CANCELLED'],
  APPROVED: ['ADJUSTED'],
  ADJUSTED: [],
  CANCELLED: [],
};

export function canTransitionCount(from: CountStatus, to: CountStatus) {
  return transitions[from].includes(to);
}

export function variance(expected: number, counted: number) {
  if (expected < 0 || counted < 0 || !Number.isFinite(expected) || !Number.isFinite(counted))
    throw new Error('INVALID_COUNT_QUANTITY');
  return counted - expected;
}

export function assertMakerChecker(createdBy: string, approverId: string) {
  if (createdBy === approverId) throw new Error('MAKER_CANNOT_APPROVE_OWN_ADJUSTMENT');
}

