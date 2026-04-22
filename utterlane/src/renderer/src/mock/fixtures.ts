import type { Project, Segment } from '@renderer/types/project'

const lines = [
  '欢迎来到 Utterlane，一个专注于口播录音工作流的工具。',
  '你可以把整篇文案一次性粘贴进来。',
  '工具会按行自动拆分成一个个 Segment。',
  '每个 Segment 代表一句话，也代表时间轴上的一个片段。',
  '选中一个 Segment，就可以开始为它录音。',
  '录音会生成一个 Take，你可以录任意多次。',
  '如果当前这一句录得不够好，可以直接重录。',
  '重录会覆盖当前选中的 Take，而不是新建。',
  '你也可以在多个 Take 之间切换，挑出最满意的那条。',
  '对顺序不满意？直接拖动调整，时间轴会同步更新。',
  '写稿时候容易漏掉的停顿和换气，在这里都可以一句一句精修。',
  '完成之后，一键导出 WAV 和 SRT 字幕。',
  '字幕时间轴与音频自动对齐，不再需要手动校对。',
  '把时间花在内容上，而不是对齐字幕上。'
]

export const mockSegments: Segment[] = lines.map((text, i) => {
  const takeCount = i === 0 ? 0 : i === 4 ? 3 : i % 5 === 0 ? 2 : 1
  const takes = Array.from({ length: takeCount }, (_, t) => ({
    id: `tk-${i}-${t}`,
    filePath: `audios/seg-${i}/tk-${t}.wav`,
    durationMs: 1800 + Math.floor(Math.random() * 2400)
  }))
  return {
    id: `seg-${i}`,
    text,
    takes,
    selectedTakeId: takes.length > 0 ? takes[takes.length - 1].id : undefined
  }
})

export const mockProject: Project = {
  id: 'prj-demo',
  title: '演示工程',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  audio: {
    sampleRate: 48000,
    channels: 1
  },
  paths: {
    segmentsFile: 'segments.json',
    audiosDir: 'audios'
  },
  exportDefaults: {
    audioFormat: 'wav',
    subtitleFormat: 'srt'
  }
}

export const mockOrder: string[] = mockSegments.map((s) => s.id)
