"""SHA-256 of a computer run's token ids.

The bytes are the ids in generation order, each a uint32 little-endian.
The terminal -1 (Qwen's turn) is not an id in the run. Echoed text token
ids are included: the computer emits them.
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Iterable, Optional

import numpy as np


def trace_sha256(ids: Iterable[int]) -> str:
    vals = [int(t) for t in ids]
    if any(t < 0 or t > 0xFFFFFFFF for t in vals):
        raise ValueError("a trace token id is a uint32")
    raw = np.asarray(vals, dtype="<u4").tobytes()
    return hashlib.sha256(raw).hexdigest()


def file_sha256(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pack_ids(pack: Path) -> dict:
    """The firmware ELF and chip weight hashes of a chip pack directory."""
    return {
        "firmware_elf_sha256": file_sha256(pack / "eth-bridge.elf"),
        "chip_weights_sha256": file_sha256(pack / "chip.safetensors"),
    }
