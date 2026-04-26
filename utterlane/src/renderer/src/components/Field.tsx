export function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  // items-baseline + leading-relaxed：让 label 与 children 第一行的文字
  // 基线对齐。原来用 items-start + pt-1 是为了把 label 视觉上往下推一点
  // 对齐 input 控件，但纯文本内容（如 ProjectSettings 的「音频格式 / WAV」）
  // 没有 input 的内边距，pt-1 反而让 label 比文本低一截。基线对齐对单
  // 行文本 / input / 多行块（取第一行基线）都给出一致的视觉效果
  return (
    <div className="flex items-baseline gap-3 py-1 leading-relaxed">
      <div className="w-24 shrink-0 text-right text-2xs text-fg-muted">{label}</div>
      <div className="flex-1 text-xs">{children}</div>
    </div>
  )
}
