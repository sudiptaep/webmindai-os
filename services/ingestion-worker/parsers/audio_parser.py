"""
Audio/video parser using OpenAI Whisper API.
Video files (mp4, mkv): ffmpeg extracts audio track first.
Audio files (mp3, m4a): sent directly.
"""
import os
import subprocess
import tempfile
from openai import OpenAI

_client: OpenAI | None = None

# Whisper API max file size is 25 MB — large files need chunking
WHISPER_MAX_BYTES = 24 * 1024 * 1024


def _get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


def _extract_audio(video_path: str) -> str:
    """Extract audio from video file to a temp mp3. Returns path (caller must delete)."""
    fd, audio_path = tempfile.mkstemp(suffix=".mp3")
    os.close(fd)
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn",
            "-acodec", "libmp3lame",
            "-q:a", "4",
            audio_path,
        ],
        check=True,
        capture_output=True,
    )
    return audio_path


def _transcribe(audio_path: str) -> tuple[list[str], list[dict]]:
    """
    Transcribe audio via OpenAI Whisper API.
    Returns (segment_texts, timing_segments).
    timing_segments: [{"start_sec": float, "end_sec": float, "text": str}]
    """
    client = _get_client()
    with open(audio_path, "rb") as f:
        transcript = client.audio.transcriptions.create(
            model="whisper-1",
            file=f,
            response_format="verbose_json",
        )

    texts: list[str] = []
    timing: list[dict] = []

    if hasattr(transcript, "segments") and transcript.segments:
        for seg in transcript.segments:
            text = seg.text.strip() if hasattr(seg, "text") else ""
            if text:
                texts.append(text)
                timing.append({
                    "start_sec": float(getattr(seg, "start", 0)),
                    "end_sec":   float(getattr(seg, "end",   0)),
                    "text":      text,
                })
    elif hasattr(transcript, "text") and transcript.text:
        # Fallback: no timing available from non-verbose response
        texts = [s.strip() for s in transcript.text.split(". ") if s.strip()]

    return texts, timing


def parse_audio(path: str, file_type: str) -> tuple[list[str], bool]:
    """
    Returns (segments: list[str], ocr_used=False).
    Handles mp3, m4a (direct), mp4, mkv (audio extraction via ffmpeg).
    """
    audio_path = path
    extracted = False

    if file_type in ("mp4", "mkv"):
        audio_path = _extract_audio(path)
        extracted = True

    try:
        texts, _timing = _transcribe(audio_path)
    finally:
        if extracted and os.path.exists(audio_path):
            os.unlink(audio_path)

    return texts, False


def parse_audio_verbose(
    path: str, file_type: str
) -> tuple[list[str], list[dict], bool]:
    """
    Returns (segment_texts, timing_segments, ocr_used=False).
    timing_segments: [{"start_sec": float, "end_sec": float, "text": str}]
    Used by the ingestion pipeline to build transcript JSON for F-11.
    """
    audio_path = path
    extracted = False

    if file_type in ("mp4", "mkv"):
        audio_path = _extract_audio(path)
        extracted = True

    try:
        texts, timing = _transcribe(audio_path)
    finally:
        if extracted and os.path.exists(audio_path):
            os.unlink(audio_path)

    return texts, timing, False
