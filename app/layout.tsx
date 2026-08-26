import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Naap",
  description: "Measure what you eat. Telegram in, macros out, in under a second.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
