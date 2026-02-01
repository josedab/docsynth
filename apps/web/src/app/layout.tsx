import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { I18nProvider } from '../i18n';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'DocSynth - Living Documentation Generator',
  description: 'AI-powered documentation that stays current with your code',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <I18nProvider>{children}</I18nProvider>
      </body>
    </html>
  );
}
