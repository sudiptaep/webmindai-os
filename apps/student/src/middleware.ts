import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const hostname = request.headers.get('host') ?? '';
  const platformDomain = process.env.NEXT_PUBLIC_PLATFORM_DOMAIN ?? 'localhost';

  let collegeSlug = '';
  if (!hostname.startsWith('localhost') && hostname.includes('.')) {
    const subdomain = hostname.split('.')[0];
    if (subdomain && subdomain !== 'www') {
      collegeSlug = subdomain;
    }
  }

  const requestHeaders = new Headers(request.headers);
  if (collegeSlug) {
    requestHeaders.set('x-college-slug', collegeSlug);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
