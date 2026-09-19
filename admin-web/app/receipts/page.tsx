'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Failure, Loading, Status } from '@/components/data-state';
type Receipt = {
  id: string;
  reference_number: string;
  status: string;
  created_at: string;
  lines: { expected: number; actual: number; variance: number }[];
};
export default function Receipts() {
  const [items, setItems] = useState<Receipt[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Receipt[]>('/receipts')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!items) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">INBOUND</div>
          <h1>Phiếu nhập kho</h1>
          <p>Theo dõi tiến độ nhận hàng và sai lệch số lượng.</p>
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tham chiếu</th>
              <th>Trạng thái</th>
              <th>Dự kiến</th>
              <th>Đã nhận</th>
              <th>Chênh lệch</th>
              <th>Ngày tạo</th>
            </tr>
          </thead>
          <tbody>
            {items.map((r) => {
              const expected = r.lines.reduce((n, l) => n + Number(l.expected), 0),
                actual = r.lines.reduce((n, l) => n + Number(l.actual), 0);
              return (
                <tr key={r.id}>
                  <td>
                    <strong>{r.reference_number}</strong>
                  </td>
                  <td>
                    <Status value={r.status} />
                  </td>
                  <td>{expected}</td>
                  <td>{actual}</td>
                  <td className={actual !== expected ? 'warn' : ''}>{actual - expected}</td>
                  <td>{new Date(r.created_at).toLocaleDateString('vi-VN')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}
