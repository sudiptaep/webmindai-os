import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@college-chatbot/api';

export const trpc = createTRPCReact<AppRouter>();
