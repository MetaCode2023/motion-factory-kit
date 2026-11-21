// Map transcript words into one cut piece. Whisper end times are often early, so a mid-piece caption
// stays through the following word's real onset, but never hangs over a genuine pause.
export function wordsForPiece(pieceWords, { sourceIn, sourceOut, timelineIn, tightened = true, hasAudio = true, maxHold = 0.35 }) {
  return pieceWords.map((w, i) => {
    let end = Math.min(w.e, sourceOut);
    const next = pieceWords[i + 1];
    if (next) end = Math.max(end, Math.min(next.s, w.e + maxHold, sourceOut));
    else if (tightened && hasAudio) end = sourceOut;
    return {
      w: w.w,
      s: +(timelineIn + w.s - sourceIn).toFixed(3),
      e: +(timelineIn + Math.max(w.s, end) - sourceIn).toFixed(3),
    };
  });
}
