# Other languages

The same ad in Spanish, Portuguese, French, German and more. Text, narration and captions follow the
language; the visuals don't change.

## Narrated ads and templates

Add one spreadsheet row per language. Ask Claude:

> Translate data/oct-ads.csv into Spanish and Portuguese. Keep the column names, add a `lang` column,
> keep prices and URLs as they are, and keep each line about as long as the English.

Then build them all:

```bash
node batch-ads.mjs scenes/templates/three-reasons.html data/oct-ads-multi.csv --variants
```

Narration comes from ElevenLabs' multilingual model, which speaks whatever language the line is in.
For a native-sounding voice per language, put a `voiceId` column in the sheet (a voice from your
ElevenLabs library); templates pass it to `M.setup({ voiceId })`.

## Creator footage (UGC, street interviews)

The person on camera has to say it in the new language. Two ways:

- **Higgsfield dubbing**: if the Higgsfield connector is set up, ask Claude to dub the clip (it keeps
  the voice and re-syncs the lips), save it to `assets/higgsfield/`, and point the ad at it.
- **ElevenLabs Dubbing** (in the ElevenLabs app): upload the clip, download the dubbed version.

Captions work in any language: ElevenLabs speech-to-text detects it automatically, and the editor
(`footage.mjs`) cuts dubbed clips like any other.

## Fonts

The bundled fonts cover Latin alphabets (English, Spanish, Portuguese, French, German, Italian,
Polish, Turkish...). For Greek, Cyrillic, Arabic, Hebrew, Hindi, Chinese, Japanese or Korean, add a
font that covers it to `fonts/` (for example Noto Sans from fontsource, files named
`noto-sans-<subset>-<weight>-normal.woff2`) and set it in `brand.js`.

## Check before you post

Have a native speaker read each version once. Machine translation is good, but slogans and slang are
where it slips.
