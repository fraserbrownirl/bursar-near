#!/usr/bin/env python3
"""Builds the MPP demo film from a recorded take, in the attack-film theme.

python3 demos/film-mpp.py demos/mpp-film/data.json

The take is a VHS recording of a real `bursar` MPP run at 1920x1080. The
machinery (chrome, badges, diagram, cards, ffmpeg chains) is attacks/film.py;
this file only supplies the MPP segments: open, diagram, the take with its
three real waits badged, the Paid result, the replay result, and the close.
"""

import json
import math
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "attacks"))
import film as F  # noqa: E402

VIDEO = ROOT / "demos" / "mpp-film"
TAKE = ROOT / "demos" / "takes" / "v1-mpp-take.mp4"
QR = ROOT / "attacks" / "video" / "h6" / "qr-repo.png"

CHIP = "Paid web page (MPP)"
CAPTION = "A page with a 402 price, paid from one sentence"
LINK = "Paid web page (MPP) · github.com/fraserbrownirl/bursar-near/demos/mpp.md"


def run(cmd):
    return F.run(cmd)


def top(work, badge=None):
    image = F.Image.new("RGBA", (F.W, F.H), (0, 0, 0, 0))
    F.draw_top(image, chip=CHIP, caption=CAPTION)
    draw = F.ImageDraw.Draw(image)
    font = F.sf(38)
    tw = F.text_w(draw, LINK, font)
    draw.text(((F.W - tw) / 2, F.LINK_Y), LINK, font=font, fill=(209, 209, 214))
    if badge:
        F.draw_badge(image, badge)
    path = work / f"top{'-badge' if badge else ''}.png"
    image.save(path)
    return path


def render_paid(data, work):
    image = F.draw_chrome()
    F.draw_top(image, chip=CHIP, caption=CAPTION)
    draw = F.ImageDraw.Draw(image)
    font = F.sf(38)
    tw = F.text_w(draw, LINK, font)
    draw.text(((F.W - tw) / 2, F.LINK_Y), LINK, font=font, fill=(209, 209, 214))
    y = F.CY + 20
    badge_font = F.menlo(F.TFONT_SIZE, bold=True)
    badge = "Paid."
    bw = F.text_w(draw, badge, badge_font) + 28
    ascent, descent = badge_font.getmetrics()
    bh = ascent + descent + 12
    badge_rect = (F.CX, y, F.CX + bw, y + bh)
    draw.rounded_rectangle(badge_rect, radius=10, fill=F.GREEN)
    draw.text((F.CX + 14, y + 6), badge, font=badge_font, fill=(14, 17, 19))
    rest = "HTTP 200 — the server accepted the payment and returned the page."
    draw.text((F.CX + bw + 14, y), rest, font=F.menlo(F.TFONT_SIZE), fill=F.TEXT)
    y += F.LH + 20
    mono = F.menlo(30)
    for line in [
        data["page"],
        f"Settlement: {data['settlement']}",
        f"quote check  receipt: {F.short_hash(data['quote_receipt'])} [live (model, Mac)]",
        f"intent check receipt: {F.short_hash(data['intent_receipt'])} [live (model, Mac)]",
        "reference (TypeScript) agrees with the model on both",
    ]:
        draw.text((F.CX, y), line, font=mono, fill=F.DIM)
        y += 44
    y += 12
    for line in [
        f"Run: {data['run']}",
        "Live capture of a real run in a headless terminal (VHS). Not rendered from logs.",
        data["approval"],
    ]:
        draw.text((F.CX, y), line, font=F.menlo(26), fill=F.DIM)
        y += 38
    path = work / "paid.png"
    image.save(path)
    return path, badge_rect


