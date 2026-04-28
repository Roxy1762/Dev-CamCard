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
      <body
        style={{
          margin: 0,
          fontFamily:
            '"PingFang SC","Microsoft YaHei","Hiragino Sans GB","Source Han Sans SC","Noto Sans CJK SC",system-ui,-apple-system,"Segoe UI",sans-serif',
          color: "#222",
          background: "#fafbfc",
          minHeight: "100vh",
          WebkitFontSmoothing: "antialiased",
          MozOsxFontSmoothing: "grayscale",
        }}
      >
        {children}
      </body>
    </html>
  );
}
