"""Local PII redaction — runs inside user's process before data leaves the app.

Two tiers:
  - MASK  → value replaced with '[REDACTED]'. Not searchable.
  - HASH  → '#<hmac16>'. Searchable, keyed with account api_key.
"""

import hashlib
import hmac
from typing import Any, Dict, List, Optional

REDACTED = "[REDACTED]"

DENY_HEADERS = {
    "authorization", "cookie", "set-cookie", "x-api-key",
    "proxy-authorization",
}

DEFAULT_DENY_KEYS = [
    "password", "passwd", "secret", "token", "apikey", "api_key",
    "authorization", "cookie", "credit_card", "card_number", "cardnumber",
    "cvv", "cvc", "ssn", "pin", "private_key", "access_token", "refresh_token",
]

DEFAULT_HASH_KEYS = ["email", "phone", "nik", "passport"]

DEFAULT_PARTIAL_KEYS: List[str] = []

MAX_DEPTH = 8


def _matches(key: str, patterns: List[str]) -> bool:
    k = key.lower()
    return any(p in k for p in patterns)


def hash_value(value: Any, secret: str) -> str:
    """Deterministic keyed hash: '#' + first 16 hex of HMAC-SHA256."""
    norm = str(value).strip().lower()
    h = hmac.new(secret.encode("utf-8"), norm.encode("utf-8"), hashlib.sha256)
    return "#" + h.hexdigest()[:16]


def partial_mask(value: Any) -> str:
    """Partially mask: b***@gmail.com or ****89."""
    s = str(value)
    at = s.find("@")
    if at > 0:
        local = s[:at]
        domain = s[at:]
        head = local[0] if local else "x"
        return f"{head}***{domain}"
    if len(s) <= 2:
        return "***"
    return "***" + s[-2:]


def redact_body(
    value: Any,
    opts: Optional[Dict] = None,
    depth: int = 0,
) -> Any:
    """Deep-clone `value`, masking secrets and hashing searchable PII."""
    if opts is None:
        opts = {}

    deny_keys = opts.get("denyKeys") or DEFAULT_DENY_KEYS
    hash_keys = opts.get("hashKeys") or DEFAULT_HASH_KEYS
    partial_keys = opts.get("partialKeys") or DEFAULT_PARTIAL_KEYS
    hash_secret = opts.get("hashSecret")

    if depth > MAX_DEPTH or value is None:
        return value

    if isinstance(value, list):
        return [redact_body(v, opts, depth + 1) for v in value]

    if isinstance(value, dict):
        out = {}
        for k, v in value.items():
            is_primitive = isinstance(v, (str, int, float, bool, type(None)))
            if _matches(k, deny_keys):
                out[k] = REDACTED
            elif _matches(k, partial_keys):
                out[k] = partial_mask(v) if is_primitive else redact_body(v, opts, depth + 1)
            elif _matches(k, hash_keys):
                if hash_secret and is_primitive:
                    out[k] = hash_value(v, hash_secret)
                elif is_primitive:
                    out[k] = REDACTED
                else:
                    out[k] = redact_body(v, opts, depth + 1)
            else:
                out[k] = redact_body(v, opts, depth + 1)
        return out

    return value


def redact_headers(headers: Dict[str, Any]) -> Dict[str, Any]:
    """Redact sensitive headers in-place."""
    if not headers:
        return {}
    return {
        k: REDACTED if k.lower() in DENY_HEADERS else v
        for k, v in headers.items()
    }
