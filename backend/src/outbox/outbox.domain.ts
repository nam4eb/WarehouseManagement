export function retryDelaySeconds(attempt: number): number {
  return Math.min(300, 2 ** Math.max(1, attempt));
}

export function shouldDeadLetter(attempt: number): boolean {
  return attempt >= 10;
}
