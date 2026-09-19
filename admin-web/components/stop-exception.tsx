'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

const reasons = [
  ['CUSTOMER_ABSENT', 'Khách hàng vắng mặt'],
  ['CUSTOMER_REJECTED', 'Khách từ chối nhận'],
  ['DAMAGED', 'Hàng hư hỏng'],
  ['SHORT_SHIPMENT', 'Thiếu hàng'],
  ['ACCESS_BLOCKED', 'Không thể tiếp cận'],
  ['OTHER', 'Lý do khác'],
] as const;

export function StopException({
  tripId,
  customerLocationId,
  onSaved,
}: {
  tripId: string;
  customerLocationId: string;
  onSaved: () => Promise<void>;
}) {
  const [reasonCode, setReasonCode] = useState('CUSTOMER_ABSENT');
  const [affectedQuantity, setAffectedQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function save() {
    if (!navigator.onLine) return setMessage('Ghi nhận ngoại lệ cần kết nối mạng.');
    if (notes.trim().length < 5) return setMessage('Mô tả lý do ít nhất 5 ký tự.');
    setBusy(true);
    try {
      await api(`/trips/${tripId}/stops/${customerLocationId}/exception`, {
        method: 'POST',
        body: JSON.stringify({ reasonCode, affectedQuantity, notes: notes.trim() }),
      });
      setMessage('Đã ghi nhận ngoại lệ điểm giao.');
      await onSaved();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stop-outcome-form">
      <label>Lý do giao thiếu / không giao được</label>
      <select value={reasonCode} onChange={(event) => setReasonCode(event.target.value)}>
        {reasons.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="0.001"
        step="0.001"
        value={affectedQuantity}
        onChange={(event) => setAffectedQuantity(Number(event.target.value))}
      />
      <textarea
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Mô tả tình huống"
      />
      {message && <small>{message}</small>}
      <button disabled={busy || affectedQuantity <= 0} onClick={() => void save()}>
        {busy ? 'Đang lưu…' : 'Lưu ngoại lệ'}
      </button>
    </div>
  );
}
