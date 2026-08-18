"""
F-19-F: Contextual BM25 sparse encoding, one encoder fitted per department.

pinecone-text's BM25Encoder does the real work (tokenize/stem/stopword-strip,
mmh3-hash terms to sparse indices, IDF from corpus doc-frequency). This module
is just persistence (fit once, dump to disk, load+cache for reuse) — fitting
requires the WHOLE department corpus, so it happens as its own admin-triggered
step (see main.py /bm25/fit), never inline during a single document's ingest.

Query-time encoding (encode_queries) must use the exact same fitted encoder
that indexed the chunks, and lives here too — exposed over HTTP (see main.py
/bm25/encode-query) because retrieval happens in the Node API, not Python.
Reimplementing the tokenizer+hash in TypeScript would risk a silent mismatch
where indices no longer line up with what's stored in Pinecone.
"""
import os

from pinecone_text.sparse import BM25Encoder

STORAGE_ROOT = (
    os.environ.get("STORAGE_ROOT")
    or os.environ.get("UPLOADS_DIR")
    or os.path.join(os.getcwd(), "uploads")
)

_encoder_cache: dict[str, BM25Encoder] = {}


def _encoder_path(college_id: str, dept_id: str) -> str:
    return os.path.join(STORAGE_ROOT, "colleges", college_id, "bm25", f"{dept_id}.json")


def has_encoder(college_id: str, dept_id: str) -> bool:
    return os.path.exists(_encoder_path(college_id, dept_id))


def load_encoder(college_id: str, dept_id: str) -> BM25Encoder | None:
    path = _encoder_path(college_id, dept_id)
    if not os.path.exists(path):
        return None
    if path not in _encoder_cache:
        enc = BM25Encoder()
        enc.load(path)
        _encoder_cache[path] = enc
    return _encoder_cache[path]


def fit_and_save(college_id: str, dept_id: str, corpus_texts: list[str]) -> dict:
    """Fits a fresh encoder on the given corpus and persists it, replacing any
    previous encoder for this department. Refitting invalidates term→index
    mappings for anything indexed under the old encoder — F-19-F only stays
    correct if a refit is followed by re-ingesting the department's documents
    (same requirement as Step 9's re-ingestion pass)."""
    if not corpus_texts:
        raise ValueError("corpus_texts must be non-empty to fit a BM25 encoder")

    enc = BM25Encoder()
    enc.fit(corpus_texts)

    path = _encoder_path(college_id, dept_id)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    enc.dump(path)
    _encoder_cache[path] = enc

    return {"encoder_path": path, "corpus_size": len(corpus_texts)}


def encode_document(college_id: str, dept_id: str, text: str) -> dict | None:
    """Returns {"indices": [...], "values": [...]} or None if no encoder is fitted yet."""
    enc = load_encoder(college_id, dept_id)
    return enc.encode_documents(text) if enc else None


def encode_query(college_id: str, dept_id: str, text: str) -> dict | None:
    enc = load_encoder(college_id, dept_id)
    return enc.encode_queries(text) if enc else None
