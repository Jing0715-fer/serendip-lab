import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Serendip Lab · 生物科研灵感侦探",
  description:
    "与 AI 侦探对谈，把模糊的好奇心磨成值得研究的科学问题。Agent 自主检索 PubMed / OpenAlex / UniProt 等生物学数据库，把证据钉上侦探式证据墙，梳理成有逻辑的叙事与值得深挖的问题清单。",
  keywords: [
    "生物科研",
    "灵感发掘",
    "AI Agent",
    "证据墙",
    "苏格拉底提问",
    "文献调研",
    "PubMed",
    "科研选题",
  ],
  authors: [{ name: "Serendip Lab" }],
  icons: {
    icon: "/serendip.svg",
  },
  openGraph: {
    title: "Serendip Lab · 生物科研灵感侦探",
    description: "AI 侦探帮你从好奇心出发，建立证据墙，找出值得深挖的科学问题。",
    siteName: "Serendip Lab",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#171411" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 展示衬线字体渐进增强：离线时自动回退到本地衬线栈 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          href="https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@600;700;900&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
