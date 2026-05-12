import os
from pinecone import Pinecone

UPSERT_BATCH_SIZE = 100

_pc: Pinecone | None = None


def _get_client() -> Pinecone:
    global _pc
    if _pc is None:
        _pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
    return _pc


def build_namespace(college_id: str, dept_id: str) -> str:
    return f"c_{college_id}_d_{dept_id}"


def upsert_chunks(
    chunks: list[dict],
    college_id: str,
    dept_id: str,
    doc_id: str,
) -> int:
    """
    Upsert embedded chunks to Pinecone. Returns count of vectors upserted.
    Each chunk must have "embedding" and "text" keys.
    """
    if not chunks:
        return 0

    pc = _get_client()
    index = pc.Index(os.environ["PINECONE_INDEX_NAME"])
    namespace = build_namespace(college_id, dept_id)

    vectors = [
        {
            "id": f"{doc_id}_{i}",
            "values": chunk["embedding"],
            "metadata": {
                **{k: v for k, v in chunk["metadata"].items()},
                "text": chunk["text"],
                "doc_id": doc_id,
                "college_id": college_id,
                "dept_id": dept_id,
            },
        }
        for i, chunk in enumerate(chunks)
    ]

    for i in range(0, len(vectors), UPSERT_BATCH_SIZE):
        batch = vectors[i : i + UPSERT_BATCH_SIZE]
        index.upsert(vectors=batch, namespace=namespace)

    return len(vectors)


def delete_doc_vectors(college_id: str, dept_id: str, doc_id: str) -> None:
    """Delete all vectors for a document (used during reingest)."""
    pc = _get_client()
    index = pc.Index(os.environ["PINECONE_INDEX_NAME"])
    namespace = build_namespace(college_id, dept_id)
    # Pinecone delete by prefix filter (metadata filter on doc_id)
    index.delete(filter={"doc_id": {"$eq": doc_id}}, namespace=namespace)
