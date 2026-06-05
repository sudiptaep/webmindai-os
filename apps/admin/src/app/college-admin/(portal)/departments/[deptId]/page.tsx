'use client';

import { useParams, useRouter } from 'next/navigation';
import { trpc } from '@/lib/trpc';

export default function CollegeAdminDeptDetailPage() {
  const params = useParams();
  const router = useRouter();
  const deptId = String(params.deptId);

  const deptQuery = trpc.collegeAdmin.getDepartment.useQuery({ dept_id: deptId });
  const docsQuery = trpc.collegeAdmin.getDeptDocuments.useQuery({ dept_id: deptId });
  const studentsQuery = trpc.collegeAdmin.getDeptStudents.useQuery({ dept_id: deptId });

  const dept = deptQuery.data;

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => router.back()} className="text-gray-400 hover:text-gray-200 text-sm">← Back</button>
        <h1 className="text-xl font-semibold">{dept?.name ?? 'Department'}</h1>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{docsQuery.data?.total ?? 0}</p>
          <p className="text-sm text-gray-400 mt-1">Documents</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-2xl font-bold">{studentsQuery.data?.total ?? 0}</p>
          <p className="text-sm text-gray-400 mt-1">Students</p>
        </div>
        <div className="bg-gray-800 rounded-lg p-4">
          <p className="text-sm text-gray-400">Read-only view</p>
          <p className="text-xs text-gray-600 mt-1">Contact dept admin to modify</p>
        </div>
      </div>

      {/* Documents */}
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Documents (read-only)</h2>
      <div className="bg-gray-800 rounded-lg overflow-hidden mb-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-left">
              <th className="px-4 py-3">Document</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Uploaded</th>
            </tr>
          </thead>
          <tbody>
            {(docsQuery.data?.documents as Record<string, unknown>[] ?? []).map((doc) => (
              <tr key={String(doc._id)} className="border-b border-gray-700">
                <td className="px-4 py-3">{doc.original_name as string ?? doc.file_name as string}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs ${doc.ingestion_status === 'completed' ? 'text-green-400' : doc.ingestion_status === 'failed' ? 'text-red-400' : 'text-yellow-400'}`}>
                    {doc.ingestion_status as string}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {new Date(doc.created_at as string).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!docsQuery.data?.documents?.length && (
              <tr><td colSpan={3} className="px-4 py-6 text-center text-gray-500">No documents uploaded.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
