# CDO UX Gate Review: Voice Capture Cockpit Upgrade

**Date**: May 12, 2026  
**Route**: `/sales/field-note` (`VoiceCapturePage.tsx`)  
**Verdict**: ✅ **APPROVED** (Ready for Ship)

## Context/Scope
This review evaluates the UX upgrades to the Field Note cockpit as part of the Voice-to-QRM capture system overhaul. The evaluation focuses on clarity, user trust, realtime fallback handling, offline/retry resilience, accessibility, and overall suitability for field sales operators.

## Findings

### 1. Clarity & Trust (World-Class Standard)
- **Progressive Disclosure**: The use of a 6-phase processing state (`uploading`, `transcribing`, `extracting`, `saving`, `syncing`, `done`) gives reps immediate, transparent feedback on what the system is doing.
- **Trust Boundaries**: The UI explicitly delineates between optimistic/local previews ("Live preview is advisory") and the final server source-of-truth.
- **Signal Quality**: The `isLowSignalFieldNoteTranscript` heuristic is excellent. It intercepts generic "junk" recordings (e.g., just "yeah" or "ok") and prompts the user to re-record, preventing garbage data from entering the QRM pipeline.
- **Data Confidence**: Showing explicit `ConfidenceBadge` components and literal evidence snippets alongside extracted fields builds high trust in the AI's extraction capabilities.

### 2. Realtime Fallback Messaging
- The implementation of `TranscriptPreviewMode` elegantly handles the downgrade path. It transitions fluidly from "Connecting realtime" -> "Realtime AI preview" -> "Browser preview" -> "Preview unavailable".
- The graceful fallback to native `SpeechRecognition` if the socket fails or the feature flag is disabled ensures the rep is never blocked from seeing a live transcript.

### 3. Offline/Retry States
- **Offline Awareness**: Real-time `navigator.onLine` tracking paired with explicit UI badges (Online/Offline) sets clear expectations.
- **Queue Transparency**: Queued notes are not hidden in the background. They appear in the "Recent recordings" table with explicit statuses (`queued`, `processing`, `failed`).
- **Resilience**: The queue handles partial failures beautifully. If a sync fails due to network/server issues, the audio is preserved locally, the UI surfaces the exact error (`note.lastError`), and the rep is given a clear "Retry sync" action.

### 4. Accessibility & Operator Ergonomics
- **Touch Targets**: The primary record button is massive (144px), perfect for mobile/field usage with a single thumb tap.
- **A11y**: Good use of `aria-label` on icon buttons and states, screen-reader friendly tooltips, and visible focus rings (`focus-visible:ring-2`).
- **Responsive**: Dynamic tooltip positioning based on viewport width (`isMobile` media query) ensures popovers don't clip off-screen.

## Recommendations

All recommendations are **non-blocking** and can be addressed post-launch or in a fast-follow PR.

1. **Pause/Resume Visual Feedback**: While the pause state has clear button controls, consider adding a blinking indicator or a dimmed "Paused" overlay directly on the waveform to make the suspended state even more obvious at a glance.
2. **Offline Mode Indicator Persistence**: The offline card is helpful, but when offline, consider a persistent, slim sticky banner at the very top of the page so the rep knows they are offline even if they scroll down to the recent captures table.
3. **Queue Auto-Retry Escalation**: For offline notes that fail to sync repeatedly (e.g., >3 attempts), consider changing the badge color to a more severe red and forcing a manual user acknowledgement before attempting auto-sync again.

Overall, this is a highly robust, fault-tolerant, and polished interface that sets a new high bar for QEP's mobile-first field tools.