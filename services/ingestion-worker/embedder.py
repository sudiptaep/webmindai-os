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


def embed_chunks(chunks: list[dict], text_key: str = "text") -> list[dict]:
    """
    Add "embedding" list[float] to each chunk dict. Returns same list mutated.
    Batches requests to stay within OpenAI rate limits.

    text_key selects which field gets embedded — pass "embedding_text" for
    contextualised chunks (F-19-A) so the context prefix is embedded but the
    LLM still sees only the original text at generation time.
    """
    client = _get_client()
    texts = [c[text_key] for c in chunks]

    all_embeddings: list[list[float]] = []
    for i in range(0, len(texts), EMBED_BATCH_SIZE):
        batch = texts[i : i + EMBED_BATCH_SIZE]
        response = client.embeddings.create(model=EMBEDDING_MODEL, input=batch)
        # API guarantees same order as input
        all_embeddings.extend([item.embedding for item in response.data])

    for chunk, embedding in zip(chunks, all_embeddings):
        chunk["embedding"] = embedding

    return chunks
