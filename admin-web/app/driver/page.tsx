'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { PodCapture } from '@/components/pod-capture';
import { StopException } from '@/components/stop-exception';
import { api } from '@/lib/api';

type Line = {
  id: string;
  productId: string;
  sku: string;
  productName: string;
  customerLocationId: string;
  customerName: string;
  planned: number;
  loaded: number;
  delivered: number;
  returned: number;
};
type Trip = {
  id: string;
  trip_code: string;
  status: string;
  service_date: string;
  registration?: string;
  stops?: Stop[];
  lines: Line[];
};
type Stop = {
  customerLocationId: string;
  sequence: number;
  name: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  proof?: { id: string; recipientName: string; deliveredAt: string };
  exception?: { id: string; reasonCode: string; affectedQuantity: number; notes: string };
};
type Location = { id: string; type: string; code: string; name: string };
type QueuedCommand = {
  id: string;
  tripId: string;
  action: 'load' | 'deliver' | 'return';
  body: {
    lineId: string;
    quantity: number;
    clientOccurredAt: string;
    serialItemId?: string;
    returnLocationId?: string;
  };
  createdAt: string;
};
type ScanResult = { product_id: string; serial_item_id?: string };

const QUEUE_KEY = 'wms_driver_queue_v1';
const TRIPS_KEY = 'wms_driver_trips_v1';
const LOCATIONS_KEY = 'wms_driver_locations_v1';

function readJson<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? '') as T;
  } catch {
    return fallback;
  }
}

