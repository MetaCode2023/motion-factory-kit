export function example() {
  return { version: 1, id: 'test', aspect: '9:16', fps: 30, theme: 'editorial', accent: '#ee302b', font: 'Barlow',
    shots: [{ id: 'chart', source: { path: 'chart.png', width: 1000, height: 500 },
      target: { name: 'trend', bounds: { x: .1, y: .2, w: .3, h: .2 } },
      copy: { headline: ['FIND', 'THE SIGNAL.'], callout: 'TREND' },
      cue: .8, move: .4, hold: 2.4, transition: { kind: 'chapter', duration: .4 },
      treatment: 'spotlight', fit: 'contain', fallback: 'review', accessibility: { reducedMotion: false, minTargetPixels: 18 }, protected: [] }] };
}
