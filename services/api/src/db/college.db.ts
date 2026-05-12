import mongoose from "mongoose";

const connections = new Map<string, mongoose.Connection>();

export async function getCollegeDb(collegeId: string): Promise<mongoose.Connection> {
  const existing = connections.get(collegeId);
  if (existing && existing.readyState === 1) return existing;

  const baseUri = process.env.MONGO_BASE_URI;
  if (!baseUri) throw new Error("MONGO_BASE_URI is not set");

  const dbName = `cc_${collegeId.replace(/-/g, "").slice(0, 24)}`;
  const conn = mongoose.createConnection(`${baseUri}/${dbName}`);
  await conn.asPromise();
  connections.set(collegeId, conn);
  return conn;
}

export async function closeCollegeDb(collegeId: string): Promise<void> {
  const conn = connections.get(collegeId);
  if (conn) {
    await conn.close();
    connections.delete(collegeId);
  }
}

export async function closeAllCollegeDbs(): Promise<void> {
  await Promise.all([...connections.values()].map((c) => c.close()));
  connections.clear();
}
