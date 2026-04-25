import type { TranslationSchema } from './zh-CN'

/**
 * English resources. Schema mirrors zh-CN exactly (TypeScript enforces this).
 */
export const enUS: TranslationSchema = {
  common: {
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    delete: 'Delete',
    save: 'Save',
    ok: 'OK'
  },

  app: {
    title: 'Utterlane',
    tagline: 'Voice-over recording workflow'
  },

  menu: {
    file: 'File',
    file_new: 'New Project…',
    file_open: 'Open Project…',
    file_close: 'Close Project',
    file_save: 'Save',
    file_import: 'Import Script…',
    file_export: 'Export',
    file_export_wav: 'Export Audio (WAV)…',
    file_export_srt: 'Export Subtitles (SRT)…',
    file_audit: 'Audio File Audit…',
    file_exit: 'Exit',
    edit: 'Edit',
    edit_undo: 'Undo',
    edit_redo: 'Redo',
    edit_undo_labeled: 'Undo: {{label}}',
    edit_redo_labeled: 'Redo: {{label}}',
    edit_delete: 'Delete',
    view: 'View',
    view_reset_layout: 'Reset Layout',
    view_toggle_segments: 'Toggle Segments Panel',
    view_toggle_inspector: 'Toggle Inspector Panel',
    view_toggle_timeline: 'Toggle Timeline Panel',
    view_dock_theme: 'Dock Theme (Preview)',
    transport: 'Transport',
    transport_record: 'Record',
    transport_rerecord: 'Re-record',
    transport_play_segment: 'Play Current Segment',
    transport_play_project: 'Play Project',
    transport_stop: 'Stop',
    help: 'Help',
    help_about: 'About Utterlane',
    help_license: 'License (MPL-2.0)',
    help_homepage: 'Project Homepage',
    help_open_logs: 'Open Logs Folder'
  },

  welcome: {
    new_project: 'New Project',
    new_project_hint: 'Start from a script',
    open_project: 'Open Project',
    open_project_hint: 'Pick an existing project folder',
    recent_projects: 'Recent Projects',
    no_recent: 'No recent projects yet',
    remove_recent: 'Remove from recent'
  },

  segments: {
    col_order: '#',
    col_text: 'Text',
    col_status: 'Status',
    col_takes: 'Takes',
    col_duration: 'Duration',
    status_unrecorded: 'Not recorded',
    status_recorded: 'Recorded',
    status_multi_take: 'Multi-take',
    empty_title: 'No segments yet',
    empty_hint: 'Paste your script; each line becomes a Segment',
    empty_action: 'Import Script',
    search: 'Search',
    search_placeholder: 'Filter by text…',
    search_match_count: '{{count}} / {{total}}',
    batch_selected: '{{count}} selected',
    batch_delete: 'Delete selected',
    tb_new: 'New Segment (append)',
    tb_insert_before: 'Insert before selected',
    tb_insert_after: 'Insert after selected',
    tb_delete_selected: 'Delete selected (incl. batch)',
    tb_clear_all: 'Clear all Segments',
    tb_import_script: 'Import script…',
    tb_find_replace: 'Find / Replace (Ctrl+F)',
    tb_paragraph_head: 'Toggle paragraph head on selected',
    tb_paragraph_head_locked: 'First segment is always a paragraph head',
    find_placeholder: 'Find…',
    replace_placeholder: 'Replace with…',
    replace_all: 'Replace All',
    replace_done_title: 'Replace done',
    replace_done_desc: 'Replaced text in {{count}} segment(s)',
    replace_none_title: 'No matches',
    replace_none_desc: 'No segment contains the search text'
  },

  inspector: {
    unselected: 'No segment selected',
    field_order: 'Order',
    field_text: 'Text',
    btn_play: 'Play',
    btn_stop: 'Stop',
    btn_record: 'Record',
    btn_stop_recording: 'Stop recording',
    btn_cancel: 'Cancel',
    btn_rerecord: 'Re-record',
    btn_delete_segment: 'Delete Segment',
    btn_split: 'Split',
    btn_split_hint: 'Place the cursor inside the text where to split, then click here',
    btn_merge_prev: 'Merge into previous',
    btn_paragraph_head: 'Paragraph head',
    btn_paragraph_head_locked: 'First segment is always a paragraph head',
    takes_label: 'Takes',
    takes_count: '{{count}}',
    takes_empty: 'No recordings yet',
    take_item: 'Take {{index}}',
    take_set_current: 'Set as current',
    take_current: 'Current',
    take_delete_aria: 'Delete Take',
    level_label: 'Level'
  },

  timeline: {
    row_segment: 'Segment',
    row_project: 'Project',
    btn_prev_segment: 'Previous segment',
    btn_next_segment: 'Next segment',
    btn_prev_take: 'Previous Take',
    btn_next_take: 'Next Take',
    btn_play_segment: 'Play current segment',
    btn_stop_segment: 'Stop',
    btn_pause: 'Pause',
    btn_resume: 'Resume',
    btn_record: 'Record',
    btn_stop_recording: 'Stop recording',
    btn_rerecord: 'Re-record (overwrite current Take)',
    btn_play_project_from_start: 'Play project from start',
    btn_play_project: 'Play project',
    btn_stop_project: 'Stop project',
    btn_pause_project: 'Pause project',
    btn_resume_project: 'Resume project',
    clip_unrecorded: 'Not recorded',
    section_segment: 'Segment timeline',
    section_project: 'Project timeline',
    segment_text_placeholder: 'Select a segment to edit its text',
    waveform_unrecorded: 'Not recorded',
    waveform_loading: 'Loading waveform…',
    waveform_error: 'Waveform load failed: {{message}}'
  },

  project_settings: {
    section_info: 'Project',
    section_export_defaults: 'Export defaults',
    section_paths: 'Paths',
    field_title: 'Title',
    field_sample_rate: 'Sample rate',
    field_channels: 'Channels',
    field_audio_format: 'Audio format',
    field_subtitle_format: 'Subtitle format',
    field_segments_file: 'Segments file',
    field_audios_dir: 'Audios dir',
    channel_mono: 'Mono',
    channel_stereo: 'Stereo'
  },

  statusbar: {
    saved: 'Saved',
    unsaved: 'Unsaved',
    default_input: 'Default input',
    no_project: 'No active project',
    playback_idle_unrecorded: 'Not recorded',
    playback_idle_recorded: 'Recorded',
    playback_recording: 'Recording',
    playback_segment: 'Playing segment',
    playback_segment_paused: 'Segment paused',
    playback_project: 'Playing project',
    playback_project_paused: 'Project paused',
    background_none: 'Background: idle',
    segment_index: 'Segment {{index}} / {{total}}',
    take_index: 'Take {{index}} / {{total}}',
    sample_rate: '{{khz}} kHz · {{channels}}'
  },

  import_dialog: {
    title: 'Import Script',
    description: 'Paste script text; each line becomes a Segment (empty lines ignored).',
    placeholder: 'Paste your script here…',
    will_generate: 'Will generate <strong>{{count}}</strong> segments',
    overwrite_warning: '{{count}} existing will be replaced',
    btn_import: 'Import',
    btn_import_count: 'Import ({{count}})',
    confirm_replace_title: 'Replace existing segments?',
    confirm_replace_description:
      'This project already has {{count}} segments. Importing will replace them all.',
    confirm_replace_btn: 'Replace'
  },

  confirm: {
    delete_segment_title: 'Delete this segment?',
    delete_segments_title: 'Delete {{count}} selected segments?',
    clear_all_segments_title: 'Clear all {{count}} segments?',
    clear_all_segments_description:
      'You can undo with Ctrl+Z, but all Take references will be lost.',
    close_recording_title: 'Recording in progress. Close anyway?',
    close_recording_description: 'The current recording will be discarded.',
    close_recording_btn: 'Discard and close',
    close_unsaved_title: 'Unsaved changes. Close anyway?',
    close_unsaved_btn: 'Discard and close'
  },

  errors: {
    open_project_title: 'Failed to open project',
    project_busy_title: 'Project in use',
    project_busy_description:
      'Already open in another window (PID {{pid}}). Close that window first.',
    save_segments_title: 'Save failed',
    save_segments_description: 'Error writing segments.json: {{message}}',
    recording_start_title: 'Cannot start recording',
    recording_stop_title: 'Failed to stop recording',
    recording_persist_title: 'Failed to save recording',
    recording_device_missing: 'Recording device unavailable. Pick a different input in Preferences.'
  },

  export: {
    success_title: '{{kind}} export succeeded',
    failure_title: '{{kind}} export failed',
    skipped_count: 'Skipped {{count}} unrecorded segments',
    kind_wav: 'WAV audio',
    kind_srt: 'SRT subtitles'
  },

  crash: {
    title: 'Unhandled error',
    description:
      'The error has been logged. Copy the details below to attach to your bug report, or open the logs folder for the full record.',
    stack_label: 'Stack trace',
    copy_btn: 'Copy error info',
    open_logs_btn: 'Open logs folder',
    copied: 'Error info copied to clipboard'
  },

  about: {
    title: 'About',
    version: 'v{{version}}',
    license_label: 'Licensed under',
    license_suffix: '',
    diagnostics_label: 'Diagnostics',
    copy_btn: 'Copy',
    copy_tooltip: 'Copy version and runtime info (handy for bug reports)',
    copied: 'Copied to clipboard'
  },

  level_meter: {
    title: 'Level'
  },

  countdown: {
    cancel_hint: 'Press Esc or click anywhere to cancel'
  },

  history: {
    edit_text: 'Edit Text',
    reorder: 'Reorder Segments',
    delete_segment: 'Delete Segment',
    delete_take: 'Delete Take',
    set_selected_take: 'Switch Current Take',
    import_script: 'Import Script',
    split_segment: 'Split Segment',
    merge_segment: 'Merge Segment',
    delete_segments_batch: 'Batch Delete Segments',
    insert_segment: 'New Segment',
    insert_segment_before: 'Insert Segment Before',
    insert_segment_after: 'Insert Segment After',
    clear_segments: 'Clear Segments',
    set_paragraph_start: 'Toggle Paragraph Head',
    replace_all: 'Replace All'
  },

  audit_dialog: {
    title: 'Audio File Audit',
    rescan: 'Rescan',
    section_missing: 'Missing Takes',
    section_missing_hint: 'Referenced by segments.json but the file cannot be found on disk',
    section_missing_empty: 'No missing takes',
    section_orphans: 'Orphan WAVs',
    section_orphans_hint: 'Files in audios/ that no segment references',
    section_orphans_empty: 'No orphan files',
    column_segment: '#',
    column_text: 'Text',
    column_path: 'Expected path',
    column_file: 'File',
    column_size: 'Size',
    column_mtime: 'Modified',
    column_actions: 'Actions',
    btn_remap: 'Pick WAV…',
    btn_save_as_take: 'Save as Take…',
    btn_delete_orphan: 'Delete',
    save_as_take_dialog_title: 'Pick target segment',
    save_as_take_dialog_desc: 'Which segment should this WAV be added to?',
    inspector_missing_badge: 'missing',
    inspector_missing_tooltip: 'File missing. Use File → Audio File Audit to recover',
    bytes_kb: '{{value}} KB',
    bytes_mb: '{{value}} MB',
    toast_remap_success: 'Take file restored',
    toast_remap_failure: 'Restore failed',
    toast_save_as_take_success: 'Added as new Take',
    toast_save_as_take_failure: 'Save failed',
    toast_delete_success: 'Moved to recycle bin',
    toast_delete_failure: 'Delete failed'
  },

  export_dialog: {
    title: 'Export Audio',
    section_mode: 'Export Mode',
    mode_concat: 'Concatenate into one WAV',
    mode_concat_hint: 'All segments merged into a single file in order',
    mode_split: 'One WAV per segment',
    mode_split_hint: 'Each segment becomes its own WAV, filename prefixed with index + text',
    section_format: 'Audio Format',
    label_sample_rate: 'Sample rate',
    label_bit_depth: 'Bit depth',
    sample_rate_match_project: 'Match project ({{rate}} Hz)',
    bit_depth_pcm16: '16-bit PCM (best compatibility)',
    bit_depth_pcm24: '24-bit PCM (higher dynamic range)',
    bit_depth_float32: '32-bit IEEE float (DAW friendly)',
    section_effects: 'Post-processing',
    label_silence_padding: 'Silence between segments',
    silence_off: 'None',
    silence_ms: '{{count}} ms',
    silence_split_note:
      'Silence padding has no effect in split mode (each segment is its own file)',
    label_peak_normalize: 'Peak normalization',
    peak_off: 'Off',
    peak_minus_1: '-1 dB (near max)',
    peak_minus_3: '-3 dB (recommended)',
    peak_minus_6: '-6 dB (keep headroom)',
    peak_minus_12: '-12 dB (plenty of headroom)',
    btn_export: 'Export'
  },

  tab_menu: {
    header_position: 'Tab bar position',
    position_top: 'Top',
    position_bottom: 'Bottom',
    position_left: 'Left',
    position_right: 'Right'
  },

  preferences: {
    menu_entry: 'Preferences…',
    title: 'Preferences',
    section_appearance: 'Appearance',
    section_project_defaults: 'New project defaults',
    section_recording: 'Recording',
    label_input_device: 'Input device',
    input_device_default: '(System default)',
    label_countdown: 'Pre-recording countdown',
    countdown_off: 'Off',
    countdown_seconds: '{{count}} sec',
    label_dock_theme: 'Dock theme',
    label_font_scale: 'Font scale',
    label_language: 'Language',
    label_segment_text_align: 'Segment Timeline alignment',
    label_inspector_text_align: 'Inspector alignment',
    label_sample_rate: 'Default sample rate',
    label_channels: 'Default channels',
    font_scale_small: 'Compact',
    font_scale_default: 'Default',
    font_scale_large: 'Comfortable',
    font_scale_xlarge: 'Roomy',
    language_zh_cn: '简体中文',
    language_en_us: 'English',
    section_keyboard: 'Keyboard',
    kb_press_keys: 'Press new keys… (Esc to cancel)',
    kb_unbound: 'Unbound',
    kb_reset: 'Reset',
    kb_action_record: 'Record',
    kb_action_rerecord: 'Re-record (overwrite current Take)',
    kb_action_playSegment: 'Play current segment / pause',
    kb_action_playProject: 'Play project / pause',
    kb_action_prevSegment: 'Previous segment',
    kb_action_nextSegment: 'Next segment',
    kb_action_stopOrCancel: 'Stop / Cancel'
  }
}
