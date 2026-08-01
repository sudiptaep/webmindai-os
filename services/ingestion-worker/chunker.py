import re

from langchain_text_splitters import RecursiveCharacterTextSplitter
import tiktoken

CHUNK_SIZE_TOKENS = 512
CHUNK_OVERLAP_TOKENS = 50
CHUNK_SIZE_FLEX = 1.3  # allow chunks up to 30% over target before forcing a split

_enc = tiktoken.get_encoding("cl100k_base")

_HEADING_RE = re.compile(
    r"^\s*(#{1,6}\s+\S.{0,78}|\d+(\.\d+)*\.?\s+[A-Z]\S.{0,78}|[A-Z][A-Z0-9 ,&-]{3,78})\s*$"
)
_SENTENCE_SPLIT_RE = re.compile(r"(?<=[.!?])\s+")


def _token_len(text: str) -> int:
    return len(_enc.encode(text))


# Fallback splitter for any single natural segment that's still too large
# (e.g. a huge unbroken paragraph) — same behaviour as the old flat chunker.
_fallback_splitter = RecursiveCharacterTextSplitter(
    chunk_size=CHUNK_SIZE_TOKENS,
    chunk_overlap=CHUNK_OVERLAP_TOKENS,
    length_function=_token_len,
    separators=["\n\n", "\n", ". ", " ", ""],
)


def _split_into_segments(text: str) -> list[str]:
    """
    Splits page text at natural boundaries — paragraph breaks and detected
    heading lines — rather than at a raw token count. Headings become their
    own segment boundary so they don't get buried mid-chunk.
    """
    paragraphs = re.split(r"\n\s*\n", text)
    segments: list[str] = []

    for para in paragraphs:
        lines = para.split("\n")
        current: list[str] = []
        for line in lines:
            if _HEADING_RE.match(line) and current:
                segments.append("\n".join(current))
                current = [line]
            else:
                current.append(line)
        if current:
            segments.append("\n".join(current))

    return [s for s in segments if s.strip()]


def _sentence_aware_overlap(prev_chunk: str, overlap_tokens: int) -> str:
    """Takes trailing sentences from prev_chunk totalling ~overlap_tokens, not a raw token slice."""
    sentences = _SENTENCE_SPLIT_RE.split(prev_chunk.strip())
    overlap_parts: list[str] = []
    token_count = 0
    for sentence in reversed(sentences):
        sentence_tokens = _token_len(sentence)
        if token_count + sentence_tokens > overlap_tokens and overlap_parts:
            break
        overlap_parts.insert(0, sentence)
        token_count += sentence_tokens
    return " ".join(overlap_parts)


def semantic_chunk(page_text: str, target_size: int = CHUNK_SIZE_TOKENS, overlap: int = CHUNK_OVERLAP_TOKENS) -> list[str]:
    """
    Heading/paragraph-boundary-aware chunking. Falls back to raw token-count
    splitting only for individual segments that are themselves oversized.
    """
    segments = _split_into_segments(page_text)
    max_tokens = target_size * CHUNK_SIZE_FLEX

    raw_chunks: list[str] = []
    current = ""
    for segment in segments:
        if _token_len(segment) > max_tokens:
            if current.strip():
                raw_chunks.append(current)
                current = ""
            raw_chunks.extend(_fallback_splitter.split_text(segment))
            continue

        candidate = f"{current}\n\n{segment}" if current else segment
        if _token_len(candidate) <= max_tokens:
            current = candidate
        else:
            if current.strip():
                raw_chunks.append(current)
            current = segment

    if current.strip():
        raw_chunks.append(current)

    if not raw_chunks:
        return []

    # Sentence-aware overlap between adjacent chunks
    overlapped = [raw_chunks[0]]
    for i in range(1, len(raw_chunks)):
        prefix = _sentence_aware_overlap(raw_chunks[i - 1], overlap)
        overlapped.append(f"{prefix} {raw_chunks[i]}".strip() if prefix else raw_chunks[i])

    return overlapped


def chunk_texts(texts: list[str], base_metadata: dict) -> list[dict]:
    """
    Split list of text sections into semantically-bounded chunks with metadata.
    Returns list of {"text": str, "metadata": dict}.
    """
    chunks: list[dict] = []
    for section_idx, text in enumerate(texts):
        if not text.strip():
            continue
        parts = semantic_chunk(text)
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