def quiet_spans(path, t_result, want=3, minimum=15.0):
    """The `want` longest static stretches (waits) before the result, in time order."""
    gaps = []
    prev = b""
    start = None
    t = 0.0
    while t < t_result - 0.5:
        cur = F.small_gray(path, t)
        active = False
        if prev and len(cur) == len(prev):
            active = sum(abs(a - b) for a, b in zip(cur, prev)) > 15000
        if active:
            if start is not None and t - start >= minimum:
                gaps.append((start, t))
            start = None
        elif start is None:
            start = t
        prev = cur
        t += 0.5
    if start is not None and t_result - 0.5 - start >= minimum:
        gaps.append((start, t_result - 0.5))
    longest = sorted(gaps, key=lambda g: g[1] - g[0], reverse=True)[:want]
    return sorted(longest, key=lambda g: g[0])


def content_start(path, t_result):
    """First second with real content on screen (the VHS Hide phase is black)."""
    t = 0.0
    while t < t_result:
        cur = F.small_gray(path, t)
        if cur and sum(cur) > 240 * 135 * 8:
            return t
        t += 0.5
    return 0.0


def build(data):
    work = VIDEO
    work.mkdir(parents=True, exist_ok=True)
    chrome = work / "chrome.png"
    F.draw_chrome().save(chrome)
    dur = F.duration(TAKE)
    t_result = F.result_time(TAKE, dur)
    start = content_start(TAKE, t_result)
    spans = [span for span in quiet_spans(TAKE, t_result) if span[0] >= start]
    data_out = {"take": str(TAKE), "duration": dur, "result": t_result, "waits": []}
    pieces = []
    box = F.content_box(TAKE, max(1.0, t_result - 3.0))
    font_size = 26

    open_png = work / "open.png"
    F.render_open(open_png)
    pieces.append(work / "s-open.mp4")
    F.card_clip(open_png, 2.5, pieces[-1])

    diagram_dir = work / "diagram"
    diagram_dir.mkdir(exist_ok=True)
    F.render_diagram(diagram_dir)
    pieces.append(work / "s-diagram.mp4")
    run(["ffmpeg", "-y", "-v", "error", "-framerate", str(F.FPS), "-i", str(diagram_dir / "d%03d.png"),
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(pieces[-1])])

    base_plain = F.base_frame(chrome, top(work), work / "base.png")

    def take_seg(name, t0, t1, badge=None):
        if t1 - t0 < 0.2:
            return
        dst = work / f"s-{name}.mp4"
        base = base_plain
        if badge:
            base = F.base_frame(chrome, top(work, badge=badge), work / f"base-{name}.png")
        F.encode_take(TAKE, dst, F.take_chain(box, font_size, trim=f"{t0:.3f}:{t1:.3f}"), base)
        pieces.append(dst)

    cursor = start
    for i, (qs, qe) in enumerate(spans):
        wait = qe - qs
        data_out["waits"].append({"start": qs, "end": qe, "seconds": round(wait)})
        take_seg(f"pre{i}", cursor, min(qs + 1.2, t_result))
        take_seg(f"badge{i}", min(qs + 1.2, t_result), min(qs + 3.0, t_result), badge=f"real wait {round(wait)} s")
        cursor = qe
    take_seg("tail", cursor, t_result)

    paid_png, _badge_rect = render_paid(data, work)
    pieces.append(work / "s-paid.mp4")
    F.card_clip(paid_png, 4.0, pieces[-1])

    F.render_replay_result({"raw_line": data["raw_line"]}, work)
    pieces.append(work / "s-replay.mp4")
    F.card_clip(work / "verify-result.png", 3.0, pieces[-1])

    close_png = work / "close.png"
    F.render_close(close_png, QR)
    pieces.append(work / "s-close.mp4")
    F.card_clip(close_png, 3.0, pieces[-1])

    out = ROOT / "demos" / "mpp-demo.mp4"
    F.concat(pieces, out)
    (work / "timeline.json").write_text(json.dumps(data_out, indent=1) + "\n")
    print(f"{out} {F.duration(out):.1f}s, waits: {[w['seconds'] for w in data_out['waits']]}")


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text()))
