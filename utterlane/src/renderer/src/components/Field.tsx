export function Field({
  label,
  children
}: {
  label: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-start gap-3 py-1">
      <div className="w-24 shrink-0 pt-1 text-right text-2xs text-fg-muted">{label}</div>
      <div className="flex-1 text-xs">{children}</div>
    </div>
  )
}
