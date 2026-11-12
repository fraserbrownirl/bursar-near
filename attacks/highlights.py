#!/usr/bin/env python3
"""Highlights film. Called from attacks/assemble.sh as: highlights.py <version>."""

import glob
import math
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIDEO = ROOT / "attacks/video"
TAKES = ROOT / "attacks/takes"
FONT = "/System/Library/Fonts/Menlo.ttc"
REPO = "https://github.com/fraserbrownirl/bursar-near"
LINK = "github.com/fraserbrownirl/bursar-near"
MARGIN_X = 96
MARGIN_Y = 54
MAX_W = 1728
# Menlo advance measured with NSFont on this Mac: 24.08px at size 40.
ADVANCE = 24.08 / 40
_text_seq = 0
LINE = 46.6 / 40
W, H = 1920, 1080
MIN_LINE = int(0.80 * W)
QUOTE = "19bb44d07b2ad9c53a9c6c45537692fcf6ad73d11ce16bfbad07613b220dfd2b"


def raw_line(wall):
    return (
        f"{QUOTE} match "
        "1click check @quote frsrcom.near 0xbc77a1ef1ee04fc563ccb1d19e28dcc7385f136b "
        "nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1 "
        f"0 250000 1794484825 - wall_ms {wall}"
    )

ATTACKS = [
    (1, "tampered-quote", "Attacker swaps the recipient in the quote", True),
    (2, "extra-intent", "Attacker adds a second action that hands over a key", True),
    (3, "deadline", "Attacker moves the deadline", True),
    (4, "switched", "A fake email says the wallet changed", False),
    (5, "poison", "An address that copies the start and end of a real one", False),
    (6, "lookalike", "A name one letter off a saved payee", False),
    (7, "invoice-zh", "Instructions hidden in a pasted invoice", False),
]


def run(args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise SystemExit(result.returncode)
    return result.stdout


def duration(path):
    return float(run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)]).strip())


def latest(version, stem):
    found = sorted(glob.glob(str(TAKES / f"v{version}-{stem}-t*.mp4")), key=lambda item: Path(item).stat().st_mtime)
    if not found:
        raise SystemExit(f"missing take v{version}-{stem}")
    return Path(found[-1])


def advance(size):
    return ADVANCE * size


def wrap(text, width):
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    if line:
        lines.append(line)
    return lines


def text_width(text, size):
    return len(text) * advance(size)


def block_lines(text, size):
    chars = max(8, int(1840 / advance(size)))
    lines = []
    for part in text.split("\n"):
        lines.extend(wrap(part, chars) or [""])
    widest = max(text_width(line, size) for line in lines)
    height = len(lines) * LINE * size
    return lines, widest, height


def pick_size(text, low=40, high=120):
    chosen = None
    for size in range(high, low - 1, -1):
        lines, widest, height = block_lines(text, size)
        if widest <= MAX_W and widest >= MIN_LINE and height <= H - 2 * MARGIN_Y:
            chosen = (size, lines, widest, height)
            break
    if chosen is None:
        raise SystemExit(f"no font fits: {text}")
    return chosen


def frame(path, t, cols=96, rows=54):
    t = max(0.0, t)
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-vf", f"scale={cols}:{rows}", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
    )
    return result.stdout


def dist(a, b):
    if not a or len(a) != len(b):
        return 10**9
    return sum(abs(x - y) for x, y in zip(a, b))


def content_box(path, t):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{t:.3f}", "-i", str(path), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
    ).stdout
    if len(raw) != W * H:
        raise SystemExit(f"unexpected frame from {path}")
    cols = [x for x in range(W) if any(raw[y * W + x] > 28 for y in range(H))]
    rows = [y for y in range(H) if any(raw[y * W + x] > 28 for x in range(W))]
    if not cols or not rows:
        raise SystemExit(f"no text in {path} at {t}")
    x0, x1, y0, y1 = cols[0], cols[-1], rows[0], rows[-1]
    x0 = max(0, x0 - 8)
    y0 = max(0, y0 - 8)
    x1 = min(W - 1, x1 + 8)
    y1 = min(H - 1, y1 + 8)
    width, height = x1 - x0 + 1, y1 - y0 + 1
    if width % 2:
        width -= 1
    if height % 2:
        height -= 1
    return x0, y0, width, height


def result_time(path, dur):
    final = frame(path, dur - 0.15)
    lo, hi = 0.0, dur - 0.15
    while hi - lo > 0.2:
        mid = (lo + hi) / 2
        if dist(frame(path, mid), final) < 2500:
            hi = mid
        else:
            lo = mid
    return hi


