# Script-linked cutaways

Motion Kit can turn a selected line into up to three short paper-cutout previews. The host agent proposes directions from the quote and project preferences. The Kit renders a fixed template from validated data.

1. Read the current Writer line and keep its stable project and line IDs.
2. Call `cutaway_preferences({ projectId })` and use the recent choices and notes to inform the options.
3. Call `cutaway_preview({ line, options })`. The line has `projectId`, `lineId`, and `text`. Supply one to three directions, each with a title, subject, palette, and layout. Subjects are `document`, `signal`, `growth`, and `idea`. Palettes are `amber`, `teal`, and `violet`. Layouts are `center` and `stack`.
4. Show the MP4s and key frames returned with their check reports. Ask the user to pick a direction. For a revision, submit a new preview with the changed direction.
5. Read the line again. Call `cutaway_select({ id, option, currentLine, feedback })` with the user's option number and optional feedback. A stale result means the text changed. Render again for the new text.
6. Before inserting a saved selection, call `cutaway_status({ draftId, selectionId, currentLine })` to catch a later rewrite. Use the returned video in the production edit at the sentence timestamp. For a Kit scene, add it via `M.video(relativePath, { at: startTime, audio: false })` to preserve the narration mix.

Selections return the original project and line IDs, the chosen direction, and the video, preview, and report paths. Drafts and selections are saved under the Kit's ignored `out/cutaways` directory. The Writer or Motion host can call these MCP tools and persist the returned draft and selection IDs with its own records. The current tools do not connect to any specific Writer database.
