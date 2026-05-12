import mongoose from "mongoose";

let connected = false;

export async function connectPlatformDb(): Promise<void> {
  if (connected) return;
  const uri = process.env.MONGO_PLATFORM_URI;
  if (!uri) throw new Error("MONGO_PLATFORM_URI is not set");
  await mongoose.connect(uri, { dbName: "platform" });
  connected = true;
}

export function getPlatformDb(): mongoose.Connection {
  return mongoose.connection;
}
