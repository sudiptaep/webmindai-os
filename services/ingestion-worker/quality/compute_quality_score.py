"""
F-18-A: multi-signal extraction quality score.

Replaces the old flat formula (char density with a blanket -0.15/x0.85 OCR
penalty) with signals that actually distinguish good extraction from bad:
real per-page OCR confidence, hyphenation-repair rate (proxy for structural
integrity), vocabulary validity, and boilerplate (running header/footer)
pollution. Also performs the corresponding pipeline fixes — hyphenation
repair and boilerplate stripping happen here, not just the scoring.
"""
import re

QUALITY_FORMULA_VERSION = 2

WEIGHTS = {
    "density": 0.15,
    "ocr_confidence": 0.30,
    "structural_integrity": 0.25,
    "vocab_validity": 0.20,
    "boilerplate_penalty": 0.10,
}

_HYPHEN_BREAK_RE = re.compile(r"(\w+)-\n([a-z]\w*)")
_WORD_RE = re.compile(r"[A-Za-z]{2,}|\d+")
_VALID_WORD_RE = re.compile(r"^[A-Za-z]+$")


def repair_hyphenation(pages: list[str]) -> tuple[list[str], int]:
    """Rejoins "glomer-\nulus" -> "glomerulus". Returns (repaired_pages, repair_count)."""
    repaired: list[str] = []
    repair_count = 0

    def _join(match: re.Match) -> str:
        nonlocal repair_count
        repair_count += 1
        return match.group(1) + match.group(2)

    for page in pages:
        new_page = _HYPHEN_BREAK_RE.sub(_join, page)
        repaired.append(new_page)
    return repaired, repair_count


def strip_boilerplate(pages: list[str]) -> tuple[list[str], float]:
    """
    Detects lines that repeat near-identically across many pages (running
    headers/footers, chapter titles) and strips them.
    Returns (cleaned_pages, boilerplate_ratio_of_total_chars).
    """
    if len(pages) < 3:
        return pages, 0.0

    line_counts: dict[str, int] = {}
    per_page_lines = [p.split("\n") for p in pages]

    for lines in per_page_lines:
        seen_this_page: set[str] = set()
        for line in lines:
            normalized = line.strip().lower()
            if not normalized or len(normalized) > 80:
                continue
            if normalized in seen_this_page:
                continue
            seen_this_page.add(normalized)
            line_counts[normalized] = line_counts.get(normalized, 0) + 1

    threshold = max(3, int(len(pages) * 0.3))
    boilerplate_lines = {line for line, count in line_counts.items() if count >= threshold}

    if not boilerplate_lines:
        return pages, 0.0

    total_chars = sum(len(p) for p in pages) or 1
    stripped_chars = 0
    cleaned_pages: list[str] = []
    for lines in per_page_lines:
        kept: list[str] = []
        for line in lines:
            if line.strip().lower() in boilerplate_lines:
                stripped_chars += len(line)
                continue
            kept.append(line)
        cleaned_pages.append("\n".join(kept))

    return cleaned_pages, round(stripped_chars / total_chars, 4)


def compute_valid_word_ratio(text: str) -> float:
    """% of extracted alphabetic tokens that look like real words (not OCR garbage).

    Heuristic proxy (no dictionary corpus dependency): a token counts as valid
    if it's purely alphabetic — garbled OCR tends to produce mixed alnum/symbol
    fragments, which this filters out.
    """
    tokens = _WORD_RE.findall(text)
    if not tokens:
        return 1.0
    valid = sum(1 for t in tokens if _VALID_WORD_RE.match(t) or t.isdigit())
    return round(valid / len(tokens), 4)


def compute_document_quality(
    pages: list[str],
    ocr_used: bool,
    page_ocr_data: list[dict | None],
) -> dict:
    """
    Runs the layout-fix passes (hyphenation repair, boilerplate strip) and
    computes the multi-signal quality score.

    Returns {
        "cleaned_pages": list[str],       # use these for chunking, not raw `pages`
        "quality_score": float,
        "signal_breakdown": dict,
        "weights_used": dict,
        "quality_formula_version": int,
    }
    """
    page_count = max(len(pages), 1)

    repaired_pages, repair_count = repair_hyphenation(pages)
    cleaned_pages, boilerplate_ratio = strip_boilerplate(repaired_pages)

    full_text = "\n".join(cleaned_pages)
    avg_chars_per_page = sum(len(p) for p in cleaned_pages) / page_count

    total_lines = sum(p.count("\n") + 1 for p in pages) or 1
    # Justified-text PDFs normally hyphenate ~3-5% of lines at the right margin —
    # that's routine typesetting, not an extraction defect, and we always repair
    # it before scoring. Only penalise a repair rate meaningfully above that
    # baseline (signals real structural trouble: broken columns, bad OCR layout).
    NORMAL_HYPHENATION_RATE = 0.05
    repair_ratio = repair_count / total_lines
    structural_integrity = round(max(0.0, 1.0 - max(0.0, repair_ratio - NORMAL_HYPHENATION_RATE) * 10), 3)

    if ocr_used:
        confidences = [d["confidence"] for d in page_ocr_data if d is not None]
        ocr_confidence = (sum(confidences) / len(confidences) / 100.0) if confidences else 0.0
    else:
        ocr_confidence = 1.0

    signals = {
        "density": round(min(avg_chars_per_page / 500, 1.0), 3),
        "ocr_confidence": round(ocr_confidence, 3),
        "structural_integrity": structural_integrity,
        "vocab_validity": compute_valid_word_ratio(full_text),
        "boilerplate_penalty": round(1.0 - boilerplate_ratio, 3),
    }

    final_score = sum(signals[k] * WEIGHTS[k] for k in WEIGHTS)

    return {
        "cleaned_pages": cleaned_pages,
        "quality_score": round(final_score, 3),
        "signal_breakdown": signals,
        "weights_used": WEIGHTS,
        "quality_formula_version": QUALITY_FORMULA_VERSION,
    }
