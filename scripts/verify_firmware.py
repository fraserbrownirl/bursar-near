"""Check the committed ELF, then run it on one receipt.

The machine is chipformer's RV32IM reference (`ref.Machine`), vendored in
`vendor/` (see vendor/README.md). One-time setup:

    npm run setup:verify

LOADED_SHA256 is the SHA-256 of the pinned ELF's loadable segments.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from pathlib import Path

LOADED_SHA256 = "e3c2f204f05f45986fdbfaffb9e464cb99dd23dd7aabfae6079af8c6a7da32f5"

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

ELF = ROOT / "firmware" / "eth-bridge.elf"
README = ROOT / "firmware" / "README.md"
INSTALL = "npm run setup:verify"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def pin() -> str:
    text = README.read_text()
    match = re.search(r"\| SHA-256 \| `([0-9a-f]{64})` \|", text)
    if not match:
        raise SystemExit("firmware/README.md has no SHA-256 pin")
    return match.group(1)


def firmware_src() -> Path:
    env = os.environ.get("BURSAR_FIRMWARE_SRC")
    if env:
        return Path(env)
    vendored = ROOT / "vendor"
    if (vendored / "chipformer").is_dir():
        return vendored
    raise SystemExit(INSTALL)


def receipt(digest: str) -> dict:
    path = ROOT / "receipts" / f"{digest}.json"
    if not path.is_file():
        raise SystemExit(f"no receipt {digest}")
    return json.loads(path.read_text())


def receipt_files(row: dict) -> dict[str, str]:
    folder = ROOT / "receipts" / "inputs"
    files = {}
    for name, want in (row.get("inputs") or {}).items():
        hashed = folder / want
        named = folder / name
        path = hashed if hashed.is_file() else named
        if not path.is_file():
            raise SystemExit(f"missing input {want}")
        files[name] = path.read_text()
    return files


def emulate(cmd: str, elf_path: Path, v0: int, files: dict[str, str] | None = None) -> dict:
    mac = ethereus_mac()
    sys.path.insert(0, str(mac))
    src = firmware_src()
    if str(src) not in sys.path:
        sys.path.append(str(src))
    os.environ.setdefault("LOCALS_CHIPFORMER", str(src))
    try:
        import copy
        from chipformer.rv import bridge, elf, ref
        from chipformer.rv import spill as fw
        from chipformer.rv import spec as S
        from locals.models.eth_spill import plan
        from locals.models.tracehash import trace_sha256
    except ModuleNotFoundError:
        raise SystemExit(INSTALL) from None

    tok_path = tokenizer_path()
    text = bridge.Text(str(tok_path))
    files = files or {}

    def encode(value: str) -> list[int]:
        return text.encode(value)

    planned = plan(cmd, len(encode(fw.call_text(cmd))), files, encode)
    use = planned.files if planned else {}
    eth_in = planned.eth_in if planned else None
    shown = planned.short if planned and planned.short else cmd
    image = fw.firmware_with_files(elf_path, use, eth_in) if use or eth_in else elf_path
    machine = ref.Machine.from_program(elf.program(str(image)))
    bridge.park(machine)
    session = bridge.Session(text, copy.deepcopy(machine))
    prompt = text.encode(PROMPT)
    call = text.encode(tool_text(shown))
    session.history(prompt)
    start = len(session.toks)
    session.qwen(call)
    ids = [v0 + t if not S.is_text(t) else t - S.TEXT_TOKEN for t in session.toks[start + len(call):]]
    echo = text.decode_bytes([t for t in ids if t < v0]).decode()
    return {
        "output": output_of(echo),
        "trace_sha256": trace_sha256(ids),
    }


def chip_v0() -> int:
    local = Path.home() / ".locals" / "ethereus" / "all9b" / "chip.json"
    path = local if local.is_file() else pack_dir() / "chip.json"
    return int(json.loads(path.read_text())["chip_token_offset"])


def newer_python() -> str | None:
    candidates = [
        os.environ.get("BURSAR_PYTHON"),
        str(ROOT / ".venv-verify" / "bin" / "python"),
        str(ROOT.parent / "ethereus" / "experimental" / "riscv" / ".venv" / "bin" / "python"),
        str(ROOT.parent / "ethereus-mac" / ".venv" / "bin" / "python"),
    ]
    for path in candidates:
        if path and Path(path).is_file():
            return path
    return None


def main() -> int:
    if sys.version_info < (3, 11):
        nxt = newer_python()
        if not nxt:
            raise SystemExit(INSTALL)
        os.execv(nxt, [nxt, *sys.argv])
    hashes = [arg for arg in sys.argv[1:] if len(arg) == 64 and all(c in "0123456789abcdef" for c in arg)]
    if not hashes:
        print("usage: npm run verify:firmware -- <receipt-hash>")
        return 1
    if not ELF.is_file():
        print("missing firmware/eth-bridge.elf")
        return 1
    got = sha256_file(ELF)
    want = pin()
    print(f"{got} {'match' if got == want else 'MISMATCH'}")
    if got != want:
        return 1
    v0 = chip_v0()
    bad = 0
    for digest in hashes:
        row = receipt(digest)
        try:
            run = emulate(row["cmd"], ELF, v0, receipt_files(row))
        except SystemExit:
            raise
        ok = run["output"] == row["output"]
        bad += not ok
        print(f"{digest} {'match' if ok else 'MISMATCH'} {row['cmd']}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
