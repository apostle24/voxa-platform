import type { Metadata } from 'next';
import './globals.css';
import { PlayerProvider } from '../components/player-provider';
import { NotificationBell } from '../components/notification-bell';

export const metadata: Metadata = {
  title: 'VOXA — Listen. Speak. Connect.',
  description: 'A home for podcasts, creators, and live conversations.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><PlayerProvider>{children}<NotificationBell /></PlayerProvider></body></html>;
}
