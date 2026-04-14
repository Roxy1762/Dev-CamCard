import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dev-CamCard 管理后台",
  description: "Dev-CamCard · 课表风暴 游戏管理后台",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body style={{ margin: 0, fontFamily: "monospace" }}>{children}</body>
    </html>
  );
}
