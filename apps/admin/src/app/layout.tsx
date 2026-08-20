import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/lib/providers';
import { ThemeProvider } from '@/lib/theme-provider';
import { CollegeSlugProvider } from '@/lib/college-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Medimind AI — Admin Dashboard',
  description: 'College admin panel',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = headers();
  const collegeSlug = headersList.get('x-college-slug') ?? '';

  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background text-foreground min-h-screen">
        <ThemeProvider>
          <Providers>
            <CollegeSlugProvider slug={collegeSlug}>
              {children}
            </CollegeSlugProvider>
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
