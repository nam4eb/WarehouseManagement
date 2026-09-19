'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Failure, Loading, Status } from '@/components/data-state';

type Receipt = {
  id: string;
  reference_number: string;
  status: string;
  lines: { variance: number }[];
};
type Task = {
  id: string;
  order_number: string;
  status: string;
  lines: { required: number; picked: number }[];
};
type Trip = { id: string; trip_code: string; status: string };

export default function Dashboard() {
  const [data, setData] = useState<{
    products: unknown[];
    receipts: Receipt[];
    tasks: Task[];
    trips: Trip[];
  }>();
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([
      api<unknown[]>('/products'),
      api<Receipt[]>('/receipts'),
      api<Task[]>('/picking-tasks'),
      api<Trip[]>('/trips'),
    ])
      .then(([products, receipts, tasks, trips]) => setData({ products, receipts, tasks, trips }))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!data) return <Loading />;
  const exceptions = data.receipts.filter((r) => r.lines.some((l) => Number(l.variance) !== 0));
  const active = data.tasks.filter((t) => !['COMPLETED', 'CANCELLED'].includes(t.status));
  const tripExceptions = data.trips.filter((trip) => trip.status === 'RECONCILIATION_REQUIRED');
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">CONTROL TOWER</div>
          <h1>Chào buổi làm việc</h1>
          <p>Ưu tiên ngoại lệ trước, sau đó xử lý luồng hàng đang mở.</p>
        </div>
        <span className="live">● Hệ thống trực tuyến</span>
      </div>
      <section className="metrics">
        <article>
          <span>Sản phẩm</span>
          <strong>{data.products.length}</strong>
          <small>SKU đang quản lý</small>
        </article>
        <article>
          <span>Phiếu nhập mở</span>
          <strong>{data.receipts.filter((r) => r.status !== 'CONFIRMED').length}</strong>
          <small>{exceptions.length} có chênh lệch</small>
        </article>
        <article>
          <span>Nhiệm vụ soạn</span>
          <strong>{active.length}</strong>
          <small>cần hoàn tất</small>
        </article>
        <article>
          <span>Ngoại lệ chuyến</span>
          <strong>{tripExceptions.length}</strong>
          <small>chờ supervisor phê duyệt</small>
        </article>
      </section>
      <section className="panel">
        <div className="panel-title">
          <div>
            <h2>Ngoại lệ cần chú ý</h2>
            <p>Chênh lệch nhập kho và custody chuyến cần xử lý.</p>
          </div>
          <span className="count">{exceptions.length + tripExceptions.length}</span>
        </div>
        {exceptions.length + tripExceptions.length === 0 ? (
          <div className="empty">Không có ngoại lệ tồn đọng.</div>
        ) : (
          <div className="rows">
            {exceptions.map((r) => (
              <div className="row" key={r.id}>
                <strong>{r.reference_number}</strong>
                <span>Chênh lệch {r.lines.reduce((n, l) => n + Number(l.variance), 0)}</span>
                <Status value={r.status} />
              </div>
            ))}
            {tripExceptions.map((trip) => (
              <div className="row" key={trip.id}>
                <strong>{trip.trip_code}</strong>
                <span>Custody chưa được đối soát</span>
                <Status value={trip.status} />
              </div>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
