"""Blurs everything above Spotify's playing row in the phone shot of the Spotify library (clip "spotify-playing").

The rows above it show other people's names as playlist owners. The camera moves, so the boundary is found in every frame: Spotify draws
the playing playlist's name in bright green, so the top edge of that green text is fitted with a straight line (the row is slanted in
perspective), and everything above the line, moved up by a small margin, is pixelated and blurred. A frame where the green row can't be
found fails the run rather than being left unblurred.

Usage: python3 -I blur_above_playing_row.py <frames directory>
"""

import pathlib
import sys

import numpy as np
from PIL import Image, ImageFilter

MARGIN = 7  # pixels above the green text's top edge


def boundary(rgb: np.ndarray) -> tuple[float, float]:
    """Fits y = a*x + b along the top edge of Spotify's green text in the left 80% and middle of the frame."""
    h, w, _ = rgb.shape
    r, g, b = (rgb[..., i].astype(int) for i in range(3))
    green = (g > 140) & (g - r > 60) & (g - b > 40)
    green[: int(h * 0.15)] = False
    green[int(h * 0.75) :] = False
    green[:, int(w * 0.8) :] = False  # the thumbnail column on the right
    xs, tops = [], []
    for x in range(w):
        ys = np.flatnonzero(green[:, x])
        if ys.size >= 2:
            xs.append(x)
            tops.append(ys[0])
    if len(xs) < 25:
        raise SystemExit("The playing row's green text wasn't found; refusing to leave the frame unblurred.")
    xs, tops = np.array(xs), np.array(tops)
    # Text is mostly letters of one line; ignore columns far below the line's upper edge (descenders, the speaker icon).
    cut = np.percentile(tops, 40)
    keep = tops <= cut + 6
    a, b0 = np.polyfit(xs[keep], tops[keep], 1)
    return float(a), float(b0)


# The row's slant in this shot; a fit far outside it (motion blur) is replaced from the neighbouring frames.
SLOPE_RANGE = (-0.3, -0.05)


def lines(images: list[np.ndarray]) -> list[tuple[float, float]]:
    """The boundary line of every frame: fitted, implausible fits filled from neighbours, then smoothed over 3 frames."""
    fits = [boundary(rgb) for rgb in images]
    w = images[0].shape[1]
    good = [SLOPE_RANGE[0] <= a <= SLOPE_RANGE[1] for a, _ in fits]
    if not any(good):
        raise SystemExit("No plausible boundary in any frame; refusing to continue.")
    idx = np.arange(len(fits))
    ok = idx[good]
    # Describe each line by its height at the left and right edges, and interpolate those over time.
    left = np.interp(idx, ok, [fits[i][1] for i in ok])
    right = np.interp(idx, ok, [fits[i][0] * w + fits[i][1] for i in ok])
    smooth = lambda v: np.array([np.median(v[max(0, i - 1) : i + 2]) for i in range(len(v))])
    left, right = smooth(left), smooth(right)
    return [((r - l) / w, l) for l, r in zip(left, right)]


def main(directory: str) -> None:
    frames = sorted(pathlib.Path(directory).glob("*.jpg"))
    images = [np.asarray(Image.open(frame).convert("RGB")) for frame in frames]
    for frame, rgb, (a, b0) in zip(frames, images, lines(images)):
        image = Image.fromarray(rgb)
        h, w, _ = rgb.shape
        yy, xx = np.mgrid[0:h, 0:w]
        mask = yy < (a * xx + b0 - MARGIN)
        small = image.resize((max(1, w // 14), max(1, h // 14)), Image.BILINEAR)
        hidden = small.resize((w, h), Image.NEAREST).filter(ImageFilter.GaussianBlur(6))
        out = np.where(mask[..., None], np.asarray(hidden), rgb).astype(np.uint8)
        Image.fromarray(out).save(frame, quality=95)
    print(f"  blurred above the playing row in {len(frames)} frames")


if __name__ == "__main__":
    main(sys.argv[1])
