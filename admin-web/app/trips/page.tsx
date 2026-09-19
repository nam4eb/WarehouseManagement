'use client';

import { useEffect, useState } from 'react';
import { Failure, Loading, Status } from '@/components/data-state';
import { api } from '@/lib/api';

type Trip = {
  id: string;
  trip_code: string;
  status: string;
  service_date: string;
  registration?: string;
  driver_name?: string;
  proofs?: { recipientName: string; deliveredAt: string }[];
  exception_approval?: { resolutionCode: string; reason: string };
  lines: { planned: number; loaded: number; delivered: number; returned: number }[];
};

export default function Trips() {
  const [items, setItems] = useState<Trip[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Trip[]>('/trips')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!items) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">LAST MILE</div>
          <h1>Chuyến giao hàng</h1>
          <p>Theo dõi hàng đã chất, đã giao và còn trong custody của tài xế.</p>
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Chuyến</th>
              <th>Ngày dịch vụ</th>
              <th>Trạng thái</th>
              <th>Đã chất</th>
              <th>Đã giao</th>
              <th>Hoàn về</th>
              <th>Chưa đối soát</th>
              <th>POD</th>
              <th>Phê duyệt ngoại lệ</th>
            </tr>
          </thead>
          <tbody>
            {items.map((trip) => {
              const total = (field: 'planned' | 'loaded' | 'delivered' | 'returned') =>
                trip.lines.reduce((sum, line) => sum + Number(line[field] ?? 0), 0);
              const unresolved = total('loaded') - total('delivered') - total('returned');
              return (
                <tr key={trip.id}>
                  <td>
                    <strong>{trip.trip_code}</strong>
                    <small className="subline">
                      {trip.registration ?? trip.driver_name ?? 'Chưa phân công'}
                    </small>
                  </td>
                  <td>
                    {trip.exception_approval ? (
                      <>
                        <strong>{trip.exception_approval.resolutionCode}</strong>
                        <small className="subline">{trip.exception_approval.reason}</small>
                      </>
                    ) : trip.status === 'RECONCILIATION_REQUIRED' ? (
                      <span className="status status-picking">Chờ duyệt</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{new Date(trip.service_date).toLocaleDateString('vi-VN')}</td>
                  <td>
                    <Status value={trip.status} />
                  </td>
                  <td>
                    {total('loaded')} / {total('planned')}
                  </td>
                  <td>{total('delivered')}</td>
                  <td>{total('returned')}</td>
                  <td className={unresolved ? 'warn' : ''}>{unresolved}</td>
                  <td>
                    {trip.proofs?.length ? (
                      <>
                        <strong>{trip.proofs.length} POD</strong>
                        <small className="subline">
                          {trip.proofs.map((proof) => proof.recipientName).join(', ')}
                        </small>
                      </>
                    ) : (
                      <span className="status">Chưa có</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
