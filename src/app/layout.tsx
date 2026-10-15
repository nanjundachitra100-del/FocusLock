import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "FocusLock — Earn Your Scroll", description: "Your attention is your superpower." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
