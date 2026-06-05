'use client';

interface Props {
  status: string;
}

export function InviteStatusBadge({ status }: Props) {
  if (status === 'active') {
    return <span className="inline-flex items-center gap-1 text-green-400 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" />Active</span>;
  }
  if (status === 'invited') {
    return <span className="inline-flex items-center gap-1 text-yellow-400 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-yellow-400 inline-block" />Invited</span>;
  }
  return <span className="inline-flex items-center gap-1 text-red-400 text-xs"><span className="w-1.5 h-1.5 rounded-full bg-red-400 inline-block" />Disabled</span>;
}
