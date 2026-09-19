export type PickingStatus = 'OPEN' | 'PICKING' | 'COMPLETED' | 'CANCELLED';
const transitions: Record<PickingStatus, readonly PickingStatus[]> = {
  OPEN: ['PICKING', 'CANCELLED'],
  PICKING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};
export function canTransitionPicking(from: PickingStatus, to: PickingStatus): boolean {
  return transitions[from].includes(to);
}
export function remainingToPick(required: number, picked: number): number {
  return Math.max(0, required - picked);
}
