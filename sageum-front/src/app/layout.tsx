import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'SAGEUM · Document Intelligence',
  description: '문서를 구조화하고 근거와 함께 답변하는 개인용 RAG 문서 저장소.',
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
