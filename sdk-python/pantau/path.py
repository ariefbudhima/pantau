"""Path normalization — replace dynamic segments (ids, uuids) with :id."""

import re

UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
HEX24_RE = re.compile(r"^[0-9a-f]{24}$", re.I)      # Mongo ObjectId
LONGHEX_RE = re.compile(r"^[0-9a-f]{16,}$", re.I)
DIGIT_RE = re.compile(r"^\d+$")


def normalize_path(path: str) -> str:
    """Replace dynamic path segments (numeric ids, uuids, hashes) with :id."""
    segments = [s for s in path.split("/") if s]
    normalized = [
        ":id" if _is_dynamic(seg) else seg
        for seg in segments
    ]
    return "/" + "/".join(normalized)


def _is_dynamic(seg: str) -> bool:
    return bool(
        DIGIT_RE.match(seg)
        or UUID_RE.match(seg)
        or HEX24_RE.match(seg)
        or LONGHEX_RE.match(seg)
    )
