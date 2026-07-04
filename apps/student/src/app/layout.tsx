import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/lib/providers';
import { CollegeSlugProvider } from '@/lib/college-context';
import './globals.css';

export const metadata: Metadata = {
  title: 'Medimind AI',
  description: 'Ask your college AI anything',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const headersList = headers();
  const collegeSlug = headersList.get('x-college-slug') ?? '';

  return (
    <html lang="en">
      <body className="bg-gray-950 text-gray-100 min-h-screen">
        <Providers>
          <CollegeSlugProvider slug={collegeSlug}>
            {children}
          </CollegeSlugProvider>
        </Providers>
      </body>
    </html>
  );
}
