import os
import shutil


def download_from_r2(r2_key: str) -> str:
    """
    r2_key is now a relative local path like:
    colleges/{college_id}/{dept_id}/{doc_id}/{filename}
    Returns the absolute local path (do NOT delete — file lives on disk).
    """
    uploads_root = os.environ.get("UPLOADS_DIR", os.path.join(os.getcwd(), "uploads"))
    # Normalize path separators (Windows paths may use backslash)
    local_path = os.path.normpath(os.path.join(uploads_root, r2_key))
    if not os.path.exists(local_path):
        raise FileNotFoundError(f"File not found: {local_path}")
    return local_path
