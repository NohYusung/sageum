import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAGEUM · 흩어진 정보를 금으로',
  description: '흩어진 웹 정보를 학습 커리큘럼과 지식 노트로 정제하는 SAGEUM 프로토타입.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
