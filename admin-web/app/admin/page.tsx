'use client';

import { useEffect, useState } from 'react';
import { Failure, Loading } from '@/components/data-state';
import { api } from '@/lib/api';

type User = {
  id: string;
  email: string;
  display_name: string;
  active: boolean;
  roles: { code: string; warehouseId?: string }[];
};
type Role = { id: string; code: string; name: string; permissions: string[] };
type Device = { id: string; email: string; fingerprint: string; revoked_at?: string };
export default function AdminPage() {
  const [data, setData] = useState<{ users: User[]; roles: Role[]; devices: Device[] }>();
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([api<User[]>('/users'), api<Role[]>('/roles'), api<Device[]>('/devices')])
      .then(([users, roles, devices]) => setData({ users, roles, devices }))
      .catch((e: Error) => setError(e.message));
  }, []);
  if (error) return <Failure message={error} />;
  if (!data) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">SUPER ADMIN</div>
          <h1>Quản trị truy cập</h1>
          <p>Người dùng, vai trò, phạm vi kho và thiết bị đăng nhập.</p>
        </div>
      </div>
      <section className="metrics admin-metrics">
        <article>
          <span>Người dùng</span>
          <strong>{data.users.length}</strong>
          <small>{data.users.filter((u) => u.active).length} đang hoạt động</small>
        </article>
        <article>
          <span>Vai trò</span>
          <strong>{data.roles.length}</strong>
          <small>RBAC theo persona</small>
        </article>
        <article>
          <span>Thiết bị</span>
          <strong>{data.devices.length}</strong>
          <small>{data.devices.filter((d) => d.revoked_at).length} đã thu hồi</small>
        </article>
      </section>
      <section className="panel table-wrap">
        <table>
          <thead>
            <tr>
              <th>Người dùng</th>
              <th>Vai trò</th>
              <th>Phạm vi</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody>
            {data.users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.display_name}</strong>
                  <small className="subline">{user.email}</small>
                </td>
                <td>{user.roles.map((role) => role.code).join(', ') || 'Chưa gán'}</td>
                <td>
                  {user.roles.some((role) => !role.warehouseId) ? 'Toàn tổ chức' : 'Theo kho'}
                </td>
                <td>
                  <span className={`status ${user.active ? 'status-completed' : ''}`}>
                    {user.active ? 'Hoạt động' : 'Khóa'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="role-grid">
        {data.roles.map((role) => (
          <article className="panel role-card" key={role.id}>
            <div className="eyebrow">{role.code}</div>
            <h2>{role.name}</h2>
            <p>{role.permissions.length} quyền</p>
            <div>
              {role.permissions.map((permission) => (
                <span key={permission}>{permission}</span>
              ))}
            </div>
          </article>
        ))}
      </section>
    </>
  );
}
