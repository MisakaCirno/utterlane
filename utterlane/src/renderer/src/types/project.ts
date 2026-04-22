export type Take = {
  id: string
  filePath: string
  durationMs: number
}

export type Segment = {
  id: string
  text: string
  takes: Take[]
  selectedTakeId?: string
}

export type Project = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  audio: {
    sampleRate: number
    channels: 1 | 2
  }
  paths: {
    segmentsFile: string
    audiosDir: string
  }
  exportDefaults: {
    audioFormat: 'wav'
    subtitleFormat: 'srt'
  }
}

export type PlaybackMode = 'idle' | 'segment' | 'project' | 'recording'
