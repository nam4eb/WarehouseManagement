'use client';

import { FormEvent, useState } from 'react';
import { API_URL } from '@/lib/api';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState({
    email: 'admin@demo.local',
    deviceFingerprint: 'demo-device-warehouse-01',
  });
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const data = new FormData(event.currentTarget);
    const response = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        organizationCode: data.get('organizationCode'),
        email: data.get('email'),
        password: data.get('password'),
        deviceFingerprint: data.get('deviceFingerprint'),
      }),
    });
    const result = (await response.json()) as {
      accessToken?: string;
      refreshToken?: string;
      message?: string;
    };
    if (!response.ok || !result.accessToken) {
      setError(result.message ?? 'Đăng nhập thất bại');
      setBusy(false);
      return;
    }
    localStorage.setItem('wms_access_token', result.accessToken);
    if (result.refreshToken) localStorage.setItem('wms_refresh_token', result.refreshToken);
    window.location.href = '/';
  }
  return (
    <section className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="eyebrow">WAREHOUSE OPERATIONS</div>
        <h1>Chào mừng trở lại</h1>
        <p>Đăng nhập để theo dõi và điều phối hoạt động kho.</p>
        <div className="persona-picker">
          {[
            ['Super Admin', 'admin@demo.local', 'demo-device-warehouse-01'],
            ['Quản lý kho', 'manager@demo.local', 'demo-device-manager-01'],
            ['Shipper', 'shipper@demo.local', 'demo-device-shipper-01'],
          ].map(([label, email, deviceFingerprint]) => (
            <button
              type="button"
              className={identity.email === email ? 'selected' : ''}
              key={email}
              onClick={() => setIdentity({ email, deviceFingerprint })}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Mã tổ chức
          <input name="organizationCode" defaultValue="DEMO" required />
        </label>
        <label>
          Thiết bị
          <input
            name="deviceFingerprint"
            value={identity.deviceFingerprint}
            onChange={(event) =>
              setIdentity({ ...identity, deviceFingerprint: event.target.value })
            }
            required
          />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            value={identity.email}
            onChange={(event) => setIdentity({ ...identity, email: event.target.value })}
            required
          />
        </label>
        <label>
          Mật khẩu
          <input name="password" type="password" placeholder="Nhập mật khẩu" required />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
        <small>Demo: Demo-Wms-Change-Me-2026!</small>
      </form>
    </section>
  );
}
