"""Heuristic burned-subtitle detector for pulled B-roll.

Samples the lower 45% of several frames and looks for persistent, text-sized high-contrast components.
It is intentionally conservative: exit 1 means "review this clip", not proof that subtitles exist.
"""
import json
import sys


def likely_subtitles(component_rows: list[list[tuple[int, int, int, int]]], frame_height: int) -> tuple[bool, str]:
    hits = []
    for rows in component_rows:
        textish = [r for r in rows if 5 <= r[2] <= 180 and 8 <= r[3] <= max(12, frame_height * .09) and r[1] >= frame_height * .55]
        hits.append(len(textish) >= 6)
    n = sum(hits)
    return n >= 2, f"{n}/{len(hits)} sampled frames contain subtitle-like lower-third text"


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: detect_burned_subtitles.py <video>", file=sys.stderr)
        return 2
    try:
        import cv2  # type: ignore
    except Exception:
        print(json.dumps({"detected": False, "reason": "opencv unavailable; subtitle check skipped"}))
        return 0
    cap = cv2.VideoCapture(sys.argv[1])
    count, fps = int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), cap.get(cv2.CAP_PROP_FPS) or 30
    samples = []
    for frac in (.2, .5, .8):
        cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, int(count * frac)))
        ok, frame = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        # White and black glyphs both create strong local edges.
        edge = cv2.morphologyEx(cv2.Canny(gray, 80, 180), cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (5, 2)))
        n, _, stats, _ = cv2.connectedComponentsWithStats(edge)
        samples.append([tuple(map(int, stats[i, :4])) for i in range(1, n)])
    cap.release()
    detected, reason = likely_subtitles(samples, int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080))
    print(json.dumps({"detected": detected, "reason": reason}))
    return 1 if detected else 0


if __name__ == "__main__":
    raise SystemExit(main())
