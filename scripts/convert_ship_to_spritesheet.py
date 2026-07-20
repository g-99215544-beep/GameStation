"""Convert the cyan-screen pirate ship MP4 into a transparent sprite sheet."""
from pathlib import Path
import math

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
VIDEO = next(ROOT.glob("Kapal_berlayar_plain_cyan_backgr*.mp4"))
OUTPUT = ROOT / "assets" / "ship" / "ship-sail-sheet.png"
COLS = 6
FRAME_STEP = 4                 # 96 source frames -> 24 animation frames
BG_DIST_THRESH = 70            # H.264 cyan-screen tolerance
PAD = 12
MAX_FRAME_W = 320


def cyan_mask(frame: np.ndarray) -> np.ndarray:
    """Return the opaque pixels; cyan background is transparent."""
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    # Cyan survives H.264 as hues roughly 75..105. The distance test removes
    # slightly shifted cyan compression blocks around the subject too.
    hue, sat, val = hsv[:, :, 0], hsv[:, :, 1], hsv[:, :, 2]
    hue_bg = (hue >= 74) & (hue <= 106) & (sat >= 105) & (val >= 75)
    corners = np.concatenate((
        frame[:16, :16].reshape(-1, 3), frame[:16, -16:].reshape(-1, 3),
        frame[-16:, :16].reshape(-1, 3), frame[-16:, -16:].reshape(-1, 3),
    ))
    cyan = np.median(corners, axis=0)
    distance = np.linalg.norm(frame.astype(np.float32) - cyan, axis=2)
    return ~(hue_bg | (distance < BG_DIST_THRESH))


def main() -> None:
    capture = cv2.VideoCapture(str(VIDEO))
    all_frames = []
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        # Source is 1280x720 with the actual square cyan scene centred inside.
        height, width = frame.shape[:2]
        left = (width - height) // 2
        all_frames.append(frame[:, left:left + height])
    capture.release()
    frames = all_frames[::FRAME_STEP]
    if not frames:
        raise RuntimeError(f"Could not decode frames from {VIDEO.name}")

    masks = [cyan_mask(frame) for frame in frames]
    bounds = []
    for mask in masks:
        ys, xs = np.where(mask)
        if len(xs) == 0:
            raise RuntimeError("A ship frame became fully transparent")
        bounds.append((xs.min(), ys.min(), xs.max(), ys.max()))

    avg_cx = sum((left + right) / 2 for left, _, right, _ in bounds) / len(bounds)
    half_w = max(max(avg_cx - left, right - avg_cx) for left, _, right, _ in bounds) + PAD
    top = max(0, min(top for _, top, _, _ in bounds) - PAD)
    bottom = min(frames[0].shape[0] - 1, max(bottom for _, _, _, bottom in bounds) + PAD)
    crop_left = max(0, int(math.floor(avg_cx - half_w)))
    crop_right = min(frames[0].shape[1], int(math.ceil(avg_cx + half_w)))
    crop_w, crop_h = crop_right - crop_left, bottom - top + 1
    scale = min(1.0, MAX_FRAME_W / crop_w)
    frame_w, frame_h = round(crop_w * scale), round(crop_h * scale)

    output_frames = []
    for frame, mask in zip(frames, masks):
        rgba = cv2.cvtColor(frame, cv2.COLOR_BGR2RGBA)
        rgba[:, :, 3] = np.where(mask, 255, 0).astype(np.uint8)
        cropped = Image.fromarray(rgba[top:bottom + 1, crop_left:crop_right])
        output_frames.append(cropped.resize((frame_w, frame_h), Image.Resampling.NEAREST))

    rows = math.ceil(len(output_frames) / COLS)
    sheet = Image.new("RGBA", (frame_w * COLS, frame_h * rows), (0, 0, 0, 0))
    for index, frame in enumerate(output_frames):
        sheet.alpha_composite(frame, ((index % COLS) * frame_w, (index // COLS) * frame_h))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, optimize=True)
    print({
        "input": VIDEO.name,
        "source_frames": len(all_frames),
        "sprite_frames": len(output_frames),
        "grid": f"{COLS}x{rows}",
        "frame_size": f"{frame_w}x{frame_h}",
        "sheet": str(OUTPUT.relative_to(ROOT)),
        "centre_x": round(avg_cx, 1),
    })


if __name__ == "__main__":
    main()
