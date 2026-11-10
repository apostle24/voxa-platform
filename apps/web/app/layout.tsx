import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'VOXA — Listen. Speak. Connect.',
  description: 'A home for podcasts, creators, and live conversations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
