'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Failure, Loading } from '@/components/data-state';
type Product = {
  id: string;
  sku: string;
  name: string;
  serial_required: boolean;
  is_bundle: boolean;
  barcodes: string[];
};
export default function Products() {
  const [items, setItems] = useState<Product[]>();
  const [error, setError] = useState('');
  useEffect(() => {
    api<Product[]>('/products')
      .then(setItems)
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!items) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">MASTER DATA</div>
          <h1>Sản phẩm</h1>
          <p>Danh mục SKU, barcode và yêu cầu truy xuất serial.</p>
        </div>
      </div>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Tên sản phẩm</th>
              <th>Barcode</th>
              <th>Loại</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id}>
                <td>
                  <strong>{p.sku}</strong>
                </td>
                <td>{p.name}</td>
                <td>{p.barcodes?.join(', ') || '—'}</td>
                <td>
                  {p.is_bundle ? 'Bộ sản phẩm' : p.serial_required ? 'Theo serial' : 'Thông thường'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
