"""``@name`` file arguments, by the cloud runtime's spill path.

The bridge captures 80 tokens of a tool call. ``chipformer.rv.spill`` is the cloud's
way past that: a long hex argument becomes ``@spill/<n>`` and its text is written
into the firmware file buffer, and a command the capture cannot hold is written to
``eth_in``, which the firmware runs instead of the capture. This module is that
path for the Mac computer. A request's ``files`` object is the same buffer, so a
call can name a file the command does not itself contain (``1click check @quote``).

The parked snapshot this builds is the pack's own layout: a stock ELF reproduces
``snapshot.safetensors`` exactly, and a spilled ELF differs only in the file
buffer and ``eth_in``.
"""

from __future__ import annotations

import json
import os
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

_LOCK = threading.Lock()
_CIRCUIT = None  # built once: the bridge circuit and the pack's head index
_SRC = None


@dataclass
class Plan:
    """What the computer loads for one call. ``short`` replaces the call text the
    computer reads (the model keeps what it wrote). ``eth_in`` set means the
    firmware ignores the capture."""

    files: dict
    eth_in: str | None
    short: str | None


def plan(cmd: str, n_body: int, files: dict, encode) -> Plan | None:
    """The spill for one ``eth`` command, or None when the parked firmware can
    run the call as written. ``n_body`` is the captured tokens of the call.
    ``encode(s)`` is those tokens for a string. ``files`` is the request's."""
    spill = _module()
    new, moved = spill.rewrite(cmd, lambda s: len(encode(s)))
    use = dict(moved)
    for arg in new.split(" "):
        if arg.startswith("@") and arg[1:] in files and arg[1:] not in use:
            use[arg[1:]] = files[arg[1:]]
    changed = new != cmd
    n = len(encode(spill.call_text(new))) if changed else n_body
    if n <= spill.WINDOW:
        if not use and not changed:
            return None
        spill.file_blob(use)  # the same limit the firmware buffer enforces
        return Plan(use, None, new if changed else None)
    if len(new.encode()) >= spill.ETH_IN_SIZE:
        return None
    spill.file_blob(use)
    return Plan(use, new, "help")


def parked(dev, files: dict, eth_in: str | None):
    """``(state, masks)`` of the parked firmware with ``files`` and ``eth_in``
    written, in the buffers ``Computer`` reads. The stock snapshot when both
    are empty."""
    import mlx.core as mx

    if not files and eth_in is None:
        s, mk = dev.firmware()
        return np.array(s), np.array(mk)
    arrays = _snapshot(files, eth_in)
    chip, saved = dev.chip, dev.chip.snapshot
    chip.snapshot = arrays
    try:
        st = chip.new_state(1)
        chip.inject(st)
        s, _ = dev.w.pack(st)
        mk = dev.w.masks(s)
        mx.eval(s, mk)
        return np.array(s), np.array(mk)
    finally:
        chip.snapshot = saved


def parse_cmd(text: str) -> str | None:
    return _module().parse_cmd(text)


def call_text(cmd: str) -> str:
    return _module().call_text(cmd)


def _module():
    """``chipformer.rv.spill``, after its package is on the path. No circuit yet."""
    from .qwenputer import chipformer

    if chipformer() is None:
        raise RuntimeError("spilled firmware is loaded by the chipformer package: set LOCALS_CHIPFORMER "
                           "to its experimental/riscv directory")
    from chipformer.rv import spill
    return spill


def _source() -> Path:
    """The checkpoint the pack's snapshot was built from: ``ETH_SRC``, which
    holds ``config.json``, ``chipformer.json`` and ``tokenizer.json``."""
    global _SRC
    if _SRC is None:
        src = os.environ.get("ETH_SRC") or str(Path.home() / ".locals" / "ethereus" / "eth-src")
        if not src or not (Path(src) / "tokenizer.json").exists():
            raise RuntimeError("ETH_SRC must be the Ethereus-9B checkpoint (config.json, "
                               "chipformer.json, tokenizer.json) to load a spilled firmware")
        _SRC = Path(src)
    return _SRC


def _circuit():
    """The bridge circuit, built once. Its stock snapshot is the pack's."""
    global _CIRCUIT
    if _CIRCUIT is not None:
        return _CIRCUIT
    with _LOCK:
        if _CIRCUIT is not None:
            return _CIRCUIT
        from .qwenputer import chipformer, pack_dir_eth

        if chipformer() is None:
            raise RuntimeError("spilled firmware is loaded by the chipformer package: set LOCALS_CHIPFORMER "
                               "to its experimental/riscv directory")
        from chipformer.q35.ir import Target
        from chipformer.rv import bridge, core, elf, ref, spill
        from chipformer.rv import store as ST

        src = _source()
        cfg = json.loads((src / "config.json").read_text())
        meta = json.loads((src / "chipformer.json").read_text())
        c = core.build(Target(cfg["linear_num_key_heads"], cfg["linear_num_value_heads"], cfg["intermediate_size"]),
                       bridge.Text(src / "tokenizer.json"), ST.Config(**meta["store"]))
        pack = pack_dir_eth()
        elf_path = pack / "eth-bridge.elf"
        import mlx.core as mx
        W = mx.load(str(pack / "chip.safetensors"))
        heads = {L: np.array(W[f"L{L}.heads"]).astype(np.int64) for L in range(c.n_layers())}
        _CIRCUIT = (c, bridge, elf, ref, spill, heads, elf_path, cfg)
        return _CIRCUIT


def _snapshot(files: dict, eth_in: str | None):
    """The pack's snapshot tensors for an ELF with ``files`` and ``eth_in``."""
    import mlx.core as mx
    from chipformer.q35.ir import Head

    c, bridge, elfmod, ref, spill, heads, elf_path, cfg = _circuit()
    fw = spill.firmware_with_files(elf_path, files, eth_in)
    try:
        with _LOCK:
            m = ref.Machine.from_program(elfmod.program(str(fw)))
            bridge.park(m)
            core_snapshot = __import__("chipformer.rv.core", fromlist=["snapshot"]).snapshot
            core_snapshot(c, m)
            r = c.target.value_heads // c.target.key_heads
            out = {}
            for L in range(c.n_layers()):
                st = np.zeros((cfg["linear_num_value_heads"], 128, 128), np.float32)
                layer = [i for i, n in enumerate(c.nodes) if isinstance(n, Head) and n.level == 2 * L + 1]
                for j, ni in enumerate(layer):
                    init = c.nodes[ni].init or []
                    for x in range(len(c.nodes[ni].vheads())):
                        for row, vec in (init[x] if x < len(init) else {}).items():
                            st[j * r + x, row] = np.asarray(vec, np.float64)
                arr = np.ascontiguousarray(st[heads[L]].transpose(0, 2, 1))
                out[f"L{L}"] = mx.array(arr)
            mx.eval(*out.values())
            return out
    finally:
        if fw != elf_path:
            fw.unlink(missing_ok=True)
