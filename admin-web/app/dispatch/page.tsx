'use client';

import { FormEvent, Fragment, useCallback, useEffect, useState } from 'react';
import { Failure, Loading, Status } from '@/components/data-state';
import { api } from '@/lib/api';

type Stop = {
  customerLocationId: string;
  sequence: number;
  name: string;
  address?: string;
  expectedArrivalAt?: string;
  appointmentStart?: string;
  appointmentEnd?: string;
  outcome: 'POD' | 'EXCEPTION' | 'PENDING';
  overdue: boolean;
};
type DispatchTrip = {
  id: string;
  trip_code: string;
  status: string;
  service_date: string;
  registration?: string;
  driver_name?: string;
  driver_user_id?: string;
  vehicle_id?: string;
  unresolved_custody: number;
  stop_count: number;
  unresolved_stops: number;
  overdue_stops: number;
  stops: Stop[];
  assignment_history: {
    id: string;
    previousDriver?: string;
    newDriver?: string;
    previousVehicle?: string;
    newVehicle?: string;
    reason: string;
    assignedAt: string;
    assignedBy: string;
  }[];
};
type Resources = {
  drivers: { id: string; display_name: string; email: string; active_trips: number }[];
  vehicles: { id: string; registration: string; active_trips: number }[];
};
type Alert = {
  id: string;
  alert_type: string;
  severity: 'WARNING' | 'CRITICAL';
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  trip_code: string;
  title: string;
  message: string;
  acknowledgement_note?: string;
  acknowledged_by_name?: string;
  created_at: string;
};

function localDateTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
type DispatchData = {
  generatedAt: string;
  summary: {
    activeTrips: number;
    overdueStops: number;
    unresolvedStops: number;
    unresolvedCustody: number;
  };
  trips: DispatchTrip[];
};

