export type ReceiptStatus = 'DRAFT' | 'RECEIVING' | 'CONFIRMED' | 'CANCELLED';

const transitions: Record<ReceiptStatus, readonly ReceiptStatus[]> = {
  DRAFT: ['RECEIVING', 'CANCELLED'],
  RECEIVING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: [],
  CANCELLED: [],
};

export function canTransitionReceipt(from: ReceiptStatus, to: ReceiptStatus): boolean {
  return transitions[from].includes(to);
}

export function receiptVariance(expected: number, actual: number): 'SHORT' | 'MATCH' | 'OVER' {
  if (actual < expected) return 'SHORT';
  if (actual > expected) return 'OVER';
  return 'MATCH';
}
