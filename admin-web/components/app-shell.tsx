'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api } from '@/lib/api';

type Principal = {
  sub: string;
  displayName: string;
  email: string;
  roles: string[];
  permissions: string[];
};
const links = [
  { href: '/', label: 'Tổng quan', permission: '' },
  { href: '/products', label: 'Sản phẩm', permission: 'inventory.read' },
  { href: '/receipts', label: 'Nhập kho', permission: 'inbound.manage' },
  { href: '/picking', label: 'Soạn hàng', permission: 'outbound.pick' },
  { href: '/trips', label: 'Chuyến giao', permission: 'outbound.manage' },
  { href: '/driver', label: 'Giao nhận', permission: 'delivery.read' },
  { href: '/dispatch', label: 'Điều phối', permission: 'outbound.manage' },
  { href: '/reports', label: 'Báo cáo', permission: 'inventory.read' },
  { href: '/counts', label: 'Kiểm kê', permission: 'inventory.count' },
  { href: '/admin', label: 'Quản trị', permission: 'identity.manage' },
];
function persona(p: Principal) {
  if (p.roles.includes('SUPER_ADMIN')) return 'Super Admin';
  if (p.roles.includes('WAREHOUSE_MANAGER')) return 'Quản lý kho';
  if (p.roles.includes('SHIPPER')) return 'Shipper';
  return 'Người dùng';
}
export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [principal, setPrincipal] = useState<Principal>();
  const isLogin = pathname === '/login';
  useEffect(() => {
    if (isLogin) return;
    if (!localStorage.getItem('wms_access_token')) return router.replace('/login');
    api<Principal>('/me')
      .then((current) => {
        setPrincipal(current);
        if (pathname === '/' && current.roles.includes('SHIPPER')) return router.replace('/driver');
        const route = links.find((item) => item.href !== '/' && pathname.startsWith(item.href));
        if (route?.permission && !current.permissions.includes(route.permission))
          router.replace(current.roles.includes('SHIPPER') ? '/driver' : '/');
      })
      .catch(() => router.replace('/login'));
  }, [isLogin, pathname, router]);
  if (isLogin) return <main>{children}</main>;
  if (!principal || (pathname === '/' && principal.roles.includes('SHIPPER')))
    return <div className="app-loading">Đang tải không gian làm việc…</div>;
  const logout = () => {
    localStorage.removeItem('wms_access_token');
    localStorage.removeItem('wms_refresh_token');
    router.replace('/login');
  };
  return (
    <>
      <header className="topbar">
        <Link className="brand" href={principal.roles.includes('SHIPPER') ? '/driver' : '/'}>
          <span>W</span> WMS Control
        </Link>
        <nav>
          {links
            .filter((item) => !item.permission || principal.permissions.includes(item.permission))
            .filter((item) => !(principal.roles.includes('SHIPPER') && item.href === '/'))
            .map((item) => (
              <Link
                className={pathname === item.href ? 'active' : ''}
                href={item.href}
                key={item.href}
              >
                {item.label}
              </Link>
            ))}
        </nav>
        <div className="user-menu">
          <div>
            <strong>{principal.displayName}</strong>
            <small>{persona(principal)}</small>
          </div>
          <button onClick={logout}>Đăng xuất</button>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
}
