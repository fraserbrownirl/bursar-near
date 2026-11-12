"""Run one eth command on the chip pack's computer, on CPU, without Qwen.

Prints one JSON object: output, trace_tokens, trace_sha256, wall_ms.
The trace is the token ids in generation order. The hash is SHA-256 of
those ids as uint32 little-endian, from locals.models.tracehash.
"""

from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def ethereus_mac() -> Path:
    """The directory the vendored `locals` package is imported from."""
    env = os.environ.get("BURSAR_ETHEREUS_MAC")
    if env:
        return Path(env)
    vendored = ROOT / "vendor"
    if (vendored / "locals" / "models" / "tracehash.py").exists():
        return vendored
    raise SystemExit("vendor/locals is missing; see vendor/README.md")


CHIP_SHA256 = "7d756fd40e9b6c4bd36ec3f4afea44f2d04d7269c27bc841e6f4aff96007a216"
CHIP_JSON_SHA256 = "21c2cbd6fa2f1a9c5fd85f28c92881423f0514ac69b3f3db2c1ab4951353f164"
SNAPSHOT_SHA256 = "24a41dcea12ebcea0294a0cd27b726cea5dbbe0abe6eb25f14c51c01ea87ade3"
ELF_SHA256 = "8cb34279eb5d0528800beebb618b750c52bbddd792f61742dd1b01480523a2be"
TOKENIZER_SHA256 = "87a7830d63fcf43bf241c3c5242e96e62dd3fdc29224ca26fed8ea333db72de4"
TOKENIZER_REPO = "mlx-community/Qwen3.5-9B-MLX-4bit"
TOKENIZER_REVISION = "938d8919941c6e7efd3c7150eff7fe9d12afa631"
HF_REPO = "frsrcom/bursar-9b"
HF_REVISION = "74eae8ef09d0d4508c60b17724a5c491bd0e3e68"


def _sha256(path: Path) -> str:
    import hashlib
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def pack_dir() -> Path:
    env = os.environ.get("BURSAR_CHIP_PACK")
    if env:
        return Path(env)
    from huggingface_hub import snapshot_download
    revision = os.environ.get("BURSAR_CHIP_HF_REVISION", HF_REVISION)
    got = snapshot_download(
        HF_REPO,
        revision=revision,
        allow_patterns=["chip.safetensors", "chip.json", "snapshot.safetensors", "eth-bridge.elf"],
    )
    return Path(got)


def pack_for(want_elf: str | None) -> Path:
    """The Hugging Face pack, with an ELF whose SHA-256 is `want_elf` when one is named."""
    pack = pack_dir()
    weights = pack / "chip.safetensors"
    if not weights.is_file():
        raise SystemExit(f"no chip.safetensors in {pack}")
    got = _sha256(weights)
    if got != CHIP_SHA256:
        raise SystemExit(f"weights {got} is not {CHIP_SHA256}")
    for name, want in (("chip.json", CHIP_JSON_SHA256), ("snapshot.safetensors", SNAPSHOT_SHA256)):
        path = pack / name
        if path.is_file():
            got = _sha256(path)
            if got != want:
                raise SystemExit(f"{name} {got} is not {want}")
    if not want_elf:
        return pack
    current = pack / "eth-bridge.elf"
    if current.is_file() and _sha256(current) == want_elf:
        return pack
    repo = ROOT / "firmware" / "eth-bridge.elf"
    if repo.is_file() and _sha256(repo) == want_elf:
        import tempfile
        tmp = Path(tempfile.mkdtemp(prefix="bursar-pack-"))
        os.symlink(weights, tmp / "chip.safetensors")
        os.symlink(pack / "chip.json", tmp / "chip.json")
        snapshot = pack / "snapshot.safetensors"
        if snapshot.is_file():
            os.symlink(snapshot, tmp / "snapshot.safetensors")
        os.symlink(repo, tmp / "eth-bridge.elf")
        return tmp
    raise SystemExit(f"no ELF with sha256 {want_elf}")


def tokenizer_path() -> Path:
    """Qwen3.5's tokenizer.json, downloaded from Hugging Face and checked against the pin."""
    env = os.environ.get("BURSAR_TOKENIZER")
    if env:
        path = Path(env)
        return path if path.name == "tokenizer.json" else path / "tokenizer.json"
    from huggingface_hub import hf_hub_download
    path = Path(hf_hub_download(TOKENIZER_REPO, "tokenizer.json", revision=TOKENIZER_REVISION))
    got = _sha256(path)
    if got != TOKENIZER_SHA256:
        raise SystemExit(f"tokenizer.json {got} is not {TOKENIZER_SHA256}")
    return path


