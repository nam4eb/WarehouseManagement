'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Failure, Loading, Status } from '@/components/data-state';
import { api } from '@/lib/api';

type Warehouse = { id: string; code: string; name: string };
type Location = { id: string; warehouse_id: string; code: string; name: string; tracks_balance: boolean };
type CountSummary = { id: string; warehouse_code: string; location_code: string; status: string; recount_number: number; line_count: number; counted_count: number; pending_adjustments: number };
type CountLine = { id: string; product_id: string; sku: string; name: string; counted_quantity: string | null; expected_quantity: string | null; variance: string | null; adjustment_id?: string; adjustment_status?: string };
type CountDetail = CountSummary & { lines: CountLine[] };

export default function CountsPage() {
  const [counts, setCounts] = useState<CountSummary[]>();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [selected, setSelected] = useState<CountDetail>();
  const [warehouseId, setWarehouseId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    const [nextCounts, nextWarehouses, nextLocations] = await Promise.all([api<CountSummary[]>('/inventory/counts'), api<Warehouse[]>('/warehouses'), api<Location[]>('/locations')]);
    setCounts(nextCounts); setWarehouses(nextWarehouses); setLocations(nextLocations.filter((location) => location.tracks_balance));
    if (!warehouseId && nextWarehouses[0]) setWarehouseId(nextWarehouses[0].id);
  }, [warehouseId]);
  useEffect(() => { load().catch((e: Error) => setError(e.message)); }, [load]);
  const open = async (id: string) => { setError(''); setSelected(await api<CountDetail>(`/inventory/counts/${id}`)); };
  const action = async (path: string) => {
    setBusy(true); setError('');
    try { await api(path, { method: 'POST', body: '{}' }); await load(); if (selected) await open(selected.id); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const create = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try { const result = await api<CountDetail>('/inventory/counts', { method: 'POST', body: JSON.stringify({ warehouseId, locationId }) }); setSelected(result); await load(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  const record = async (line: CountLine, quantity: number) => {
    if (!selected) return;
    setSelected(await api<CountDetail>(`/inventory/counts/${selected.id}/lines`, { method: 'POST', body: JSON.stringify({ productId: line.product_id, countedQuantity: quantity }) }));
  };
  if (!counts && !error) return <Loading />;
  const availableLocations = locations.filter((location) => location.warehouse_id === warehouseId);
  return <>
    <div className="page-head"><div><div className="eyebrow">INVENTORY GOVERNANCE</div><h1>Kiểm kê mù</h1><p>Người đếm không thấy tồn hệ thống; mọi chênh lệch cần người khác phê duyệt.</p></div></div>
    {error && <Failure message={error} />}
    <section className="panel count-create"><div><h2>Tạo phiên kiểm kê</h2><p>Chụp snapshot tồn hiện tại tại một vị trí.</p></div><form onSubmit={create}>
      <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setLocationId(''); }}>{warehouses.map((w) => <option value={w.id} key={w.id}>{w.code} — {w.name}</option>)}</select>
      <select required value={locationId} onChange={(e) => setLocationId(e.target.value)}><option value="">Chọn vị trí</option>{availableLocations.map((l) => <option value={l.id} key={l.id}>{l.code} — {l.name}</option>)}</select>
      <button disabled={busy || !locationId}>Tạo kiểm kê</button>
    </form></section>
    <section className="panel table-wrap"><table><thead><tr><th>Vị trí</th><th>Tiến độ</th><th>Recount</th><th>Chờ duyệt</th><th>Trạng thái</th></tr></thead><tbody>{counts?.map((c) => <tr key={c.id} onClick={() => open(c.id)} className="clickable-row"><td><strong>{c.warehouse_code}</strong><small className="subline">{c.location_code}</small></td><td>{c.counted_count}/{c.line_count}</td><td>{c.recount_number}</td><td>{c.pending_adjustments}</td><td><Status value={c.status} /></td></tr>)}</tbody></table></section>
    {selected && <section className="panel count-detail"><div className="panel-title"><div><h2>{selected.location_code}</h2><p>Phiên {selected.id.slice(0, 8)} · lần đếm {selected.recount_number + 1}</p></div><Status value={selected.status} /></div>
      <div className="count-actions">{['DRAFT', 'RECOUNT_REQUIRED'].includes(selected.status) && <button disabled={busy} onClick={() => action(`/inventory/counts/${selected.id}/start`)}>Bắt đầu đếm</button>}{selected.status === 'IN_PROGRESS' && <button disabled={busy || selected.lines.some((line) => line.counted_quantity === null)} onClick={() => action(`/inventory/counts/${selected.id}/submit`)}>Gửi đối chiếu</button>}{selected.status === 'SUBMITTED' && <button className="secondary" disabled={busy} onClick={() => action(`/inventory/counts/${selected.id}/recount`)}>Yêu cầu đếm lại</button>}</div>
      <div className="count-lines">{selected.lines.map((line) => <article key={line.id}><div><strong>{line.sku}</strong><span>{line.name}</span></div>{selected.status === 'IN_PROGRESS' ? <input type="number" min="0" step="0.001" defaultValue={line.counted_quantity ?? ''} placeholder="SL thực đếm" onBlur={(e) => e.target.value && record(line, Number(e.target.value)).catch((err: Error) => setError(err.message))} /> : <div className="count-result"><span>Đếm: {line.counted_quantity ?? '—'}</span>{line.expected_quantity !== null && <span>Hệ thống: {line.expected_quantity} · Lệch: {line.variance}</span>}{line.adjustment_id && line.adjustment_status === 'PENDING_APPROVAL' && <button disabled={busy} onClick={() => action(`/inventory/counts/adjustments/${line.adjustment_id}/approve`)}>Duyệt điều chỉnh</button>}</div>}</article>)}</div>
    </section>}
  </>;
}
