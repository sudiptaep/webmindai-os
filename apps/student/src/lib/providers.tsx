'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { httpBatchLink, TRPCClientError } from '@trpc/client';
import { useState } from 'react';
import { trpc } from './trpc';
import { useAuthStore } from '@/store/auth.store';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry(failureCount, error) {
          // Don't retry 401s — we handle those via token refresh below
          if (error instanceof TRPCClientError && error.data?.httpStatus === 401) return false;
          return failureCount < 1;
        },
        staleTime: 30_000,
      },
    },
  });
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(makeQueryClient);

  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [
        httpBatchLink({
          url: process.env.NEXT_PUBLIC_TRPC_URL!,
          headers() {
            const token = useAuthStore.getState().token;
            return token ? { Authorization: `Bearer ${token}` } : {};
          },
          async fetch(url, options) {
            let res = await fetch(url, { ...options, credentials: 'include' });

            if (res.status === 401) {
              try {
                await useAuthStore.getState().refreshToken();
                // Retry with new token now in store
                const newToken = useAuthStore.getState().token;
                const newHeaders = new Headers(options?.headers);
                if (newToken) newHeaders.set('Authorization', `Bearer ${newToken}`);
                res = await fetch(url, { ...options, headers: newHeaders, credentials: 'include' });
              } catch {
                useAuthStore.getState().clearAuth();
              }
            }

            return res;
          },
        }),
      ],
    })
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </trpc.Provider>
  );
}
