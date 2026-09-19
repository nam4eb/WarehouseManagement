'use client';

import { FormEvent, useEffect, useState } from 'react';
import { Failure, Loading } from '@/components/data-state';
import { api } from '@/lib/api';

type Report = {
  range: { from: string; to: string };
  receipts: { total: number; confirmed: number; exceptions: number };
  picking: { total: number; completed: number; average_minutes: number };
  trips: { total: number; completed: number; exceptions: number; with_proof: number };
  inventory: { movements: number; units: number };
  daily: {
    report_date: string;
    receipts: number;
    picks_completed: number;
    trips_completed: number;
  }[];
};

function isoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export default function Reports() {
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(today.getDate() - 29);
  const [range, setRange] = useState({ from: isoDate(monthAgo), to: isoDate(today) });
  const [report, setReport] = useState<Report>();
  const [error, setError] = useState('');
  const load = (value: typeof range) => {
    setError('');
    setReport(undefined);
    api<Report>(`/reports/operations?from=${value.from}&to=${value.to}`)
      .then(setReport)
      .catch((e: Error) => setError(e.message));
  };
  useEffect(() => {
    load(range);
  }, []);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    load(range);
  }
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">OPERATIONS ANALYTICS</div>
          <h1>Báo cáo vận hành</h1>
          <p>Hiệu suất kho và giao hàng theo khoảng thời gian.</p>
        </div>
        <form className="range" onSubmit={submit}>
          <input
            type="date"
            value={range.from}
            onChange={(e) => setRange({ ...range, from: e.target.value })}
          />
          <span>đến</span>
          <input
            type="date"
            value={range.to}
            onChange={(e) => setRange({ ...range, to: e.target.value })}
          />
          <button>Xem báo cáo</button>
        </form>
      </div>
      {error ? (
        <Failure message={error} />
      ) : !report ? (
        <Loading />
      ) : (
        <>
          <section className="metrics">
            <article>
              <span>Phiếu nhập</span>
              <strong>
                {report.receipts.confirmed}/{report.receipts.total}
              </strong>
              <small>{report.receipts.exceptions} có chênh lệch</small>
            </article>
            <article>
              <span>Picking hoàn tất</span>
              <strong>
                {report.picking.completed}/{report.picking.total}
              </strong>
              <small>Trung bình {Math.round(report.picking.average_minutes)} phút</small>
            </article>
            <article>
              <span>Chuyến hoàn tất</span>
              <strong>
                {report.trips.completed}/{report.trips.total}
              </strong>
              <small>
                {report.trips.with_proof} có POD · {report.trips.exceptions} ngoại lệ
              </small>
            </article>
            <article>
              <span>Luân chuyển kho</span>
              <strong>{report.inventory.units}</strong>
              <small>{report.inventory.movements} movement</small>
            </article>
          </section>
          <section className="panel table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Ngày</th>
                  <th>Phiếu nhập</th>
                  <th>Picking hoàn tất</th>
                  <th>Chuyến hoàn tất</th>
                </tr>
              </thead>
              <tbody>
                {report.daily.map((day) => (
                  <tr key={day.report_date}>
                    <td>
                      <strong>{new Date(day.report_date).toLocaleDateString('vi-VN')}</strong>
                    </td>
                    <td>{day.receipts}</td>
                    <td>{day.picks_completed}</td>
                    <td>{day.trips_completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </>
  );
}