def right_edge(path, t):
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", f"{max(0.0, t):.3f}", "-i", str(path), "-frames:v", "1", "-vf", "scale=480:270", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True,
    ).stdout
    cols, rows = 480, 270
    if len(raw) != cols * rows:
        return 0
    edge = 0
    for y in range(rows):
        row = raw[y * cols:(y + 1) * cols]
        for x in range(cols - 1, -1, -1):
            if row[x] > 160:
                edge = max(edge, x)
                break
    return edge


def wait_start(path, t_result):
    # The wait is the still screen after the request has finished typing.
    target = right_edge(path, max(0.0, t_result - 2))
    t = 0.2
    while t < min(6.0, t_result - 0.6):
        if right_edge(path, t) >= target - 8 and right_edge(path, t + 0.35) >= target - 8:
            # Hold past the last typed character so the cut is not mid-word.
            return min(t + 0.55, t_result - 0.6)
        t += 0.15
    return max(0.0, t_result - 3)


def encode(src, dst, vf):
    if dst.exists() and dst.stat().st_size > 0 and os.environ.get("BURSAR_SKIP_READY"):
        return
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", str(dst)])


def even(value):
    value = int(value)
    return value - (value % 2)


def fit_size(text, high):
    size = high
    while size > 20 and text_width(text, size) > MAX_W:
        size -= 1
    return size


def caption_size():
    return min(fit_size(caption, 64) for _, _, caption, _ in ATTACKS if caption)


def link_size():
    return min(fit_size(attack_label(number), 52) for number, _, _, _ in ATTACKS)


def place_filter(box):
    x, y, width, height = box
    scale = min(1.0, MAX_W / width)
    sw = max(2, even(width * scale))
    sh = max(2, even(height * scale))
    cap = int(LINE * caption_size()) + 20
    link = int(LINE * link_size())
    top = MARGIN_Y + cap
    bottom = H - MARGIN_Y - link * 2 - 28
    if sh > bottom - top:
        fit = (bottom - top) / height
        sw = max(2, even(width * fit))
        sh = max(2, even(height * fit))
    py = max(top, min(int((H - sh) / 2), bottom - sh))
    px = max(MARGIN_X, int((W - sw) / 2))
    return f"crop={width}:{height}:{x}:{y},scale={sw}:{sh},pad={W}:{H}:{px}:{py}:color=black"


def draw_line(text, size, x, y, box=False):
    global _text_seq
    _text_seq += 1
    path = VIDEO / "h-text" / f"{_text_seq}.txt"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text)
    extra = ":box=1:boxcolor=black@0.65:boxborderw=12" if box else ""
    return f"drawtext=fontfile={FONT}:textfile={path}:fontsize={size}:fontcolor=white:x={x}:y={y}{extra}"


def attack_label(number):
    return f"Attack {number} · {LINK}#attack-{number}"


def overlay_filter(box, number, caption):
    base = place_filter(box)
    parts = [base]
    size = link_size()
    label = attack_label(number)
    parts.append(draw_line(label, size, int((W - text_width(label, size)) / 2), H - MARGIN_Y - int(LINE * size)))
    if caption:
        cap = caption_size()
        parts.append(draw_line(caption, cap, int((W - text_width(caption, cap)) / 2), MARGIN_Y))
    return ",".join(parts)


def card(text, dst, seconds):
    size, lines, widest, height = pick_size(text)
    y0 = int((H - height) / 2)
    parts = []
    for index, line in enumerate(lines):
        x = int((W - text_width(line, size)) / 2)
        y = int(y0 + index * LINE * size)
        parts.append(draw_line(line, size, x, y))
    vf = ",".join(parts) if parts else "null"
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:d={seconds}",
        "-vf", vf, "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", str(dst),
    ])
    return widest


def model_clip(version, number, stem, caption, work, head_keep, hold):
    src = latest(version, stem)
    dur = duration(src)
    t_result = result_time(src, dur)
    t_wait = wait_start(src, t_result)
    real = max(0.1, t_result - t_wait)
    factor = max(1, math.ceil(real / 3))
    shown = real / factor
    box = content_box(src, dur - 0.12)
    base = overlay_filter(box, number, caption)
    head_from = max(0.0, t_wait - head_keep)
    pieces = []
    head = work / f"{stem}-head.mp4"
    encode(src, head, f"trim=start={head_from}:end={t_wait},setpts=PTS-STARTPTS,{base}")
    pieces.append(head)
    badge = f"×{factor} · real time {real:.0f} s"
    wait = work / f"{stem}-wait.mp4"
    size = link_size()
    badge_y = H - MARGIN_Y - int(LINE * size) * 2 - 16
    wait_vf = f"trim=start={t_wait}:end={t_result},setpts=(PTS-STARTPTS)/{factor},fps=30,{base},{draw_line(badge, size, MARGIN_X, badge_y, box=True)}"
    encode(src, wait, wait_vf)
    pieces.append(wait)
    tail = dur - t_result
    pad = max(0.0, hold - tail)
    result = work / f"{stem}-result.mp4"
    encode(src, result, f"trim=start={t_result},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={pad:.3f},{base}")
    pieces.append(result)
    out = work / f"{stem}.mp4"
    concat(pieces, out)
    note = f"| {stem} | {t_wait:.3f}s to {t_result:.3f}s | sped ×{factor}, real time {real:.0f} s, on screen {shown:.2f}s |"
    return out, note


