import { PwaRegister } from '@/components/pwa-register';
import { AppShell } from '@/components/app-shell';
import './styles.css';

export const metadata = {
  title: 'WMS Control',
  description: 'Warehouse operations console',
  manifest: '/manifest.webmanifest',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <PwaRegister />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
