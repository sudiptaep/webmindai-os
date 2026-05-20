from langchain_text_splitters import RecursiveCharacterTextSplitter
import tiktoken

CHUNK_SIZE_TOKENS = 512
CHUNK_OVERLAP_TOKENS = 50

_enc = tiktoken.get_encoding("cl100k_base")


def _token_len(text: str) -> int:
    return len(_enc.encode(text))


_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE_TOKENS,
    chunk_overlap=CHUNK_OVERLAP_TOKENS,
    length_function=_token_len,
    separators=["\n\n", "\n", ". ", " ", ""],
)


def chunk_texts(texts: list[str], base_metadata: dict) -> list[dict]:
    """
    Split list of text sections into token-bounded chunks with metadata.
    Returns list of {"text": str, "metadata": dict}.
    """
    chunks: list[dict] = []
    for section_idx, text in enumerate(texts):
        if not text.strip():
            continue
        parts = _splitter.split_text(text)
        for chunk_idx, part in enumerate(parts):
            if not part.strip():
                continue
            chunks.append({
                "text": part,
                "metadata": {
                    **base_metadata,
                    "section_index": section_idx,
                    "page_num":      section_idx + 1,  # 1-based, matches chapter start/end_page
                    "chunk_index":   chunk_idx,
                },
            })
    return chunks


def compute_quality_score(chunks: list[dict], ocr_used: bool) -> float:
    if not chunks:
        return 0.0

    avg_tokens = sum(_token_len(c["text"]) for c in chunks) / len(chunks)
    text_score = min(1.0, avg_tokens / CHUNK_SIZE_TOKENS)
    count_score = min(1.0, len(chunks) / 20)
    base = 0.5 * text_score + 0.5 * count_score
    ocr_penalty = 0.15 if ocr_used else 0.0
    return round(max(0.0, min(1.0, base - ocr_penalty)), 3)
