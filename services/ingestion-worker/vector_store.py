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


def upsert_image_vector(
    image_asset_id: str,
    doc_id: str,
    college_id: str,
    dept_id: str,
    subject_id: str | None,
    source_page: int,
    embedding: list[float],
    vision_result: dict,
    doc_filename: str,
    academic_year: str,
) -> str:
    """
    Upsert one image description vector into the same namespace as text chunks.
    Distinguished from text chunks via metadata.chunk_type == "image".
    """
    pc = _get_client()
    index = pc.Index(os.environ["PINECONE_INDEX_NAME"])
    namespace = build_namespace(college_id, dept_id)
    vector_id = f"{doc_id}_img_{image_asset_id}"

    metadata = {
        "doc_id": doc_id,
        "college_id": college_id,
        "dept_id": dept_id,
        "subject_id": subject_id or "",
        "filename": doc_filename,
        "page_num": source_page,
        "academic_year": academic_year,
        "chunk_type": "image",
        "image_asset_id": image_asset_id,
        "image_type": vision_result.get("image_type", "other"),
        "caption": (vision_result.get("caption") or "")[:200],
        "labels": ", ".join(vision_result.get("labels_extracted", []))[:300],
        "alt_text": (vision_result.get("alt_text") or "")[:200],
        "text": vision_result.get("description", ""),
    }

    index.upsert(vectors=[{"id": vector_id, "values": embedding, "metadata": metadata}], namespace=namespace)
    return vector_id


def delete_doc_vectors(college_id: str, dept_id: str, doc_id: str) -> None:
    """Delete all vectors for a document (used during reingest)."""
    pc = _get_client()
    index = pc.Index(os.environ["PINECONE_INDEX_NAME"])
    namespace = build_namespace(college_id, dept_id)
    # Pinecone delete by prefix filter (metadata filter on doc_id)
    index.delete(filter={"doc_id": {"$eq": doc_id}}, namespace=namespace)
