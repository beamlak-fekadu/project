import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import './globals.css';
import { APP_NAME_SHORT, APP_NAME_FULL, HOSPITAL_NAME } from '@/constants';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import ThemeScript from '@/components/theme/ThemeScript';
import { getServerThemeFromPreference, isThemePreference, THEME_COOKIE_KEY } from '@/components/theme/theme-contract';
import ServiceWorkerRegister from '@/components/offline/ServiceWorkerRegister';
import QueryProvider from '@/providers/QueryProvider';

export const metadata: Metadata = {
  title: `${APP_NAME_SHORT} - ${APP_NAME_FULL}`,
  description: `${APP_NAME_FULL} for ${HOSPITAL_NAME}`,
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/icons/bmedis-icon.svg',
    apple: '/icons/bmedis-icon.svg',
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
  const htmlClassName = `h-full antialiased${initialTheme === 'dark' ? ' dark' : ''}`;

  return (
    <html
      lang="en"
      data-theme={initialTheme}
      className={htmlClassName}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeScript />
        <ThemeProvider>
          <ServiceWorkerRegister />
          <QueryProvider>
            {children}
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
