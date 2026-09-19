export type TripStatus =
  | 'DRAFT'
  | 'READY_TO_LOAD'
  | 'LOADING'
  | 'LOADED'
  | 'DEPARTED'
  | 'IN_PROGRESS'
  | 'RETURNING'
  | 'RECONCILING'
  | 'RECONCILIATION_REQUIRED'
  | 'COMPLETED'
  | 'COMPLETED_WITH_EXCEPTION';

const transitions: Partial<Record<TripStatus, TripStatus[]>> = {
  DRAFT: ['READY_TO_LOAD'],
  READY_TO_LOAD: ['LOADING'],
  LOADING: ['LOADED'],
  LOADED: ['DEPARTED'],
  DEPARTED: ['IN_PROGRESS', 'RETURNING'],
  IN_PROGRESS: ['RETURNING'],
  RETURNING: ['RECONCILING'],
  RECONCILING: ['COMPLETED', 'COMPLETED_WITH_EXCEPTION', 'RECONCILIATION_REQUIRED'],
  RECONCILIATION_REQUIRED: ['COMPLETED_WITH_EXCEPTION'],
};

export function canTransitionTrip(from: TripStatus, to: TripStatus): boolean {
  return transitions[from]?.includes(to) ?? false;
}

export function remainingQuantity(planned: number, delivered: number, returned: number): number {
  return Math.max(0, planned - delivered - returned);
}
