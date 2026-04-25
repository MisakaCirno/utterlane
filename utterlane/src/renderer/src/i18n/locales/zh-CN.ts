/**
 * 中文文案。
 *
 * 分组约定：按 UI 位置 / 关注点拆命名空间，避免单一巨大 namespace。
 * 技术专有名词（Segment / Take / WAV / SRT / Dockview / Dark …）保持原文，
 * 在两种语言里都已经是通用表达，翻译反而不直观。
 */
export const zhCN = {
  common: {
    cancel: '取消',
    confirm: '确认',
    close: '关闭',
    delete: '删除',
    save: '保存',
    ok: '好'
  },

  app: {
    title: 'Utterlane',
    tagline: '口播录音工作流'
  },

  menu: {
    file: 'File',
    file_new: '新建工程…',
    file_open: '打开工程…',
    file_close: '关闭工程',
    file_save: '保存',
    file_import: '导入文案…',
    file_export: '导出',
    file_export_wav: '导出音频（WAV）…',
    file_export_srt: '导出字幕（SRT）…',
    file_exit: '退出',
    edit: 'Edit',
    edit_undo: '撤销',
    edit_redo: '重做',
    edit_undo_labeled: '撤销：{{label}}',
    edit_redo_labeled: '重做：{{label}}',
    edit_delete: '删除',
    view: 'View',
    view_reset_layout: '重置布局',
    view_toggle_segments: '显示 / 隐藏 Segments',
    view_toggle_inspector: '显示 / 隐藏 Inspector',
    view_toggle_timeline: '显示 / 隐藏 Timeline',
    view_dock_theme: 'Dock 主题（预览）',
    transport: 'Transport',
    transport_record: '录音',
    transport_rerecord: '重录',
    transport_play_segment: '播放当前句',
    transport_play_project: '播放项目',
    transport_stop: '停止',
    help: 'Help',
    help_about: '关于 Utterlane',
    help_license: '许可证（MPL-2.0）',
    help_homepage: '项目主页',
    help_open_logs: '打开日志目录'
  },

  welcome: {
    new_project: '新建工程',
    new_project_hint: '从一段文案开始',
    open_project: '打开工程',
    open_project_hint: '选择现有工程目录',
    recent_projects: '最近工程',
    no_recent: '还没有最近工程',
    remove_recent: '从最近工程中移除'
  },

  segments: {
    col_order: '#',
    col_text: '文案',
    col_status: '状态',
    col_takes: 'Takes',
    col_duration: '时长',
    status_unrecorded: '未录制',
    status_recorded: '已录制',
    status_multi_take: '多 Take',
    empty_title: '还没有任何 Segment',
    empty_hint: '把文案粘贴进来，每一行会被拆成一个 Segment',
    empty_action: '导入文案'
  },

  inspector: {
    unselected: '未选中 Segment',
    field_order: '顺序',
    field_text: '文案',
    btn_play: '播放',
    btn_stop: '停止',
    btn_record: '录音',
    btn_stop_recording: '停止录音',
    btn_cancel: '取消',
    btn_rerecord: '重录',
    btn_delete_segment: '删除 Segment',
    takes_label: 'Takes',
    takes_count: '{{count}} 个',
    takes_empty: '还没有录音',
    take_item: 'Take {{index}}',
    take_set_current: '设为当前',
    take_current: '当前',
    take_delete_aria: '删除 Take',
    level_label: '电平'
  },

  timeline: {
    row_segment: 'Segment',
    row_project: 'Project',
    btn_prev_segment: '上一句',
    btn_next_segment: '下一句',
    btn_prev_take: '上一个 Take',
    btn_next_take: '下一个 Take',
    btn_play_segment: '播放当前句',
    btn_stop_segment: '停止',
    btn_pause: '暂停',
    btn_resume: '继续',
    btn_record: '录音',
    btn_stop_recording: '停止录音',
    btn_rerecord: '重录（覆盖当前 Take）',
    btn_play_project_from_start: '从头播放项目',
    btn_play_project: '播放项目',
    btn_stop_project: '停止项目',
    btn_pause_project: '暂停项目',
    btn_resume_project: '继续项目',
    clip_unrecorded: '未录制',
    section_segment: 'Segment 时间轴',
    section_project: '项目时间轴',
    segment_text_placeholder: '选中 Segment 后在此编辑文案',
    waveform_unrecorded: '未录制',
    waveform_loading: '加载波形中…',
    waveform_error: '波形加载失败：{{message}}'
  },

  project_settings: {
    section_info: '工程信息',
    section_export_defaults: '默认导出设置',
    section_paths: '路径信息',
    field_title: '名称',
    field_sample_rate: '采样率',
    field_channels: '声道数',
    field_audio_format: '音频格式',
    field_subtitle_format: '字幕格式',
    field_segments_file: 'Segments 文件',
    field_audios_dir: '音频目录',
    channel_mono: 'Mono',
    channel_stereo: 'Stereo'
  },

  statusbar: {
    saved: '已保存',
    unsaved: '未保存',
    default_input: '默认输入设备',
    no_project: '无活动工程',
    playback_idle_unrecorded: '未录制',
    playback_idle_recorded: '已录制',
    playback_recording: '正在录音',
    playback_segment: '正在播放当前句',
    playback_segment_paused: '当前句已暂停',
    playback_project: '正在播放项目',
    playback_project_paused: '项目已暂停',
    background_none: '后台任务：无',
    segment_index: 'Segment {{index}} / {{total}}',
    take_index: 'Take {{index}} / {{total}}',
    sample_rate: '{{khz}} kHz · {{channels}}'
  },

  import_dialog: {
    title: '导入文案',
    description: '粘贴文案，每行会被拆分为一个 Segment（空行会被忽略）。',
    placeholder: '在这里粘贴你的文案…',
    will_generate: '将生成 <strong>{{count}}</strong> 条 Segment',
    overwrite_warning: '当前已有 {{count}} 条，导入会替换',
    btn_import: '导入',
    btn_import_count: '导入 ({{count}})',
    confirm_replace_title: '替换已有 Segments？',
    confirm_replace_description: '当前工程已有 {{count}} 条 Segment，导入会全部替换。',
    confirm_replace_btn: '替换'
  },

  confirm: {
    delete_segment_title: '删除这条 Segment？',
    close_recording_title: '正在录音，确定关闭吗？',
    close_recording_description: '当前录音将被丢弃。',
    close_recording_btn: '关闭并丢弃',
    close_unsaved_title: '还有未保存的改动，确定关闭吗？',
    close_unsaved_btn: '丢弃并关闭'
  },

  errors: {
    open_project_title: '无法打开工程',
    project_busy_title: '工程已被占用',
    project_busy_description: '已在另一个窗口中打开（PID {{pid}}）。请先关闭那个窗口后再试。',
    save_segments_title: '保存失败',
    save_segments_description: 'segments.json 写入出错：{{message}}',
    recording_start_title: '无法开始录音',
    recording_stop_title: '停止录音失败',
    recording_persist_title: '录音落盘失败'
  },

  export: {
    success_title: '{{kind}}导出成功',
    failure_title: '{{kind}}导出失败',
    skipped_count: '跳过 {{count}} 条未录制段',
    kind_wav: 'WAV 音频',
    kind_srt: 'SRT 字幕'
  },

  crash: {
    title: '应用程序遇到未处理的错误',
    description: '错误已写入日志。可以复制下方信息附在反馈中，或打开日志目录查看完整记录。',
    stack_label: '调用栈',
    copy_btn: '复制错误信息',
    open_logs_btn: '打开日志目录',
    copied: '错误信息已复制到剪贴板'
  },

  about: {
    title: '关于',
    version: 'v{{version}}',
    license_label: '本软件使用',
    license_suffix: '协议开源',
    diagnostics_label: '诊断信息',
    copy_btn: '复制',
    copy_tooltip: '复制版本与运行时信息（提交 bug 时附上）',
    copied: '已复制到剪贴板'
  },

  level_meter: {
    title: '电平'
  },

  history: {
    edit_text: '编辑文案',
    reorder: '调整 Segment 顺序',
    delete_segment: '删除 Segment',
    delete_take: '删除 Take',
    set_selected_take: '切换当前 Take',
    import_script: '导入文案'
  },

  tab_menu: {
    header_position: 'Tab 栏位置',
    position_top: '上方',
    position_bottom: '下方',
    position_left: '左侧',
    position_right: '右侧'
  },

  preferences: {
    menu_entry: '偏好设置…',
    title: '偏好设置',
    section_appearance: '外观',
    section_project_defaults: '新工程默认',
    label_dock_theme: 'Dock 主题',
    label_font_scale: '字体缩放',
    label_language: '界面语言',
    label_segment_text_align: 'Segment Timeline 文案对齐',
    label_inspector_text_align: 'Inspector 文案对齐',
    label_sample_rate: '默认采样率',
    label_channels: '默认声道',
    font_scale_small: '紧凑',
    font_scale_default: '默认',
    font_scale_large: '舒适',
    font_scale_xlarge: '宽松',
    language_zh_cn: '简体中文',
    language_en_us: 'English'
  }
}

export type TranslationSchema = typeof zhCN
