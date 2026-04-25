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
    empty_action: 'Import Script'
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
    recording_persist_title: 'Failed to save recording'
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
    import_script: 'Import Script'
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
    language_en_us: 'English'
  }
}
