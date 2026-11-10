"""Build the bridge firmware, check it against the receipt ELF, and rerun each command.

The machine is chipformer's RV32IM reference (`ref.Machine`). A rebuild's
file SHA-256 differs from the pinned ELF in `.strtab` names the compiler
invents for temporary objects. The bytes in the loadable segments are the
program. Two rebuilds do not share a file SHA-256: gcc writes a fresh
temporary object name into `.strtab`. Those names are not loaded.
LOADED_SHA256 is the SHA-256 of the pinned ELF's loadable segments.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

LOADED_SHA256 = "e9324c1ef20faf5fa39e92abe1d5477abd111e90bb4dfac83465c954a6ff3f49"

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from computer_run import (  # noqa: E402
    PROMPT,
    ethereus_mac,
    output_of,
    pack_dir,
    tokenizer_path,
    tool_text,
)


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def firmware_src() -> Path:
    env = os.environ.get("BURSAR_FIRMWARE_SRC")
    if env:
        return Path(env)
    sibling = ROOT.parent / "ethereus" / "experimental" / "riscv"
    if (sibling / "chipformer" / "rv" / "env" / "eth" / "build_eth.sh").exists():
        return sibling
    raise SystemExit("set BURSAR_FIRMWARE_SRC to experimental/riscv of the firmware tree")


def pinned_elf(want: str) -> Path:
    env = os.environ.get("BURSAR_FIRMWARE_ELF")
    candidates = [Path(env)] if env else []
    candidates.append(pack_dir() / "eth-bridge.elf")
    candidates.append(firmware_src() / "tests" / "data" / "rv" / "eth-bridge.elf")
    for path in candidates:
        if path.is_file() and sha256_file(path) == want:
            return path
    raise SystemExit(f"no ELF with sha256 {want}")


def loadable(path: Path) -> bytes:
    text = subprocess.check_output(["riscv64-elf-readelf", "-l", str(path)], text=True)
    data = path.read_bytes()
    chunks = []
    for line in text.splitlines():
        match = re.match(r"\s+LOAD\s+0x([0-9a-f]+)\s+0x[0-9a-f]+\s+0x[0-9a-f]+\s+0x([0-9a-f]+)", line)
        if not match:
            continue
        off = int(match.group(1), 16)
        size = int(match.group(2), 16)
        chunks.append(data[off:off + size])
    if not chunks:
        raise SystemExit(f"no loadable segments in {path}")
    return b"".join(chunks)


def build() -> Path:
    src = firmware_src()
    py = os.environ.get("BURSAR_FIRMWARE_PYTHON") or str(src / ".venv" / "bin" / "python")
    if not Path(py).exists():
        raise SystemExit(f"firmware build python is missing: {py}")
    out = Path(tempfile.mkdtemp(prefix="bursar-fw-"))
    env = dict(os.environ)
    env["PYTHON"] = py
    script = src / "chipformer" / "rv" / "env" / "eth" / "build_eth.sh"
    subprocess.run([str(script), str(out), "eth-bridge", "--bridge"], check=True, env=env)
    return out / "eth-bridge.elf"


def receipts() -> list[tuple[str, dict]]:
    folder = ROOT / "receipts"
    rows = []
    for path in sorted(folder.glob("*.json")):
        if not re.fullmatch(r"[0-9a-f]{64}\.json", path.name):
            continue
        rows.append((path.name[:64], json.loads(path.read_text())))
    return rows


def emulate(cmd: str, elf_path: Path, v0: int) -> dict:
    mac = ethereus_mac()
    sys.path.insert(0, str(mac))
    src = firmware_src()
    if str(src) not in sys.path:
        sys.path.append(str(src))
    import copy
    from tokenizers import Tokenizer
    from chipformer.rv import bridge, elf, ref
    from chipformer.rv import spec as S
    from locals.models.tracehash import trace_sha256

    tok_path = tokenizer_path()
    text = bridge.Text(str(tok_path))
    machine = ref.Machine.from_program(elf.program(str(elf_path)))
    bridge.park(machine)
    session = bridge.Session(text, copy.deepcopy(machine))
    prompt = text.encode(PROMPT)
    call = text.encode(tool_text(cmd))
    session.history(prompt)
    start = len(session.toks)
    session.qwen(call)
    ids = [v0 + t if not S.is_text(t) else t - S.TEXT_TOKEN for t in session.toks[start + len(call):]]
    echo = text.decode_bytes([t for t in ids if t < v0]).decode()
    return {
        "output": output_of(echo),
        "trace_tokens": len(ids),
        "trace_sha256": trace_sha256(ids),
    }


def main() -> int:
    rows = receipts()
    if not rows:
        print("no receipts")
        return 1
    want = rows[0][1]["firmware_elf_sha256"]
    if any(row["firmware_elf_sha256"] != want for _, row in rows):
        print("MISMATCH firmware hash differs across receipts")
        return 1
    elf_path = pinned_elf(want)
    print(f"elf {sha256_file(elf_path)} {elf_path}")
    built = build()
    built_sha = sha256_file(built)
    built_image = loadable(built)
    pinned_image = loadable(elf_path)
    image_sha = hashlib.sha256(pinned_image).hexdigest()
    same_file = built_sha == want
    same_image = built_image == pinned_image and image_sha == LOADED_SHA256
    print(f"loaded {image_sha} {'match' if same_image else 'MISMATCH'}")
    print(f"built {built_sha} file {'match' if same_file else 'differs'}")
    if not same_image:
        return 1
    chip = json.loads((pack_dir() / "chip.json").read_text())
    v0 = int(chip["chip_token_offset"])
    bad = 0
    for digest, receipt in rows:
        got = emulate(receipt["cmd"], elf_path, v0)
        ok = got["output"] == receipt["output"] and got["trace_sha256"] == receipt["trace_sha256"]
        bad += not ok
        print(f"{digest} {'match' if ok else 'MISMATCH'} {receipt['cmd']}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