export default function DispatchPage() {
  const [data, setData] = useState<DispatchData>();
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string[]>([]);
  const [resources, setResources] = useState<Resources>({ drivers: [], vehicles: [] });
  const [saving, setSaving] = useState('');
  const [notice, setNotice] = useState('');
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [ackNotes, setAckNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      const [nextData, nextAlerts] = await Promise.all([
        api<DispatchData>('/reports/dispatch'),
        api<Alert[]>('/alerts'),
      ]);
      setData(nextData);
      setAlerts(nextAlerts);
      setError('');
    } catch (requestError) {
      setError((requestError as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
    api<Resources>('/reports/dispatch-resources')
      .then(setResources)
      .catch(() => undefined);
    const timer = window.setInterval(() => void load(), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function saveAssignment(event: FormEvent<HTMLFormElement>, trip: DispatchTrip) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(`assignment-${trip.id}`);
    try {
      await api(`/trips/${trip.id}/assignment`, {
        method: 'PUT',
        body: JSON.stringify({
          driverUserId: form.get('driverUserId') || null,
          vehicleId: form.get('vehicleId') || null,
          reason: form.get('reason'),
        }),
      });
      setNotice('Đã cập nhật phân công và lưu lịch sử.');
      await load();
    } catch (saveError) {
      setNotice((saveError as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function saveSchedule(event: FormEvent<HTMLFormElement>, tripId: string, stop: Stop) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaving(`schedule-${tripId}-${stop.customerLocationId}`);
    try {
      await api(`/trips/${tripId}/stops/${stop.customerLocationId}/schedule`, {
        method: 'PUT',
        body: JSON.stringify({
          appointmentStart: new Date(String(form.get('appointmentStart'))).toISOString(),
          appointmentEnd: new Date(String(form.get('appointmentEnd'))).toISOString(),
        }),
      });
      setNotice(`Đã cập nhật giờ hẹn ${stop.name}.`);
      await load();
    } catch (saveError) {
      setNotice((saveError as Error).message);
    } finally {
      setSaving('');
    }
  }

  async function acknowledge(alert: Alert) {
    const note = ackNotes[alert.id]?.trim();
    if (!note || note.length < 3) return setNotice('Nhập ghi chú tiếp nhận ít nhất 3 ký tự.');
    setSaving(`alert-${alert.id}`);
    try {
      await api(`/alerts/${alert.id}/acknowledge`, {
        method: 'POST',
        body: JSON.stringify({ note }),
      });
      setNotice(`Đã tiếp nhận cảnh báo ${alert.trip_code}.`);
      await load();
    } catch (saveError) {
      setNotice((saveError as Error).message);
    } finally {
      setSaving('');
    }
  }

  if (error && !data) return <Failure message={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">DISPATCH CONTROL TOWER</div>
          <h1>Giám sát giao hàng</h1>
          <p>Cảnh báo stop quá hạn, thiếu kết quả và custody chưa xử lý.</p>
        </div>
        <span className="live">● Tự làm mới 30 giây</span>
      </div>
      <section className="metrics">
        <article>
          <span>Chuyến đang hoạt động</span>
          <strong>{data.summary.activeTrips}</strong>
          <small>trong cửa sổ ±7 ngày</small>
        </article>
        <article>
          <span>Stop quá hạn</span>
          <strong className="warn">{data.summary.overdueStops}</strong>
          <small>chưa POD hoặc ngoại lệ</small>
        </article>
        <article>
          <span>Stop chưa kết quả</span>
          <strong>{data.summary.unresolvedStops}</strong>
          <small>cần tài xế cập nhật</small>
        </article>
        <article>
          <span>Custody chưa xử lý</span>
          <strong>{data.summary.unresolvedCustody}</strong>
          <small>đơn vị còn trên xe</small>
        </article>
      </section>
      {notice && <div className="driver-message">{notice}</div>}
      {!!alerts.filter((alert) => alert.status !== 'RESOLVED').length && (
        <section className="panel alerts-panel">
          <div className="panel-title">
            <div>
              <h2>Cảnh báo vận hành</h2>
              <p>Tiếp nhận và theo dõi sự cố cần xử lý.</p>
            </div>
            <span className="count">
              {alerts.filter((alert) => alert.status === 'OPEN').length} mới
            </span>
          </div>
          {alerts
            .filter((alert) => alert.status !== 'RESOLVED')
            .map((alert) => (
              <article
                className={`alert-item severity-${alert.severity.toLowerCase()}`}
                key={alert.id}
              >
                <div>
                  <strong>
                    {alert.title} · {alert.trip_code}
                  </strong>
                  <span>{alert.message}</span>
                  <small>{new Date(alert.created_at).toLocaleString('vi-VN')}</small>
                </div>
                {alert.status === 'OPEN' ? (
                  <div className="ack-form">
                    <input
                      value={ackNotes[alert.id] ?? ''}
                      onChange={(event) =>
                        setAckNotes((current) => ({ ...current, [alert.id]: event.target.value }))
                      }
                      placeholder="Ghi chú tiếp nhận"
                    />
                    <button
                      disabled={saving === `alert-${alert.id}`}
                      onClick={() => void acknowledge(alert)}
                    >
                      Xác nhận
                    </button>
                  </div>
                ) : (
                  <div className="acknowledged">
                    <strong>Đã tiếp nhận</strong>
                    <small>
                      {alert.acknowledged_by_name} · {alert.acknowledgement_note}
                    </small>
                  </div>
                )}
              </article>
            ))}
        </section>
      )}
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Chuyến</th>
              <th>Trạng thái</th>
              <th>Stop</th>
              <th>Quá hạn</th>
              <th>Custody</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.trips.map((trip) => (
              <Fragment key={trip.id}>
                <tr className={trip.overdue_stops ? 'alert-row' : ''}>
                  <td>
                    <strong>{trip.trip_code}</strong>
                    <small className="subline">
                      {trip.registration ?? trip.driver_name ?? 'Chưa phân công'}
                    </small>
                  </td>
                  <td>
                    <Status value={trip.status} />
                  </td>
                  <td>
                    {trip.stop_count - trip.unresolved_stops}/{trip.stop_count} có kết quả
                  </td>
                  <td className={trip.overdue_stops ? 'warn' : ''}>{trip.overdue_stops}</td>
                  <td className={trip.unresolved_custody ? 'warn' : ''}>
                    {trip.unresolved_custody}
                  </td>
                  <td>
                    <button
                      className="table-action"
                      onClick={() =>
                        setExpanded((current) =>
                          current.includes(trip.id)
                            ? current.filter((id) => id !== trip.id)
                            : [...current, trip.id],
                        )
                      }
                    >
                      {expanded.includes(trip.id) ? 'Thu gọn' : 'Chi tiết'}
                    </button>
                  </td>
                </tr>
                {expanded.includes(trip.id) && (
                  <tr>
                    <td colSpan={6} className="dispatch-stops">
                      <form
                        className="assignment-form"
                        onSubmit={(event) => void saveAssignment(event, trip)}
                      >
                        <strong>Điều phối tài xế và xe</strong>
                        <select name="driverUserId" defaultValue={trip.driver_user_id ?? ''}>
                          <option value="">Chưa phân tài xế</option>
                          {resources.drivers.map((driver) => (
                            <option key={driver.id} value={driver.id}>
                              {driver.display_name} ({driver.active_trips} chuyến)
                            </option>
                          ))}
                        </select>
                        <select name="vehicleId" defaultValue={trip.vehicle_id ?? ''}>
                          <option value="">Chưa phân xe</option>
                          {resources.vehicles.map((vehicle) => (
                            <option key={vehicle.id} value={vehicle.id}>
                              {vehicle.registration} ({vehicle.active_trips} chuyến)
                            </option>
                          ))}
                        </select>
                        <input
                          name="reason"
                          minLength={5}
                          required
                          placeholder="Lý do điều phối lại"
                        />
                        <button disabled={saving === `assignment-${trip.id}`}>Lưu phân công</button>
                      </form>
                      {!!trip.assignment_history?.length && (
                        <div className="assignment-history">
                          <strong>Lịch sử phân công</strong>
                          {trip.assignment_history.map((entry) => (
                            <div key={entry.id}>
                              <span>{new Date(entry.assignedAt).toLocaleString('vi-VN')}</span>
                              <span>
                                {entry.previousDriver ?? '—'} → {entry.newDriver ?? '—'}
                              </span>
                              <span>
                                {entry.previousVehicle ?? '—'} → {entry.newVehicle ?? '—'}
                              </span>
                              <small>
                                {entry.reason} · {entry.assignedBy}
                              </small>
                            </div>
                          ))}
                        </div>
                      )}
                      {trip.stops.map((stop) => (
                        <div
                          className={stop.overdue ? 'dispatch-stop overdue' : 'dispatch-stop'}
                          key={stop.customerLocationId}
                        >
                          <strong>
                            {stop.sequence}. {stop.name}
                          </strong>
                          <span>{stop.address ?? 'Chưa có địa chỉ'}</span>
                          <span>
                            {stop.expectedArrivalAt
                              ? new Date(stop.expectedArrivalAt).toLocaleString('vi-VN')
                              : 'Chưa xếp giờ'}
                          </span>
                          <span className={`outcome outcome-${stop.outcome.toLowerCase()}`}>
                            {stop.overdue ? 'QUÁ HẠN' : stop.outcome}
                          </span>
                          <form
                            className="appointment-form"
                            onSubmit={(event) => void saveSchedule(event, trip.id, stop)}
                          >
                            <input
                              name="appointmentStart"
                              type="datetime-local"
                              required
                              defaultValue={localDateTime(
                                stop.appointmentStart ?? stop.expectedArrivalAt,
                              )}
                            />
                            <input
                              name="appointmentEnd"
                              type="datetime-local"
                              required
                              defaultValue={localDateTime(
                                stop.appointmentEnd ?? stop.expectedArrivalAt,
                              )}
                            />
                            <button
                              disabled={saving === `schedule-${trip.id}-${stop.customerLocationId}`}
                            >
                              Đặt giờ
                            </button>
                          </form>
                        </div>
                      ))}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {data.trips.length === 0 && (
          <div className="empty">Không có chuyến trong cửa sổ giám sát.</div>
        )}
      </section>
      <small className="refresh-time">
        Cập nhật lúc {new Date(data.generatedAt).toLocaleTimeString('vi-VN')}
      </small>
    </>
  );
}
