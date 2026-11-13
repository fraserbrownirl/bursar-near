#!/usr/bin/env python3
"""Builds the MPP demo film from a recorded take, in the attack-film theme.

python3 demos/mpp/film-mpp.py demos/mpp/film/data.json

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

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "attacks"))
import film as F  # noqa: E402

QR = ROOT / "attacks" / "video" / "h6" / "qr-repo.png"

TAKE_BY_SCENE = {"mpp": ROOT / "demos" / "mpp" / "takes" / "v1-mpp-take.mp4", "x402": ROOT / "demos" / "x402" / "takes" / "v1-x402-take.mp4"}


def run(cmd):
    return F.run(cmd)


def top(work, data, badge=None):
    image = F.Image.new("RGBA", (F.W, F.H), (0, 0, 0, 0))
    F.draw_top(image, chip=data["chip"], caption=data["caption"], chip2=data.get("chip2"))
    draw = F.ImageDraw.Draw(image)
    font = F.sf(38)
    tw = F.text_w(draw, data["link"], font)
    draw.text(((F.W - tw) / 2, F.LINK_Y), data["link"], font=font, fill=(209, 209, 214))
    if badge:
        F.draw_badge(image, badge)
    path = work / f"top{'-badge' if badge else ''}.png"
    image.save(path)
    return path


def wrap_words(draw, text, font, max_width):
    """Word-wrapped lines: no word or number is split."""
    words, lines, cur = text.split(), [], ""
    for word in words:
        trial = f"{cur} {word}".strip()
        if F.text_w(draw, trial, font) <= max_width:
            cur = trial
        else:
            if cur:
                lines.append(cur)
            cur = word
    if cur:
        lines.append(cur)
    return lines


def render_paid(data, work):
    image = F.draw_chrome()
    F.draw_top(image, chip=data["chip"], caption=data["caption"], chip2=data.get("chip2"))
    draw = F.ImageDraw.Draw(image)
    font = F.sf(38)
    tw = F.text_w(draw, data["link"], font)
    draw.text(((F.W - tw) / 2, F.LINK_Y), data["link"], font=font, fill=(209, 209, 214))
    y = F.CY + 20
    badge_font = F.menlo(F.TFONT_SIZE, bold=True)
    badge = data.get("badge", "Paid.")
    bw = F.text_w(draw, badge, badge_font) + 28
    ascent, descent = badge_font.getmetrics()
    bh = ascent + descent + 12
    badge_rect = (F.CX, y, F.CX + bw, y + bh)
    draw.rounded_rectangle(badge_rect, radius=10, fill=F.GREEN)
    draw.text((F.CX + 14, y + 6), badge, font=badge_font, fill=(14, 17, 19))
    draw.text((F.CX + bw + 14, y), data["head"], font=F.menlo(F.TFONT_SIZE), fill=F.TEXT)
    y += F.LH + 20
    mono = F.menlo(30)
    max_w = F.WW - 64
    for line in data["lines"]:
        for wrapped in wrap_words(draw, line, mono, max_w):
            draw.text((F.CX, y), wrapped, font=mono, fill=F.DIM)
            y += 44
    y += 12
    small = F.menlo(30)
    for line in [f"Run: {data['run']}", "Live capture of a real run in a headless terminal (VHS). Not rendered from logs.", data["approval"]]:
        for wrapped in wrap_words(draw, line, small, max_w):
            draw.text((F.CX, y), wrapped, font=small, fill=F.DIM)
            y += 44
    path = work / "paid.png"
    image.save(path)
    return path, badge_rect


def render_replay_cmd(data, chrome, path):
    """The replay command, typed in the terminal chrome: verify:weights with this payment's receipt."""
    base = F.Image.open(chrome).convert("RGB").copy()
    draw = F.ImageDraw.Draw(base)
    y = F.CY
    draw.text((F.CX, y), "> ", font=F.menlo(30), fill=F.DIM)
    draw.text((F.CX + F.text_w(draw, "> ", F.menlo(30)), y), data["verify_cmd"], font=F.menlo(28), fill=F.TEXT)
    base.save(path)


