'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Failure, Loading, Status } from '@/components/data-state';
type Task = {
  id: string;
  order_number: string;
  status: string;
  created_at: string;
  lines: { required: number; picked: number }[];
};
export default function Picking() {
  const [items, setItems] = useState<Task[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Task[]>('/picking-tasks')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!items) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">OUTBOUND</div>
          <h1>Nhiệm vụ soạn hàng</h1>
          <p>Tiến độ lấy hàng từ vị trí kho sang khu staging.</p>
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Đơn hàng</th>
              <th>Trạng thái</th>
              <th>Tiến độ</th>
              <th>Số dòng</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => {
              const required = t.lines.reduce((n, l) => n + Number(l.required), 0),
                picked = t.lines.reduce((n, l) => n + Number(l.picked), 0),
                pct = required ? Math.round((picked / required) * 100) : 0;
              return (
                <tr key={t.id}>
                  <td>
                    <strong>{t.order_number}</strong>
                  </td>
                  <td>
                    <Status value={t.status} />
                  </td>
                  <td>
                    <div className="progress">
                      <i style={{ width: `${Math.min(pct, 100)}%` }} />
                    </div>
                    <small>
                      {picked}/{required} ({pct}%)
                    </small>
                  </td>
                  <td>{t.lines.length}</td>
                  <td>{new Date(t.created_at).toLocaleDateString('vi-VN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
