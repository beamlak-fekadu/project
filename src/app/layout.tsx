import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import './globals.css';
import { APP_NAME_SHORT, APP_NAME_FULL, HOSPITAL_NAME } from '@/constants';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import ThemeScript from '@/components/theme/ThemeScript';
import { getServerThemeFromPreference, isThemePreference, THEME_COOKIE_KEY } from '@/components/theme/theme-contract';
import ServiceWorkerRegister from '@/components/offline/ServiceWorkerRegister';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: `${APP_NAME_SHORT} - ${APP_NAME_FULL}`,
  description: `${APP_NAME_FULL} for ${HOSPITAL_NAME}`,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/bmerms-icon.svg',
    apple: '/icons/bmerms-icon.svg',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const cookieStore = await cookies();
  const cookieThemeValue = cookieStore.get(THEME_COOKIE_KEY)?.value;
  const preference = isThemePreference(cookieThemeValue) ? cookieThemeValue : undefined;
  const initialTheme = getServerThemeFromPreference(preference);
  const htmlClassName = `${geistSans.variable} ${geistMono.variable} h-full antialiased${initialTheme === 'dark' ? ' dark' : ''}`;

  return (
    <html
      lang="en"
      data-theme={initialTheme}
      className={htmlClassName}
    >
      <body className="min-h-full flex flex-col">
        <ThemeScript />
        <ThemeProvider>
          <ServiceWorkerRegister />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