def render_replay_caption(data, path):
    image = F.Image.new("RGB", (F.W, F.H), F.BG)
    draw = F.ImageDraw.Draw(image)
    font = F.sf(46, "Semibold")
    text = "The model's weights re-run the quote check"
    tw = F.text_w(draw, text, font)
    draw.text(((F.W - tw) / 2, F.H / 2 - 80), text, font=font, fill=F.TEXT)
    F.pill(draw, ((F.W - F.text_w(draw, f"real duration {data['verify_wall_s']} s", F.sf(38)) - 44) / 2, F.H / 2 + 20),
           f"real duration {data['verify_wall_s']} s", F.sf(38), (44, 44, 46), F.TEXT)
    image.save(path)


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
    scene = data["scene"]
    take = ROOT / "demos" / scene / "takes" / data["take"] if data.get("take") else TAKE_BY_SCENE[scene]
    work = ROOT / "demos" / scene / "film"
    work.mkdir(parents=True, exist_ok=True)
    chrome = work / "chrome.png"
    F.draw_chrome().save(chrome)
    dur = F.duration(take)
    t_result = F.result_time(take, dur)
    start = content_start(take, t_result)
    spans = [span for span in quiet_spans(take, t_result, minimum=data.get("min_wait", 15.0)) if span[0] >= start]
    data_out = {"take": str(take), "duration": dur, "result": t_result, "waits": []}
    pieces = []
    box = F.content_box(take, max(1.0, data.get("box_time", t_result - 3.0)))
    font_size = 31

    if data.get("open", True):
        open_png = work / "open.png"
        F.render_open(open_png)
        pieces.append(work / "s-open.mp4")
        F.card_clip(open_png, 2.5, pieces[-1])

    if data.get("diagram", True):
        diagram_dir = work / "diagram"
        diagram_dir.mkdir(exist_ok=True)
        F.render_diagram(diagram_dir)
        pieces.append(work / "s-diagram.mp4")
        run(["ffmpeg", "-y", "-v", "error", "-framerate", str(F.FPS), "-i", str(diagram_dir / "d%03d.png"),
             "-c:v", "libx264", "-pix_fmt", "yuv420p", str(pieces[-1])])

    base_plain = F.base_frame(chrome, top(work, data), work / "base.png")

    def take_seg(name, t0, t1, badge=None, hold=0.0):
        if t1 - t0 < 0.2:
            return
        dst = work / f"s-{name}.mp4"
        base = base_plain
        if badge:
            base = F.base_frame(chrome, top(work, data, badge=badge), work / f"base-{name}.png")
        F.encode_take(take, dst, F.take_chain(box, font_size, trim=f"{t0:.3f}:{t1:.3f}", hold=hold), base)
        pieces.append(dst)

    cursor = start
    for i, (qs, qe) in enumerate(spans):
        wait = qe - qs
        data_out["waits"].append({"start": qs, "end": qe, "seconds": round(wait)})
        if data.get("badge_overlay"):
            take_seg(f"pre{i}", cursor, qs)
            take_seg(f"badge{i}", qs, qe, badge=f"real wait {round(wait)} s")
        else:
            take_seg(f"pre{i}", cursor, min(qs + 1.2, t_result))
            take_seg(f"badge{i}", min(qs + 1.2, t_result), min(qs + 3.0, t_result), badge=f"real wait {round(wait)} s")
        cursor = qe
    take_seg("tail", cursor, t_result, hold=data.get("hold", 0.0))

    paid_png, _badge_rect = render_paid(data, work)
    pieces.append(work / "s-paid.mp4")
    F.card_clip(paid_png, 4.0, pieces[-1])

    verify = data.get("verify", {"raw_line": data["raw_line"]} if data.get("raw_line") else None)
    if verify:
        if data.get("verify_chrome"):
            for key in ("chip", "chip2", "caption", "link"):
                verify.setdefault(key, data.get(key))
        if data.get("verify_cmd"):
            card_png = work / "replay-card.png"
            F.render_card("Afterwards, anyone can re-run this payment's check", card_png, size=56)
            pieces.append(work / "s-replay-card.mp4")
            F.card_clip(card_png, 3.0, pieces[-1])
            cmd_png = work / "replay-cmd.png"
            render_replay_cmd(data, chrome, cmd_png)
            pieces.append(work / "s-replay-cmd.mp4")
            F.card_clip(cmd_png, 3.5, pieces[-1])
            cap_png = work / "replay-caption.png"
            render_replay_caption(data, cap_png)
            pieces.append(work / "s-replay-caption.mp4")
            F.card_clip(cap_png, 3.5, pieces[-1])
        F.render_replay_result(verify, work)
        pieces.append(work / "s-replay.mp4")
        F.card_clip(work / "verify-result.png", 3.0, pieces[-1])

    if data.get("close", True):
        close_png = work / "close.png"
        F.render_close(close_png, QR)
        pieces.append(work / "s-close.mp4")
        F.card_clip(close_png, 3.0, pieces[-1])

    out = ROOT / "demos" / scene / f"{scene}-demo.mp4"
    F.concat(pieces, out)
    (work / "timeline.json").write_text(json.dumps(data_out, indent=1) + "\n")
    print(f"{out} {F.duration(out):.1f}s, waits: {[w['seconds'] for w in data_out['waits']]}")


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text()))
