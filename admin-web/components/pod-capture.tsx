'use client';

import { PointerEvent, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

type UploadTicket = { objectKey: string; uploadUrl: string };

async function upload(tripId: string, file: File): Promise<string> {
  const ticket = await api<UploadTicket>(`/trips/${tripId}/proof-upload-url`, {
    method: 'POST',
    body: JSON.stringify({ fileName: file.name, contentType: file.type }),
  });
  const response = await fetch(ticket.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok) throw new Error(`Không thể tải bằng chứng lên kho tệp (${response.status}).`);
  return ticket.objectKey;
}

export function PodCapture({
  tripId,
  customerLocationId,
  onSaved,
}: {
  tripId: string;
  customerLocationId: string;
  onSaved: () => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signed = useRef(false);
  const [recipientName, setRecipientName] = useState('');
  const [notes, setNotes] = useState('');
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = width * ratio;
    canvas.height = 170 * ratio;
    const context = canvas.getContext('2d');
    if (context) {
      context.scale(ratio, ratio);
      context.lineWidth = 3;
      context.lineCap = 'round';
      context.strokeStyle = '#13231f';
    }
  }, []);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    drawing.current = true;
    signed.current = true;
    canvasRef.current?.setPointerCapture(event.pointerId);
    const current = point(event);
    context.beginPath();
    context.moveTo(current.x, current.y);
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvasRef.current?.getContext('2d');
    if (!context) return;
    const current = point(event);
    context.lineTo(current.x, current.y);
    context.stroke();
  }

  function clearSignature() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (canvas && context) context.clearRect(0, 0, canvas.width, canvas.height);
    signed.current = false;
  }

  async function signatureFile(): Promise<File | undefined> {
    if (!signed.current || !canvasRef.current) return undefined;
    const blob = await new Promise<Blob | null>((resolve) =>
      canvasRef.current!.toBlob(resolve, 'image/png'),
    );
    return blob
      ? new File([blob], `signature-${Date.now()}.png`, { type: 'image/png' })
      : undefined;
  }

  async function save() {
    if (!navigator.onLine) {
      setMessage('POD cần kết nối mạng để tải ảnh và chữ ký.');
      return;
    }
    if (!recipientName.trim()) {
      setMessage('Nhập tên người nhận.');
      return;
    }
    const signature = await signatureFile();
    if (!signature && photos.length === 0) {
      setMessage('Cần chữ ký hoặc ít nhất một ảnh giao hàng.');
      return;
    }
    setBusy(true);
    setMessage('Đang tải bằng chứng…');
    try {
      const signatureObjectKey = signature ? await upload(tripId, signature) : undefined;
      const photoObjectKeys = await Promise.all(photos.map((photo) => upload(tripId, photo)));
      await api(`/trips/${tripId}/proof`, {
        method: 'POST',
        body: JSON.stringify({
          recipientName: recipientName.trim(),
          customerLocationId,
          signatureObjectKey,
          photoObjectKeys,
          notes: notes.trim() || undefined,
          deliveredAt: new Date().toISOString(),
        }),
      });
      setMessage('Đã lưu bằng chứng giao hàng.');
      await onSaved();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="driver-card pod-card">
      <h2>Bằng chứng giao hàng</h2>
      <label htmlFor="recipientName">Người nhận</label>
      <input
        id="recipientName"
        value={recipientName}
        onChange={(event) => setRecipientName(event.target.value)}
        placeholder="Họ tên người nhận"
      />
      <label htmlFor="podPhotos">Ảnh giao hàng</label>
      <input
        id="podPhotos"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture="environment"
        multiple
        onChange={(event) => setPhotos(Array.from(event.target.files ?? []).slice(0, 5))}
      />
      <small>{photos.length}/5 ảnh đã chọn</small>
      <div className="signature-label">
        <label>Chữ ký người nhận</label>
        <button type="button" onClick={clearSignature}>
          Xóa chữ ký
        </button>
      </div>
      <canvas
        ref={canvasRef}
        className="signature-pad"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={() => (drawing.current = false)}
        onPointerCancel={() => (drawing.current = false)}
      />
      <label htmlFor="podNotes">Ghi chú</label>
      <textarea
        id="podNotes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        placeholder="Tình trạng giao nhận (không bắt buộc)"
      />
      {message && <div className="driver-message">{message}</div>}
      <button type="button" className="pod-submit" disabled={busy} onClick={() => void save()}>
        {busy ? 'Đang lưu…' : 'Hoàn tất POD'}
      </button>
    </section>
  );
}
