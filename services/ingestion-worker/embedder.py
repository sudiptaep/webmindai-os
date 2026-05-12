import os
from openai import OpenAI

EMBEDDING_MODEL = "text-embedding-3-small"
EMBED_BATCH_SIZE = 100

_client: OpenAI | None = None


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def embed_chunks(chunks: list[dict]) -> list[dict]:
    """
    Add "embedding" list[float] to each chunk dict. Returns same list mutated.
    Batches requests to stay within OpenAI rate limits.
    """
    client = _get_client()
    texts = [c["text"] for c in chunks]

    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        # API guarantees same order as input
        all_embeddings.extend([item.embedding for item in response.data])

    for chunk, embedding in zip(chunks, all_embeddings):
        chunk["embedding"] = embedding

    return chunks
