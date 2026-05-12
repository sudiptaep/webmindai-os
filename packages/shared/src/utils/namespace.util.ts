export function buildPineconeNamespace(collegeId: string, deptId: string): string {
  return `c_${collegeId}_d_${deptId}`;
}

export function buildGenericNamespace(collegeId: string): string {
  return `c_${collegeId}_d_generic`;
}

export function parseNamespace(namespace: string): { collegeId: string; deptId: string } | null {
  const match = namespace.match(/^c_(.+)_d_(.+)$/);
  if (!match) return null;
  return { collegeId: match[1], deptId: match[2] };
}
