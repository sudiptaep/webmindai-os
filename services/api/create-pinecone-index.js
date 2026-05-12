// Run once: node create-pinecone-index.js
require('dotenv').config();
const { Pinecone } = require('@pinecone-database/pinecone');

async function main() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  const indexName = process.env.PINECONE_INDEX_NAME ?? 'college-chatbot';

  const { indexes } = await pc.listIndexes();
  const exists = (indexes ?? []).some((i) => i.name === indexName);

  if (exists) {
    console.log(`Index "${indexName}" already exists.`);
    return;
  }

  console.log(`Creating index "${indexName}"...`);
  await pc.createIndex({
    name: indexName,
    dimension: 1536,
    metric: 'cosine',
    spec: {
      serverless: {
        cloud: 'aws',
        region: 'us-east-1',
      },
    },
  });

  // Wait for ready
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const desc = await pc.describeIndex(indexName);
    console.log(`Status: ${desc.status?.state}`);
    if (desc.status?.ready) {
      console.log('Index ready.');
      return;
    }
  }
  console.log('Index creation initiated. May still be initializing.');
}

main().catch((e) => { console.error(e); process.exit(1); });