export default function DriverPage() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [tripId, setTripId] = useState('');
  const [locations, setLocations] = useState<Location[]>([]);
  const [queue, setQueue] = useState<QueuedCommand[]>([]);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [scan, setScan] = useState('');
  const [selectedLineId, setSelectedLineId] = useState('');
  const [serialItemId, setSerialItemId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [returnLocationId, setReturnLocationId] = useState('');
  const [activeOutcome, setActiveOutcome] = useState<{
    stopId: string;
    type: 'pod' | 'exception';
  }>();

  const selectedTrip = useMemo(() => trips.find((trip) => trip.id === tripId), [trips, tripId]);
  const selectedLine = selectedTrip?.lines.find((line) => line.id === selectedLineId);
  const returnLocations = locations.filter((location) => location.type === 'RETURN_QUARANTINE');

  const persistQueue = useCallback((next: QueuedCommand[]) => {
    setQueue(next);
    localStorage.setItem(QUEUE_KEY, JSON.stringify(next));
  }, []);

  const loadData = useCallback(async () => {
    try {
      const [nextTrips, nextLocations] = await Promise.all([
        api<Trip[]>('/trips'),
        api<Location[]>('/locations'),
      ]);
      setTrips(nextTrips);
      setLocations(nextLocations);
      localStorage.setItem(TRIPS_KEY, JSON.stringify(nextTrips));
      localStorage.setItem(LOCATIONS_KEY, JSON.stringify(nextLocations));
      setTripId((current) => current || nextTrips[0]?.id || '');
    } catch (error) {
      const cached = readJson<Trip[]>(TRIPS_KEY, []);
      setTrips(cached);
      setLocations(readJson<Location[]>(LOCATIONS_KEY, []));
      setTripId((current) => current || cached[0]?.id || '');
      if (navigator.onLine) setMessage((error as Error).message);
    }
  }, []);

  const syncQueue = useCallback(async () => {
    const pending = readJson<QueuedCommand[]>(QUEUE_KEY, []);
    if (!navigator.onLine || pending.length === 0) return;
    setBusy(true);
    const failed: QueuedCommand[] = [];
    let sent = 0;
    for (const command of pending) {
      try {
        await api(`/trips/${command.tripId}/${command.action}`, {
          method: 'POST',
          headers: { 'Idempotency-Key': command.id },
          body: JSON.stringify(command.body),
        });
        sent += 1;
      } catch {
        failed.push(command);
      }
    }
    persistQueue(failed);
    setMessage(
      failed.length
        ? `Đã đồng bộ ${sent}, còn ${failed.length} lệnh cần xử lý.`
        : `Đã đồng bộ ${sent} lệnh.`,
    );
    setBusy(false);
    await loadData();
  }, [loadData, persistQueue]);

  useEffect(() => {
    setOnline(navigator.onLine);
    setQueue(readJson<QueuedCommand[]>(QUEUE_KEY, []));
    void loadData();
    const handleOnline = () => {
      setOnline(true);
      void syncQueue();
    };
    const handleOffline = () => setOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [loadData, syncQueue]);

  async function resolveScan(event: FormEvent) {
    event.preventDefault();
    if (!scan.trim() || !selectedTrip) return;
    setMessage('');
    const cachedLine = selectedTrip.lines.find((item) => item.sku === scan.trim());
    if (!navigator.onLine && cachedLine) {
      setSelectedLineId(cachedLine.id);
      setSerialItemId('');
      setMessage(`Đã nhận diện ngoại tuyến ${cachedLine.sku} — ${cachedLine.productName}`);
      setScan('');
      return;
    }
    try {
      const result = await api<ScanResult>('/scan/resolve', {
        method: 'POST',
        body: JSON.stringify({ code: scan.trim() }),
      });
      const line = selectedTrip.lines.find((item) => item.productId === result.product_id);
      if (!line) throw new Error('Mã hàng không thuộc chuyến đang chọn.');
      setSelectedLineId(line.id);
      setSerialItemId(result.serial_item_id ?? '');
      setMessage(`Đã nhận diện ${line.sku} — ${line.productName}`);
      setScan('');
    } catch (error) {
      setMessage((error as Error).message);
    }
  }

  function suggestedAction(): QueuedCommand['action'] {
    return selectedTrip?.status === 'READY_TO_LOAD' || selectedTrip?.status === 'LOADING'
      ? 'load'
      : 'deliver';
  }

  async function submitMovement(action: QueuedCommand['action'] = suggestedAction()) {
    if (!selectedTrip || !selectedLine || quantity <= 0) return;
    if (action === 'return' && !returnLocationId) {
      setMessage('Chọn vị trí cách ly hàng hoàn trước khi ghi nhận.');
      return;
    }
    const command: QueuedCommand = {
      id: crypto.randomUUID(),
      tripId: selectedTrip.id,
      action,
      body: {
        lineId: selectedLine.id,
        quantity,
        clientOccurredAt: new Date().toISOString(),
        ...(serialItemId ? { serialItemId } : {}),
        ...(action === 'return' ? { returnLocationId } : {}),
      },
      createdAt: new Date().toISOString(),
    };
    if (!navigator.onLine) {
      persistQueue([...queue, command]);
      setMessage('Đã lưu lệnh ngoại tuyến. Lệnh sẽ tự đồng bộ khi có mạng.');
      return;
    }
    setBusy(true);
    try {
      await api(`/trips/${command.tripId}/${command.action}`, {
        method: 'POST',
        headers: { 'Idempotency-Key': command.id },
        body: JSON.stringify(command.body),
      });
      setMessage('Đã ghi nhận thao tác.');
      await loadData();
    } catch (error) {
      if (!navigator.onLine) {
        persistQueue([...readJson<QueuedCommand[]>(QUEUE_KEY, []), command]);
        setOnline(false);
        setMessage('Mạng bị gián đoạn; lệnh đã được lưu để đồng bộ lại.');
      } else {
        setMessage((error as Error).message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function transition(action: 'depart' | 'reconcile') {
    if (!selectedTrip || !navigator.onLine) {
      setMessage('Thao tác chuyển trạng thái cần kết nối mạng.');
      return;
    }
    setBusy(true);
    try {
      await api(`/trips/${selectedTrip.id}/${action}`, { method: 'POST' });
      setMessage(action === 'depart' ? 'Chuyến đã rời kho.' : 'Đã đối soát chuyến.');
      await loadData();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function moveStop(index: number, direction: -1 | 1) {
    if (!selectedTrip?.stops || !navigator.onLine) {
      setMessage('Sắp xếp điểm dừng cần kết nối mạng.');
      return;
    }
    const target = index + direction;
    if (target < 0 || target >= selectedTrip.stops.length) return;
    const reordered = [...selectedTrip.stops];
    [reordered[index], reordered[target]] = [reordered[target]!, reordered[index]!];
    setBusy(true);
    try {
      await api(`/trips/${selectedTrip.id}/stops`, {
        method: 'PUT',
        body: JSON.stringify({
          customerLocationIds: reordered.map((stop) => stop.customerLocationId),
        }),
      });
      setMessage('Đã cập nhật thứ tự điểm dừng.');
      await loadData();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function stopProgress(stop: Stop) {
    const lines =
      selectedTrip?.lines.filter((line) => line.customerLocationId === stop.customerLocationId) ??
      [];
    const loaded = lines.reduce((sum, line) => sum + Number(line.loaded), 0);
    const handled = lines.reduce(
      (sum, line) => sum + Number(line.delivered) + Number(line.returned),
      0,
    );
    return { loaded, handled, complete: loaded > 0 && handled >= loaded };
  }

  function navigationUrl(stop: Stop) {
    const destination =
      stop.latitude != null && stop.longitude != null
        ? `${stop.latitude},${stop.longitude}`
        : stop.address || stop.name;
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
  }

  return (
    <div className="driver-shell">
      <div className="driver-head">
        <div>
          <div className="eyebrow">DRIVER PWA</div>
          <h1>Giao nhận hiện trường</h1>
        </div>
        <span className={`connectivity ${online ? 'online' : 'offline'}`}>
          {online ? '● Có mạng' : '● Ngoại tuyến'} · {queue.length} chờ
        </span>
      </div>

      <section className="driver-card">
        <label>Chuyến đang thực hiện</label>
        <select value={tripId} onChange={(event) => setTripId(event.target.value)}>
          {trips.map((trip) => (
            <option key={trip.id} value={trip.id}>
              {trip.trip_code} · {trip.status} · {trip.registration ?? 'Chưa gán xe'}
            </option>
          ))}
        </select>
        {selectedTrip && (
          <div className="trip-summary">
            <strong>{selectedTrip.trip_code}</strong>
            <span>{new Date(selectedTrip.service_date).toLocaleDateString('vi-VN')}</span>
            <span className="status">{selectedTrip.status}</span>
          </div>
        )}
      </section>

      {!!selectedTrip?.stops?.length && (
        <section className="driver-card route-card">
          <div className="route-title">
            <div>
              <label>Lộ trình giao hàng</label>
              <small>{selectedTrip.stops.length} điểm dừng</small>
            </div>
          </div>
          <div className="stop-list">
            {selectedTrip.stops.map((stop, index) => {
              const progress = stopProgress(stop);
              return (
                <article
                  className={progress.complete ? 'stop complete' : 'stop'}
                  key={stop.customerLocationId}
                >
                  <span className="stop-number">{index + 1}</span>
                  <div className="stop-info">
                    <strong>{stop.name}</strong>
                    <small>{stop.address || 'Chưa có địa chỉ'}</small>
                    <span>
                      {progress.handled}/{progress.loaded} đã xử lý
                    </span>
                    {stop.proof && (
                      <span className="stop-success">POD: {stop.proof.recipientName}</span>
                    )}
                    {stop.exception && (
                      <span className="stop-warning">Ngoại lệ: {stop.exception.reasonCode}</span>
                    )}
                  </div>
                  <div className="stop-controls">
                    <a href={navigationUrl(stop)} target="_blank" rel="noreferrer">
                      Đi đường
                    </a>
                    <button disabled={busy || index === 0} onClick={() => void moveStop(index, -1)}>
                      ↑
                    </button>
                    <button
                      disabled={busy || index === selectedTrip.stops!.length - 1}
                      onClick={() => void moveStop(index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <div className="stop-outcomes">
                    {!stop.proof && (
                      <button
                        onClick={() =>
                          setActiveOutcome({ stopId: stop.customerLocationId, type: 'pod' })
                        }
                      >
                        Thêm POD
                      </button>
                    )}
                    {!stop.exception && (
                      <button
                        onClick={() =>
                          setActiveOutcome({ stopId: stop.customerLocationId, type: 'exception' })
                        }
                      >
                        Báo ngoại lệ
                      </button>
                    )}
                    {activeOutcome?.stopId === stop.customerLocationId &&
                      activeOutcome.type === 'pod' && (
                        <PodCapture
                          tripId={selectedTrip.id}
                          customerLocationId={stop.customerLocationId}
                          onSaved={loadData}
                        />
                      )}
                    {activeOutcome?.stopId === stop.customerLocationId &&
                      activeOutcome.type === 'exception' && (
                        <StopException
                          tripId={selectedTrip.id}
                          customerLocationId={stop.customerLocationId}
                          onSaved={loadData}
                        />
                      )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      <form className="driver-card scan-box" onSubmit={resolveScan}>
        <label htmlFor="scan">Quét barcode / serial</label>
        <div>
          <input
            id="scan"
            autoFocus
            autoComplete="off"
            value={scan}
            onChange={(event) => setScan(event.target.value)}
            placeholder="Quét bằng máy hoặc nhập mã"
          />
          <button type="submit">Nhận diện</button>
        </div>
      </form>

      <section className="driver-card">
        <label>Dòng hàng</label>
        <select
          value={selectedLineId}
          onChange={(event) => {
            setSelectedLineId(event.target.value);
            setSerialItemId('');
          }}
        >
          <option value="">Chọn SKU trong manifest</option>
          {selectedTrip?.lines.map((line) => (
            <option key={line.id} value={line.id}>
              {line.sku} · {line.productName} · {line.customerName}
            </option>
          ))}
        </select>
        {selectedLine && (
          <div className="line-progress">
            <span>
              Kế hoạch <strong>{selectedLine.planned}</strong>
            </span>
            <span>
              Đã chất <strong>{selectedLine.loaded}</strong>
            </span>
            <span>
              Đã giao <strong>{selectedLine.delivered}</strong>
            </span>
            <span>
              Hoàn <strong>{selectedLine.returned}</strong>
            </span>
          </div>
        )}
        <label htmlFor="quantity">Số lượng</label>
        <input
          id="quantity"
          type="number"
          min="1"
          step="1"
          value={quantity}
          onChange={(event) => setQuantity(Number(event.target.value))}
        />
        <label htmlFor="returnLocation">Vị trí hàng hoàn</label>
        <select
          id="returnLocation"
          value={returnLocationId}
          onChange={(event) => setReturnLocationId(event.target.value)}
        >
          <option value="">Chọn khi hoàn hàng</option>
          {returnLocations.map((location) => (
            <option key={location.id} value={location.id}>
              {location.code} · {location.name}
            </option>
          ))}
        </select>
      </section>

      {message && <div className="driver-message">{message}</div>}
      <div className="driver-actions">
        <button disabled={busy || !selectedLine} onClick={() => void submitMovement()}>
          {suggestedAction() === 'load' ? 'Chất lên xe' : 'Xác nhận giao'}
        </button>
        <button
          className="secondary"
          disabled={busy || !selectedLine}
          onClick={() => void submitMovement('return')}
        >
          Hoàn về kho
        </button>
        {selectedTrip?.status === 'LOADED' && (
          <button onClick={() => void transition('depart')}>Rời kho</button>
        )}
        {['RETURNING', 'RECONCILING'].includes(selectedTrip?.status ?? '') && (
          <button onClick={() => void transition('reconcile')}>Đối soát</button>
        )}
        <button
          className="ghost"
          disabled={busy || queue.length === 0 || !online}
          onClick={() => void syncQueue()}
        >
          Đồng bộ {queue.length} lệnh
        </button>
      </div>
    </div>
  );
}