def code_clip(version, number, stem, caption, work, hold):
    src = latest(version, stem)
    dur = duration(src)
    box = content_box(src, max(0.0, dur - 0.12))
    base = overlay_filter(box, number, caption)
    out = work / f"{stem}.mp4"
    encode(src, out, f"tpad=stop_mode=clone:stop_duration={hold:.3f},{base}")
    return out


def concat(pieces, dst):
    listing = dst.with_suffix(".txt")
    listing.write_text("".join(f"file '{path}'\n" for path in pieces))
    run(["ffmpeg", "-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(dst)])


def replay_result(dst, wall):
    clean = "match: same answer from the weights"
    clean_size = fit_size(clean, 90)
    raw = raw_line(wall)
    longest = max(raw.split(), key=len)
    raw_size = fit_size(longest, 42)
    chars = max(8, int(MAX_W / advance(raw_size)))
    raw_lines = wrap(raw, chars)
    raw_h = len(raw_lines) * LINE * raw_size
    gap = 36
    total = raw_h + gap + LINE * clean_size
    y = int((H - total) / 2)
    raw_w = max(text_width(line, raw_size) for line in raw_lines)
    left = int((W - raw_w) / 2)
    parts = []
    for line in raw_lines:
        parts.append(draw_line(line, raw_size, left, int(y)))
        y += LINE * raw_size
    y += gap
    parts.append(draw_line(clean, clean_size, int((W - text_width(clean, clean_size)) / 2), int(y)))
    run([
        "ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"color=c=black:s={W}x{H}:d=5",
        "-vf", ",".join(parts), "-an", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", "30", str(dst),
    ])


def center_take(src, dst):
    dur = duration(src)
    box = content_box(src, max(0.0, dur - 0.2))
    encode(src, dst, place_filter(box))
    return dst


def main():
    version = int(sys.argv[1])
    takes = 4 if version >= 5 else version
    work = VIDEO / f"h{version}"
    work.mkdir(parents=True, exist_ok=True)
    notes = []
    pieces = []
    opening = work / "open.mp4"
    card("Bursar: the last check before a payment is signed runs inside the AI model.", opening, 3)
    pieces.append(opening)
    for number, stem, caption, in_model in ATTACKS:
        if version >= 5 and stem == "tampered-quote":
            inside = work / "inside.mp4"
            card("Stopped inside the model", inside, 2.5)
            pieces.append(inside)
        if version >= 5 and stem == "switched":
            code = work / "code.mp4"
            card("And the usual scams, stopped by code", code, 2.5)
            pieces.append(code)
        if in_model:
            path, note = model_clip(takes, number, stem, caption, work, 2.2, 5)
            notes.append(note)
        else:
            path = code_clip(takes, number, stem, caption, work, 2)
        pieces.append(path)
        if stem == "deadline":
            pieces.append(center_take(latest(takes, "verify-cmd"), work / "verify-cmd.mp4"))
            caption_card = work / "verify-caption.mp4"
            card("The model's weights re-run the check: 26 minutes 48 seconds on a laptop CPU", caption_card, 2.5)
            pieces.append(caption_card)
            wall = os.environ.get("BURSAR_REPLAY_WALL_MS", "1608474")
            result = work / "verify-result.mp4"
            replay_result(result, wall)
            pieces.append(result)
    closing = work / "close.mp4"
    card(f"{REPO}\nReplay any receipt: npm run verify:weights", closing, 3.5)
    pieces.append(closing)
    joined = work / "joined.mp4"
    concat(pieces, joined)
    final = VIDEO / f"highlights-v{version}.mp4"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(joined), "-c", "copy", "-an", "-fflags", "+genpts", str(final)])
    total = duration(final)
    audio = run(["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(final)]).strip()
    if audio:
        raise SystemExit("highlights has audio")
    timeline = VIDEO / f"timeline-v{version}.md"
    lines = [f"# timeline v{version}", "", f"highlights-v{version}.mp4 {total:.3f} s", "", "| cut | from | removed |", "| --- | --- | --- |", *notes, ""]
    timeline.write_text("\n".join(lines) + "\n")
    print(f"highlights-v{version}.mp4 {total:.3f} s")


if __name__ == "__main__":
    main()
