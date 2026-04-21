# Utterlane
## 技术选型
- 基础框架
  - Electron
  - electron-vite
  - React
  - TypeScript
- 第三方库
  - 界面与布局 (UI & Layout)
    - Tailwind CSS：原子化 CSS 样式引擎。
      - 可以用，但别让它主导组件体系：用 Tailwind 做样式层，用你自己的组件约束做界面气质。
    - Radix UI (Primitives)：无头组件库（Headless UI）。
      - 只拿行为层，不拿视觉层。
    - react-resizable-panels：窗格化布局引擎。
    - Lucide React：矢量图标库。
  - 状态管理与高性能渲染
    - Zustand：全局状态管理。
    - Native Canvas API (HTML5 原生)：音频波形与时间轴渲染。
      - 只用于“高密度重绘区”。
  - 录音模块
    - miniaudio：Web Audio API 的轻量级录音库。

## 项目信息
为了解决口播类视频制作时，常规的录音软件需要录音后生成字幕，再花费大量时间剪辑音频与字幕对齐的问题，我构思了 Utterlane 这款工具。

它核心的功能是，用户先将自己的文案导入工具，然后将每一行拆分为一个需要录音的Segment。
这样，用户就可以对着文案的每一行录音，把每一行视作一个Segment，每次录音视作一个Take，用户可以在Segment列表里管理每个Segment的多个Take，选择最满意的Take作为该Segment的最终版本。
同时，在导出音频的同时，由于用户是对着文案录音的，所以天生可以快速生成一份对齐时间轴的字幕文件，极大地提升了口播视频的制作效率。
后续还可以增加一些对音频做后处理的功能，比如降噪、压缩、均衡等，进一步提升音频质量。
以及可以调整句尾停顿、段尾停顿时间等功能，帮助用户更好地控制口播的节奏感。

本工具采用**Mozilla Public License Version 2.0**开源协议。

## 核心概念

### Segment
Segment是Utterlane中的核心概念之一，代表文案中的一个段落或一句话。每个Segment可以包含多个Take，每个Take对应一次录音尝试。用户可以在Segment列表中管理每个Segment的多个Take，选择最满意的Take作为该Segment的最终版本。

### Take
Take是Segment下的一个录音尝试，包含录音文件的路径和相关信息。用户可以对每个Segment进行多次录音，每次录音都会生成一个新的Take，用户可以在Segment列表中查看和管理这些Take。

## UI设计

### 设计要求
软件的界面风格需要更接近生产力工具的风格，而不是炫技的网页。
不需要标题式的大字体，不需要卡片式的大边距、留白。避免浪费宝贵的屏幕空间，影响操作效率。
不需要过多的颜色，或者渐变色等设计。只需要简约、清晰、功能性强的界面设计，突出工具的实用性和高效性。
可以参考Adobe的AU、PR、AE等软件的风格和配色。

### 视图

#### Segment列表视图

#### Inspector视图

#### Timeline & Control视图

## 用户使用流程
1. 用户创建一个新项目，输入项目的基本信息（如项目名称、音频设置等）。
2. 用户将文案导入工具，工具会自动将文案拆分为多个Segment，每个Segment对应文案中的一个段落或一句话。
3. 用户在Segment列表视图中选择一个Segment，在Control视图中开始录音。用户可以对每个Segment进行多次录音，每次录音都会生成一个新的Take。
4. 用户在Segment列表视图中查看和管理每个Segment的多个Take，选择最满意的Take作为该Segment的最终版本。
5. 用户可以在Timeline视图中查看每个Segment的时间轴，调整Segment的起始时间和持续时间，以控制口播的节奏感。
6. 用户完成录音和调整后，可以导出最终的音频文件和对齐时间轴的字幕文件，进行后续的视频制作。

## 数据结构

### 核心数据结构

#### `Take`
``` typescript
type Take = {
  /** 唯一标识符 */
  id: string;
  /** 录音文件路径（相对于项目的路径） */

  filePath: string;
}
```

#### `Segment`
``` typescript
type Segment = {
  /** 唯一标识符 */
  id: string;
  /** 文案内容 */
  text: string;
  /** 录音尝试列表 */
  takes: Take[];
  /** 选中的录音尝试ID */
  selectedTakeId?: string;
}
```

### 存储数据结构

#### `Segments`
``` typescript
type SegmentsFile = {
  /** 模式版本 */
  schemaVersion: number;
  /** Segment 顺序 */
  order: string[];
  /** 根据 ID 存储的 Segment */
  segmentsById: Record<string, Segment>;
}
```

#### `Project`
``` typescript
type ProjectFile = {
  /** 模式版本 */
  schemaVersion: number;
  /** 项目唯一标识符 */
  id: string;
  /** 项目标题 */
  title: string;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;

  audio: {
    /** 采样率 */
    sampleRate: number;
    /** 声道数 */
    channels: 1 | 2;
  };

  /** 路径信息 */
  paths: {
    /** Segment 文件路径 */
    segmentsFile: string;
    /** 音频目录路径 */
    audioDir: string;
  };

  /** 导出默认设置 */
  exportDefaults: {
    /** 默认音频格式 */
    audioFormat: "wav";
    /** 默认字幕格式 */
    subtitleFormat: "srt";
  };
}
```

#### `Workspace`
``` typescript
type WorkspaceFile = {
  /** 模式版本 */
  schemaVersion: number;

  /** 当前选中的 Segment ID */
  selectedSegmentId?: string;

  /** 脚本列表滚动位置 */
  scriptListScrollTop?: number;

  /** 时间轴滚动位置 */
  timelineScrollLeft?: number;
  /** 时间轴缩放比例 */
  timelineZoom?: number;

  /** 布局信息 */
  layout?: {
    /** 顶部面板高度 */
    topPaneHeight?: number;
    /** 上部拆分左侧宽度 */
    upperSplitLeftWidth?: number;
  };

  /** 窗口信息 */
  window?: {
    /** 窗口宽度 */
    width?: number;
    /** 窗口高度 */
    height?: number;
    /** 窗口 X 坐标 */
    x?: number;
    /** 窗口 Y 坐标 */
    y?: number;
    /** 窗口是否最大化 */
    maximized?: boolean;
  };
}
```

## 项目目录结构
```
- `project.json`：存储项目元信息的文件
- `workspace.json`：存储工作区信息的文件
- `segments.json`：存储 Segment 和 Take 结构信息的文件
- `audios`：存储音频文件的目录
  - `[Segement UUID]`：一个 Segment 对应一个目录
    - `[Take UUID].wav`：Segment 下的每个 Take 对应一个音频文件
- `temp`：临时路径
```