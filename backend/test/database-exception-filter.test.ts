import { describe, expect, it, vi } from 'vitest';
import { DatabaseExceptionFilter } from '../src/http/database-exception.filter.js';

function harness() {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as never;
  return { host, status, json };
}

describe('database exception filter', () => {
  it('maps duplicate serial/SKU/barcode constraints to conflict without leaking SQL', () => {
    const test = harness();
    new DatabaseExceptionFilter().catch(
      { code: '23505', constraint: 'serial_items_org_serial_key' },
      test.host,
    );
    expect(test.status).toHaveBeenCalledWith(409);
    expect(test.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNIQUE_CONSTRAINT' }));
  });
  it('maps malformed UUID and check violations to a safe bad request', () => {
    const test = harness();
    new DatabaseExceptionFilter().catch(
      { code: '22P02', detail: 'sensitive SQL detail' },
      test.host,
    );
    expect(test.status).toHaveBeenCalledWith(400);
    expect(JSON.stringify(test.json.mock.calls)).not.toContain('sensitive SQL detail');
  });
});
