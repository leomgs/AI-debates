import { Geist, Geist_Mono } from "next/font/google";

// Compartidas por los dos layouts raíz (panel y showcase): cada uno arma su
// propio <html>, pero la tipografía es la misma.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const fontVariables = `${geistSans.variable} ${geistMono.variable}`;
