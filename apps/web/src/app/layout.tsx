import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Code Visualizer — follow the execution",
  description:
    "Detect Java inputs, record real execution, and follow variable changes through to the result.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