def eth_src() -> Path:
    """config.json, chipformer.json and tokenizer.json in one folder.

    The two JSON files are committed under firmware/checkpoint/; the tokenizer
    is the pinned download. ETH_SRC overrides the folder for upstream work.
    """
    env = os.environ.get("ETH_SRC")
    if env:
        return Path(env)
    import tempfile
    tmp = Path(tempfile.mkdtemp(prefix="bursar-eth-src-"))
    committed = ROOT / "firmware" / "checkpoint"
    for name in ("config.json", "chipformer.json"):
        os.symlink(committed / name, tmp / name)
    os.symlink(tokenizer_path(), tmp / "tokenizer.json")
    return tmp


def tool_text(cmd: str) -> str:
    return ("<tool_call>\n<function=eth>\n"
            f"<parameter=cmd>\n{cmd}\n</parameter>\n"
            "</function>\n</tool_call>")


PROMPT = "<|im_start|>user\nDo it.<|im_end|>\n<|im_start|>assistant\n"


def output_of(echo: str) -> str:
    start = echo.find("<tool_response>\n")
    end = echo.find("\n</tool_response>")
    if start < 0 or end < start:
        return echo.strip()
    return echo[start + len("<tool_response>\n"):end].strip()


def run(cmd: str, files: dict[str, str] | None = None) -> dict:
    mac = ethereus_mac()
    sys.path.insert(0, str(mac))
    os.environ.setdefault("LOCALS_CHIPFORMER", str(ROOT / "vendor"))
    want_elf = os.environ.get("BURSAR_RECEIPT_ELF") or None
    pack = pack_for(want_elf)
    os.environ["LOCALS_ETH_PACK"] = str(pack)
    import torch
    torch.set_num_threads(int(os.environ.get("BURSAR_TORCH_THREADS") or "4"))
    from tokenizers import Tokenizer
    from locals.models.ethereus_cpu import CpuChip
    from locals.models.tracehash import trace_sha256

    tok = Tokenizer.from_file(str(tokenizer_path()))

    def enc(text: str) -> list[int]:
        return tok.encode(text, add_special_tokens=False).ids

    weights = pack / "chip.safetensors"
    elf = pack / "eth-bridge.elf"
    files = files or {}
    shown = cmd
    if files:
        import tempfile
        sys.path.append(os.environ["LOCALS_CHIPFORMER"])
        from chipformer.rv import spill as fw
        from locals.models.eth_spill import plan
        from locals.models.qwenputer import add_snapshot, firmware_states
        planned = plan(cmd, len(enc(fw.call_text(cmd))), files, enc)
        if planned:
            image = fw.firmware_with_files(elf, planned.files, planned.eth_in)
            src = eth_src()
            tmp = Path(tempfile.mkdtemp(prefix="bursar-chip-"))
            os.symlink(weights, tmp / "chip.safetensors")
            os.symlink(pack / "chip.json", tmp / "chip.json")
            add_snapshot(tmp, firmware_states(src, image))
            pack = tmp
            shown = planned.short or cmd
    if not files:
        stock_elf = pack_dir() / "eth-bridge.elf"
        if want_elf and (not stock_elf.is_file() or _sha256(stock_elf) != want_elf):
            # The snapshot is the parked state of the ELF it runs with: a receipt
            # pinned to another ELF (the repo's firmware/eth-bridge.elf) cannot
            # replay on the pack's stock snapshot.
            import tempfile
            from locals.models.qwenputer import add_snapshot, firmware_states
            staged = Path(tempfile.mkdtemp(prefix="bursar-chip-"))
            os.symlink(pack / "chip.safetensors", staged / "chip.safetensors")
            os.symlink(pack / "chip.json", staged / "chip.json")
            add_snapshot(staged, firmware_states(eth_src(), elf))
            pack = staged
    cpu = CpuChip(pack)
    st = cpu.new_state(1)
    cpu(cpu.embed([enc(PROMPT)]), st)
    cpu.inject(st)
    call = enc(tool_text(shown))
    first = int(cpu.read(call, st)[-1])
    if first < 0:
        raise SystemExit(f"the computer did not take the call ({first})")
    ids = [first]
    cur = first
    t0 = time.perf_counter()
    while True:
        nxt = int(cpu.predict(cpu(cpu.embed([[cur]]), st))[0, 0])
        if nxt < 0:
            break
        ids.append(nxt)
        cur = nxt
        if len(ids) % 20000 == 0:
            print(f"[weights] {len(ids)} tokens", file=sys.stderr, flush=True)
        if len(ids) > 250_000:
            raise SystemExit("run exceeded 250000 tokens")
    wall_ms = int(round((time.perf_counter() - t0) * 1000))
    text = tok.decode([t for t in ids if t < cpu.v0])
    return {
        "output": output_of(text),
        "trace_tokens": len(ids),
        "trace_sha256": trace_sha256(ids),
        "wall_ms": wall_ms,
    }


def main() -> None:
    if len(sys.argv) not in (2, 3):
        raise SystemExit("usage: computer_run.py <cmd> [files.json]")
    files = json.loads(Path(sys.argv[2]).read_text()) if len(sys.argv) == 3 else {}
    json.dump(run(sys.argv[1], files), sys.stdout)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
