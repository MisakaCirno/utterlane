# Utterlane User Guide

## Overview

Utterlane is a recording app focused on a "sentence-by-sentence recording + timeline assembly + subtitle export" workflow.
It's geared toward voice-over, audiobook, and podcast editing — anything where you split a script into short utterances, record them one by one, and want multiple takes per line to choose from.

## Getting Started

### Create / Open a Project

- **File → New Project**: pick an empty folder; Utterlane sets up the project structure inside.
- **File → Open Project**: pick an existing project directory.
- The welcome screen also lists recently opened projects.

Project layout: each project is a directory containing `project.json` (metadata), `segments.json` (sentence + take list), and an `audios/` subdirectory holding the actual WAV files.

### Import a Script

- **File → Import Script…**: import bulk text from a plain text or subtitle file, auto-split into Segments by line/paragraph.

## Core Concepts

- **Segment**: a line/paragraph from the script — the basic unit of recording.
- **Take**: each Segment can have multiple recordings; one is flagged as the "current take" and participates in the final mix/export.
- **Trim**: each Take can have non-destructive start/end markers; the WAV file isn't modified, only the trimmed range is exported.
- **Trailing gap**: silence inserted between two Segments at export time.

## Recording

1. Select a Segment in the **Segments** panel.
2. Click the Record button at the top of the **Inspector** (or press `R`).
3. After the configurable countdown, recording starts.
4. Press the button again to stop — the Take is saved to the project.
5. To re-record the same sentence, press Re-record (`Shift+R`).

Watch the level meter while recording: aim for -12 ~ -6 dBFS to avoid clipping.

## Take Management

The Inspector's bottom table shows all takes for the current Segment:

- **On** column toggles the "current take".
- **Start / End (ms)** edit the trim range directly; the waveform panel mirrors with drag handles.
- **Play ▶**: preview a single take without changing the current selection.
- **Delete 🗑** / **Reveal file 📂**.

You can also drag the start/end handles on the waveform in the Segment Timeline panel.

## Timeline

Two panels, both support mouse-wheel + zoom slider:

- **Segment Timeline**: detail view of the current Segment — adjust trim, preview a single line.
- **Project Timeline**: horizontal timeline of the entire project — see clip order, duration, gaps; drag clips to reorder, drag gaps to change spacing.

Wheel:
- Plain scroll = horizontal pan
- `Ctrl+wheel` = horizontal zoom
- In Segment Timeline, also `Ctrl+Shift+wheel` = vertical zoom (waveform amplitude)

## Export

- **File → Export → Audio (WAV)**: concatenate all Segments in order, applying trim + trailing gap per segment. Choose whole-project or per-segment export, optional peak normalization.
- **File → Export → Subtitles (SRT)**: generate SRT subtitles based on each Segment's effective duration.

## Preferences

`Edit → Preferences` (or `Ctrl+,`). Pages:

- **Appearance**: Dock theme, font scale, UI language, text alignment.
- **Project Defaults**: sample rate / channel count for new projects.
- **Recording**: input device, pre-record countdown.
- **Keyboard**: customize transport/navigation shortcuts.

## Shortcuts

| Action | Default |
|--------|---------|
| Record / Stop | `R` |
| Re-record current take | `Shift+R` |
| Play segment / Pause | `Space` |
| Play project / Pause | `Shift+Space` |
| Previous / Next segment | `↑` / `↓` |
| Stop / Cancel | `Esc` |
| Undo / Redo | `Ctrl+Z` / `Ctrl+Y` |
| Preferences | `Ctrl+,` |
| Find / Replace | `Ctrl+F` |

## Data Safety

- Recordings live in the project's `audios/` folder; the source WAVs are never modified by trim or export.
- Deleting a take only removes its reference from `segments.json`; the file stays on disk — recover or clean up via **File → Audio File Audit**.
- Project content (`segments.json`) has an undo stack; most accidental edits can be reverted with `Ctrl+Z`.
