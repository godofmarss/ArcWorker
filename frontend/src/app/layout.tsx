import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Web3Provider } from '@/components/Web3Provider';
import { GoogleAuthProvider } from '@/components/auth/GoogleAuthProvider';
import { ConsoleSuppressor } from '@/components/ConsoleSuppressor';
import Script from 'next/script';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'ArcWorker Protocol | Instant Digital Work',
  description: 'Micro-tasking infrastructure on Arc Network',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ArcWorker',
  },
};

export const viewport = {
  themeColor: '#005ddb',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <Script
          src="https://telegram.org/js/telegram-web-app.js"
          strategy="beforeInteractive"
        />
      </head>
      <body className={inter.className}>
        <ConsoleSuppressor />
        <GoogleAuthProvider>
          <Web3Provider>
            {children}
          </Web3Provider>
        </GoogleAuthProvider>
      </body>
    </html>
  );
}
