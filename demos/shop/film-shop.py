#!/usr/bin/env python3
"""Builds the shop-sale demo film from a VHS take and the phone screen recording.

python3 demos/shop/film-shop.py demos/shop/film/data.json

Segments: the take (owner's sentence, the QR), the phone footage inset with its
real waits badged, and a closing card with the genuine Received line and the
run's receipts. The chrome, badges, cards and ffmpeg chains are attacks/film.py;
the card style follows demos/mpp/film-mpp.py.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "attacks"))
sys.path.insert(0, str(ROOT / "demos" / "mpp"))
import film as F  # noqa: E402
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("film_mpp", ROOT / "demos" / "mpp" / "film-mpp.py")
film_mpp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(film_mpp)


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
    draw.rounded_rectangle((F.CX, y, F.CX + bw, y + bh), radius=10, fill=F.GREEN)
    draw.text((F.CX + 14, y + 6), badge, font=badge_font, fill=(14, 17, 19))
    draw.text((F.CX + bw + 14, y), data["head"], font=F.menlo(F.TFONT_SIZE), fill=F.TEXT)
    y += F.LH + 20
    mono = F.menlo(30)
    max_w = F.WW - 64
    for line in data["lines"]:
        for wrapped in film_mpp.wrap_words(draw, line, mono, max_w):
            draw.text((F.CX, y), wrapped, font=mono, fill=F.DIM)
            y += 44
    y += 12
    small = F.menlo(30)
    for line in data["disclosure"]:
        for wrapped in film_mpp.wrap_words(draw, line, small, max_w):
            draw.text((F.CX, y), wrapped, font=small, fill=F.DIM)
            y += 44
    path = work / "paid.png"
    image.save(path)
    return path


def phone_base(data, work, name, left_lines, badge=None):
    image = F.draw_chrome()
    F.draw_top(image, chip=data["chip"], chip2=data.get("chip2"))
    draw = F.ImageDraw.Draw(image)
    # The caption sits left during phone beats: the phone inset covers the centre-right.
    caption_font = F.sf(46, "Semibold")
    draw.text((40, 84), data["caption"], font=caption_font, fill=F.TEXT)
    font = F.sf(38)
    tw = F.text_w(draw, data["link"], font)
    draw.text(((F.W - tw) / 2, F.LINK_Y), data["link"], font=font, fill=(209, 209, 214))
    if badge:
        F.draw_badge(image, badge)
    y = F.CY + 60
    head_font = F.menlo(F.TFONT_SIZE)
    body_font = F.menlo(34)
    max_w = 1050
    for i, line in enumerate(left_lines):
        use = head_font if i == 0 else body_font
        for wrapped in film_mpp.wrap_words(draw, line, use, max_w):
            draw.text((F.CX, y), wrapped, font=use, fill=F.TEXT if i == 0 else F.DIM)
            y += 64 if i == 0 else 52
    path = work / f"phone-base-{name}.png"
    image.save(path)
    return path


def phone_seg(phone, base, dst, t0, t1, speed, phone_h=880, x=1300, y=100):
    dur = (t1 - t0) / speed
    chain = (
        f"[1:v]setpts=(PTS-STARTPTS)/{speed},fps={F.FPS},scale=-2:{phone_h}[ph],"
        f"[0:v][ph]overlay={x}:{y}:shortest=1,format=yuv420p[v]"
    )
    F.run([
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1", "-framerate", str(F.FPS), "-t", f"{dur:.3f}", "-i", str(base),
        "-ss", f"{t0:.3f}", "-to", f"{t1:.3f}", "-i", str(phone),
        "-filter_complex", chain, "-map", "[v]", "-an",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", str(F.FPS), str(dst),
    ])
    return dur


def build(data):
    work = ROOT / "demos" / "shop" / "film"
    work.mkdir(parents=True, exist_ok=True)
    take = ROOT / "demos" / "shop" / "takes" / data["take"]
    phone = Path(data["phone"]).expanduser()
    chrome = work / "chrome.png"
    F.draw_chrome().save(chrome)
    pieces = []
    data_out = {"take": str(take), "phone": str(phone), "segments": []}

    # The take: the owner's sentence and the QR. The QR's bright block is the cut
    # point (typing at this font is invisible to the motion detector); the model
    # wait between typing and the QR is cut to a badged 1.8 s.
    dur = F.duration(take)
    box = F.content_box(take, dur - 1.0)
    take_font = data.get("take_font", 26)
    cap = min(0.85, F.WH * take_font / (46.0 * box[3]) * 0.99)

    def qr_time(path, end):
        t = 0.5
        while t < end:
            cur = F.small_gray(path, t)
            if cur and sum(cur) / len(cur) > 70:
                return t
            t += 0.25
        return end

    def take_seg(name, t0, t1, badge=None, hold=0.0, path=None, box=None, font=None, cap=None):
        if t1 - t0 < 0.2:
            return
        src = path or take
        sbox = box or F.content_box(src, min(t1, F.duration(src) - 0.5))
        sfont = font or take_font
        scap = cap if cap is not None else min(0.85, F.WH * sfont / (46.0 * sbox[3]) * 0.99)
        base = work / "base.png"
        if not base.exists() or badge:
            top = film_mpp.top(work, data, badge=badge) if badge else film_mpp.top(work, data)
            base = F.base_frame(chrome, top, work / f"base-{name}.png" if badge else base)
        F.encode_take(src, work / f"s-{name}.mp4", F.take_chain(sbox, sfont, trim=f"{t0:.3f}:{t1:.3f}", hold=hold, cap=scap), base)
        pieces.append(work / f"s-{name}.mp4")
        data_out["segments"].append({"kind": "take", "take": src.name, "from": round(t0, 2), "to": round(t1, 2), "badge": badge})

    qe = qr_time(take, dur)
    # Typing and the wait come from the big-font take; the full-QR tail from the
    # tall-canvas take. The wait is measured on the QR take.
    take_type = ROOT / "demos" / "shop" / "takes" / data.get("take_type", data["take"])
    dur_t = F.duration(take_type)
    type_end = min(data.get("type_seconds", 2.2), dur_t)
    box_t = F.content_box(take_type, min(type_end, dur_t - 0.5))
    type_font = data.get("type_font", 26)
    wait = qe - type_end
    if wait >= 4.0:
        take_seg("pre", 0, type_end, path=take_type, box=box_t, font=type_font)
        take_seg("badge", type_end, min(type_end + 1.8, dur_t), badge=f"real wait {round(wait)} s", path=take_type, box=box_t, font=type_font)
    else:
        take_seg("pre", 0, qe, path=take_type, box=box_t, font=type_font)
    take_seg("tail", qe, dur, hold=1.2)

    # The QR card, when a scene asks for it: the code the buyer scans, shown whole.
    if data.get("qr_left"):
        qr_card = phone_base(data, work, "qr", data["qr_left"])
        image = F.Image.open(qr_card).convert("RGB")
        qr = F.Image.open(ROOT / "demos" / "shop" / data.get("qr_image", "qr-solana.png")).convert("RGB")
        side = 530  # 10 px per module, an exact half of the 20 px render
        qr = qr.resize((side, side), F.Image.NEAREST)
        image.paste(qr, (1240, 220))
        qr_card2 = work / "qr-card.png"
        image.save(qr_card2)
        pieces.append(work / "s-qr.mp4")
        F.card_clip(qr_card2, 3.0, pieces[-1])
        data_out["segments"].append({"kind": "qr-card", "seconds": 3.0})

    # The phone footage, inset, real waits badged.
    for seg in data["phone_segments"]:
        base = phone_base(data, work, seg["name"], seg["left"], badge=seg.get("badge"))
        dst = work / f"s-phone-{seg['name']}.mp4"
        kept = phone_seg(phone, base, dst, seg["t0"], seg["t1"], seg["speed"])
        pieces.append(dst)
        data_out["segments"].append({"kind": "phone", "from": seg["t0"], "to": seg["t1"], "speed": seg["speed"], "kept": round(kept, 1), "badge": seg.get("badge")})

    # The closing card: the genuine Received line and the run's receipts.
    paid_png = render_paid(data, work)
    pieces.append(work / "s-paid.mp4")
    F.card_clip(paid_png, data.get("close_seconds", 6.0), pieces[-1])

    out = ROOT / "demos" / "shop" / "shop-demo.mp4"
    F.concat(pieces, out)
    (work / "timeline.json").write_text(json.dumps(data_out, indent=1) + "\n")
    print(f"{out} {F.duration(out):.1f}s")


if __name__ == "__main__":
    build(json.loads(Path(sys.argv[1]).read_text()))
