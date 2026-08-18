import os
from pinecone import Pinecone

UPSERT_BATCH_SIZE = 100
DELETE_BATCH_SIZE = 1000
EMBEDDING_DIMS = 1536  # text-embedding-3-small

_pc: Pinecone | None = None
_index = None


def _get_client() -> Pinecone:
    global _pc
    if _pc is None:
        _pc = Pinecone(api_key=os.environ["PINECONE_API_KEY"])
    return _pc


def _get_index():
    """Cached index handle. pc.Index() re-runs plugin discovery each call — caching it
    avoids thousands of redundant discoveries (and log spam) during bulk image upserts."""
    global _index
    if _index is None:
        _index = _get_client().Index(os.environ["PINECONE_INDEX_NAME"])
    return _index


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

    index = _get_index()
    namespace = build_namespace(college_id, dept_id)

    vectors = [
        {
            "id": f"{doc_id}_{i}",
            "values": chunk["embedding"],
            # F-19-F: present only when this department has a fitted BM25
            # encoder (see bm25_encoder.py) — upserting sparse_values requires
            # the Pinecone index to support them (dotproduct-metric/sparse
            # index); omitted entirely otherwise so dense-only upserts are
            # unaffected.
            **({"sparse_values": chunk["sparse_values"]} if chunk.get("sparse_values") else {}),
            "metadata": {
                **{k: v for k, v in chunk["metadata"].items()},
                # F-19-A: store the UNPREFIXED text — this is what the LLM sees
                # at generation time. The embedding above was computed from
                # embedding_text (prefix + text); the prefix itself is not
                # persisted here, only context_prefix in metadata for debugging.
                "text": chunk.get("original_text", chunk["text"]),
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
    index = _get_index()
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
    """Delete ALL vectors for a document — used when a document is removed
    entirely, not for re-ingestion (see delete_stale_doc_vectors for that)."""
    index = _get_index()
    namespace = build_namespace(college_id, dept_id)
    index.delete(filter={"doc_id": {"$eq": doc_id}}, namespace=namespace)


def get_doc_vector_ids(college_id: str, dept_id: str, doc_id: str) -> set[str]:
    """All text-chunk vector IDs currently indexed for this document. Used by
    re-ingestion (F-19 Step 9) to find vectors that existed under the OLD
    pipeline (e.g. more chunks than the new hierarchical chunker produces)
    and no longer have a corresponding new vector."""
    index = _get_index()
    namespace = build_namespace(college_id, dept_id)
    zero = [0.0] * EMBEDDING_DIMS
    ids: set[str] = set()
    result = index.query(
        vector=zero,
        top_k=10_000,
        filter={"doc_id": {"$eq": doc_id}, "chunk_type": {"$ne": "image"}},
        include_values=False,
        include_metadata=False,
        namespace=namespace,
    )
    for match in getattr(result, "matches", None) or []:
        ids.add(match.id if hasattr(match, "id") else match["id"])
    return ids


def delete_vector_ids(college_id: str, dept_id: str, ids: set[str]) -> None:
    """Deletes specific vector IDs by id (not a metadata filter) — used to
    clean up stale re-ingestion leftovers after the new vectors are confirmed
    upserted, so retrieval is never briefly missing content mid-reingest."""
    if not ids:
        return
    index = _get_index()
    namespace = build_namespace(college_id, dept_id)
    id_list = list(ids)
    for i in range(0, len(id_list), DELETE_BATCH_SIZE):
        index.delete(ids=id_list[i : i + DELETE_BATCH_SIZE], namespace=namespace)
