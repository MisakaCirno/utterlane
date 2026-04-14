# Utterlane 讨论整理 v7

## 已经确定的内容

### 产品定位

Utterlane 是一款面向口播视频场景的跨平台桌面端录音软件。

它和普通录音软件的区别在于：

- 以 **segment（片段）** 为核心单位，而不是整段连续录音
- 每一句 / 每一行文案对应一个 segment
- 用户可以单独录制、重录、编辑、调整 segment 顺序
- 最终导出完整音频与字幕，减少后期剪辑和对字幕的时间

### 技术栈

- Electron
- React
- TypeScript

### 文案切分方式（MVP）

- 用户先打开或粘贴一段视频文案
- 软件先 **按行拆分** 文案
- 每一行生成一个 segment
- 用户通过换行控制 segment 粒度

### Segment 基础原则

- 每个 segment 都有独立的 **UUID**
- `UUID` 负责身份
- 顺序单独存储，不写死在单个 segment 对象里
- 重排时只改顺序列表，不依赖序号

### 音频架构方向

- UI 与录音链路解耦
- 录音后端设计为 **可替换**
- MVP 优先使用 **原生录音后端**
- 录音服务尽量独立于 UI
- 内部录音原始文件先统一使用 **WAV**

### 原生录音后端候选

- 首选方向：**miniaudio**
- 备选方向：**PortAudio**

### 开源与分发计划

- GitHub 开源
- Steam 低价售卖
- 项目主许可证：**Mozilla Public License Version 2.0**

---

## 当前基础工作流

1. 用户打开或粘贴一段视频文案
2. 软件按行拆分文案
3. 每一行生成一个 segment
4. 用户逐个 segment 录制
5. 用户可单独重录某个 segment
6. 用户可调整 segment 顺序
7. 每个 segment 可拥有多个 take，并选择其中一个作为当前生效版本
8. 最终导出完整音频与字幕

---

## 数据结构（当前已讨论版本）

### 整体思路

当前倾向于使用三个配置文件：

1. `project.json`
   - 存储 Project 级别的工程信息与全局设置
2. `segments.json`
   - 存储所有 segment 的内容、take 信息，以及独立的顺序列表
3. `workspace.json`
   - 存储不影响工程内容的 UI / 工作区状态

边界原则：

- **删掉 **``** 不应影响工程内容本身**
- **会影响导出结果的内容不能放进 **``

### `project.json`

```ts
type ProjectFile = {
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;

  audio: {
    sampleRate: number;
    channels: 1 | 2;
  };

  paths: {
    segmentsFile: string;
    audioDir: string;
  };

  exportDefaults: {
    audioFormat: "wav";
    subtitleFormat: "srt";
  };
}
```

### `segments.json`

```ts
type Take = {
  id: string;
  filePath: string;
}

type Segment = {
  id: string;
  text: string;
  takes: Take[];
  selectedTakeId?: string;
}

type SegmentsFile = {
  schemaVersion: number;
  order: string[];
  segmentsById: Record<string, Segment>;
}
```

### `workspace.json`

```ts
type WorkspaceFile = {
  schemaVersion: number;

  selectedSegmentId?: string;

  scriptListScrollTop?: number;

  timelineScrollLeft?: number;
  timelineZoom?: number;

  layout?: {
    topPaneHeight?: number;
    upperSplitLeftWidth?: number;
  };

  window?: {
    width?: number;
    height?: number;
    x?: number;
    y?: number;
    maximized?: boolean;
  };
}
```

---

## 当前建议的工程目录结构（草稿）

```text
MyProject/
  project.json
  segments.json
  workspace.json
  audio/
    <segment-id>/
      take-001.wav
      take-002.wav
  temp/
```

说明：

- `audio/` 中每个 segment 使用独立目录
- 一个 segment 下可以保存多个 take
- 当前阶段不为每个 segment 单独创建配置文件
- 元数据集中保存在 `segments.json`
- `temp/` 预留给录音临时文件和保存临时文件

---

## 当前已形成的关键结论

### 关于顺序

- 顺序属于工程内容
- 顺序不单独成文件
- 顺序放在 `segments.json` 里，作为独立的 `order: string[]`

### 关于 take

- 已决定支持“一个 segment 多个 take”
- 当前先用 **Segment 内嵌 takes 数组** 的简单结构
- 当前生效版本由 `selectedTakeId` 指定
- 未来如果 take 变复杂，再抽成更独立的对象结构

### 关于录音 / 重录 规则

- **录音** = 新增一个 take
- **重录** = 覆写当前选中的 take
- 新增 take 后，自动把它设为 `selectedTakeId`
- 重录后，`selectedTakeId` 不变
- 没有当前 take 时，不允许执行“重录”
- 导出、试听、时间轴都只使用 `selectedTakeId` 对应的 take
- 工程实现上建议先写入临时文件，再安全替换正式文件

### 关于音频目录

- `audio/` 下每个 segment 使用独立子目录
- 这样更方便管理多个 take
- 也为未来的波形缓存、分析结果等扩展留出了空间

---

## 录音服务架构（当前讨论版本）

### 进程分工

#### Renderer

负责编辑器 UI：

- 文案列表
- 属性面板
- 时间轴
- take 列表
- 电平显示
- 录音按钮状态

#### Main

负责协调：

- 打开工程
- 保存工程
- 创建和管理 utility process
- 转发高层命令
- 校验工程状态与路径
- 异常恢复

#### Recorder Utility Process

负责录音服务：

- 枚举输入设备
- 打开 / 关闭设备
- 开始录音
- 停止录音
- 取消录音
- 实时上报电平
- 把录音先写到临时文件
- 返回录音结果给主流程

### 通信链路

- `Renderer -> Main -> Recorder Utility Process`
- `Recorder Utility Process -> Main -> Renderer`

### 当前原则

- 录音服务运行在 **Electron utility process**
- UI 不直接承担实时录音主链路
- Renderer 通过 Main 间接调用录音服务
- 录音后端可替换，但对上层暴露统一接口

### 录音服务最小消息协议（草稿）

```ts
type RecorderCommand =
  | { type: "listInputDevices"; requestId: string }
  | { type: "initRecorder"; requestId: string; deviceId?: string }
  | { type: "startNewTake"; requestId: string; segmentId: string; tempOutputPath: string }
  | { type: "overwriteSelectedTake"; requestId: string; segmentId: string; takeId: string; tempOutputPath: string }
  | { type: "stopRecording"; requestId: string }
  | { type: "cancelRecording"; requestId: string };

type RecorderResponse =
  | {
      type: "listInputDevices:result";
      requestId: string;
      devices: Array<{ id: string; name: string; isDefault?: boolean }>;
    }
  | { type: "initRecorder:result"; requestId: string; ok: boolean; error?: string }
  | {
      type: "stopRecording:result";
      requestId: string;
      ok: boolean;
      tempFilePath?: string;
      durationMs?: number;
      error?: string;
    }
  | { type: "cancelRecording:result"; requestId: string; ok: boolean; error?: string };

type RecorderEvent =
  | {
      type: "recording-state";
      state: "idle" | "initializing" | "recording" | "stopping" | "error";
      segmentId?: string;
      takeId?: string;
    }
  | { type: "input-level"; db: number; peak: number }
  | { type: "recording-progress"; elapsedMs: number }
  | { type: "recording-error"; code: string; message: string }
  | { type: "device-lost"; deviceId?: string; message: string };
```

---

## 编辑器结构（当前讨论版本）

### 布局策略

- 编辑器总体布局固定
- 支持拖动分隔条调整尺寸
- 支持记住上次布局
- 暂不支持 PR 式自由拖拽停靠和任意重组

### 总体布局

#### 上半部分

- 左侧：**文案列表（表格式）**
- 右侧：**属性面板**

#### 下半部分

- 顶部：**时间轴控制栏**
- 下方：**时间轴内容区**

### 菜单栏与状态栏

- **菜单栏建议做**，用于承载低频但标准的桌面功能
- **状态栏不是必须**，可以后做；如果做，只显示全局状态

---

## 时间轴控制栏（当前讨论版本）

### 控制栏定位

- 控制栏集成在时间轴面板顶部
- 作为时间轴面板的 header
- 控制栏固定在上方，不随时间轴内容滚动

### 控制栏结构

#### 左侧：当前上下文

- 当前 segment，例如 `Segment 12 / 48`
- 当前 take，例如 `Take 2 / 3`
- 当前状态，例如：
  - 未录制
  - 已录制
  - 正在录音
  - 正在播放当前句
  - 正在播放项目

#### 中间：当前 segment 控制

- 上一个 Segment
- 下一个 Segment
- 上一个 Take
- 下一个 Take
- 播放当前 Segment
- 暂停
- 停止
- 录音
- 重录

#### 右侧：整个项目控制

- 播放项目
- 暂停
- 停止
- 从头播放项目

### 设计原则

- 两组按钮视觉上明确分区
- 录音、局部播放、全局播放三种状态互斥
- 控制栏持续显示当前 segment / take / 当前状态

### 控制状态机（MVP）

- `idle`
- `recording`
- `playingSegment`
- `pausedSegment`
- `playingProject`
- `pausedProject`

### 控制规则（摘要）

- 录音中只保留停止
- 局部播放中只保留暂停和停止
- 全局播放中只保留暂停和停止
- `播放项目` 表示从暂停位置继续
- `从头播放项目` 表示从项目起点重新播放
- 没有 `selectedTakeId` 的 segment 不能局部播放，也不能重录，但可以录音

---

## 左侧文案列表（当前讨论版本）

### 形式

- 左侧列表先采用 **表格式**

### 列结构

1. **序号**
2. **文案**
3. **状态**
4. **Takes**
5. **时长**

### 列定义

#### 序号

- 显示当前 `order` 中的位置
- 宽度固定，较窄

#### 文案

- 当前 segment 的文本内容
- 单行显示，超长省略
- hover 可显示完整文本

#### 状态

- `0 take` -> 未录制
- `1 take` -> 已录制
- `>1 take` -> 多 take

#### Takes

- 显示当前 segment 的 take 数量

#### 时长

- 显示 `selectedTakeId` 对应 take 的时长
- 没有当前 take 时显示 `--`

### 行交互

- 单击：选中该 segment
- 双击文案：快速编辑文本
- 拖拽整行：调整顺序
- 右键菜单：录音 / 重录 / 删除 segment

---

## 右侧属性面板（当前讨论版本）

### 面板结构

右侧属性面板分为两页：

- **Segment**
- **Project**

默认打开 **Segment** 页。

### Segment 页

#### 区块 1：基本信息

- 当前顺序号
- Segment 文本

#### 区块 2：当前句操作

- 播放当前句
- 停止
- 录音
- 重录

#### 区块 3：Take 列表

每个 take 显示：

- Take 名称，例如 `Take 1`
- 时长
- 播放
- 设为当前
- 删除
- 当前选中标记

规则：

- **播放** 和 **设为当前** 拆成两个动作
- 播放只是试听，不改变 `selectedTakeId`
- 设为当前才会更新 `selectedTakeId`

### Project 页

#### 区块 1：工程基本信息

- 工程名称
- 采样率
- 声道数

#### 区块 2：默认导出设置

- 默认音频格式
- 默认字幕格式

#### 区块 3：路径信息

- 工程目录
- 音频目录

---

## 时间轴内容区（当前讨论版本）

### 每个 clip 最低显示

- 顺序号
- 文案缩略
- 基于 `selectedTakeId` 的片段长度
- 当前状态样式

### 当前状态样式

- 未录制
- 已录制
- 当前选中
- 正在录音
- 正在播放

### 未录制 clip

- 仍然显示
- 使用固定最小宽度占位

### clip 交互

- 单击：选中对应 segment
- 拖拽：调整顺序
- hover：显示完整文案提示

---

## 删除规则（当前讨论版本）

### 删除 take

- 允许删除非当前 take
- 允许删除当前 take
- 删除非当前 take：直接删，`selectedTakeId` 不变
- 删除当前 take：自动修复到相邻 take；没有则置空
- 允许 segment 没有任何 take

### 删除 segment

- 删除 `segmentsById` 中的对象
- 删除 `order` 中的 id
- 删除 `audio/<segment-id>/` 整个目录
- 删除后自动选中相邻 segment
- 删除前弹确认

---

## 导出最小闭环（已确定）

### MVP 导出格式

- 音频：**WAV**
- 字幕：**SRT**

### 导出规则

- 每个 segment 只使用 `selectedTakeId`
- 按 `order` 顺序导出
- 没有 `selectedTakeId` 的 segment 默认跳过

### 字幕规则

- 字幕文本直接使用 `segment.text`
- 一条 segment 对应一条字幕
- 字幕时间按当前 take 时长顺序累加生成

### 导出前检查

- 至少有一个可导出 segment
- 检查是否有未录制 segment
- 检查当前 take 文件是否存在
- 如果存在未录制 segment，应提示这些句子会被跳过，由用户确认后继续

### MVP 暂不做

- 用户可调淡入淡出
- 单句音量调整
- 响度归一化
- 自动转写字幕
- 更复杂字幕切分

---

## 保存与落盘策略（已确定）

### 核心原则

- `project.json` 和 `segments.json` 必须原子写入
- `workspace.json` 节流保存，要求低于前两者
- 录音和重录都先写到 `temp/`，成功后再转正
- 工程内容改动后自动保存
- 菜单栏仍保留 Save 作为手动触发入口

### 保存触发

#### 立即保存 `segments.json`

- 导入文案并生成 segments
- 编辑 segment 文本
- 调整顺序
- 新增 take
- 重录成功
- 切换 `selectedTakeId`
- 删除 take
- 删除 segment

#### 保存 `project.json`

- 新建工程
- 修改工程名称
- 修改采样率 / 声道数
- 修改默认导出设置

#### 节流保存 `workspace.json`

- 切换当前选中 segment
- 滚动左侧列表
- 缩放 / 滚动时间轴
- 调整面板尺寸
- 窗口移动 / 缩放

### 录音 / 重录落盘

#### 录音（新增 take）

1. 录音服务写到 `temp/`
2. 停止成功后，移动到正式路径，例如 `audio/<segment-id>/take-003.wav`
3. 更新 `segments.json`
4. 自动设为 `selectedTakeId`

#### 重录（覆写当前 take）

1. 录音服务写到 `temp/`
2. 停止成功后，用临时文件替换当前 take 对应正式文件
3. `selectedTakeId` 不变
4. 保存 `segments.json`

### 临时文件

- `temp/` 同时用于录音临时文件和 JSON 临时写入文件
- 启动工程时清理无主临时文件

---

## MVP 边界（已确定）

### MVP 必做

#### 工程基础

- 新建工程
- 打开工程
- 自动保存工程
- 工程基础信息保存与恢复

#### 文案导入与切分

- 粘贴文案
- 导入文本文案文件
- 按行切分为 segment
- 为每个 segment 生成 UUID

#### Segment 基础编辑

- 选中 segment
- 编辑 segment 文本
- 删除 segment
- 拖拽调整 segment 顺序

#### 录音基础能力

- 为当前 segment 录音
- 录音会新增一个 take
- 重录会覆写当前 selected take
- 停止录音
- 当前句的播放 / 停止

#### Take 管理

- 一个 segment 支持多个 take
- 展示 take 列表
- 播放某个 take
- 将某个 take 设为当前
- 删除 take
- `selectedTakeId` 正常保存与恢复

#### 主编辑界面

- 左侧表格式文案列表
- 右侧双页属性面板（Segment / Project）
- 下方时间轴
- 时间轴顶部控制栏
- 列表 / 属性 / 时间轴联动
- 可调分隔尺寸
- 布局恢复

#### 导出闭环

- 导出完整 WAV
- 导出 SRT
- 导出时只使用每个 segment 的 `selectedTakeId`
- 导出顺序按 `order`
- 导出前检查未录制 segment 和缺失文件

#### 基础桌面体验

- 菜单栏
- 基础错误提示
- 基础空状态
- 基础快捷键
- 启动时清理无主临时文件

### MVP 明确不做

#### 音频后期类

- 单句音量调节
- 淡入淡出编辑
- 响度归一化
- EQ / 压缩 / 降噪
- 波形编辑
- 多轨混音

#### AI / 智能类

- 自动语音识别转写
- 自动生成字幕文本
- AI 润稿
- AI 配音
- 智能切句

#### 高级编辑类

- 自由布局 / Dock 系统
- 多窗口编辑
- 复杂时间轴操作
- clip 级别效果编辑
- segment 合并 / 拆分
- 批量编辑

#### 协作与云类

- 云同步
- 多人协作
- 账号系统

#### 复杂导出类

- MP3 / AAC / 视频导出
- 字幕样式模板
- 高级字幕切分策略
- 导出工程包格式

---

## 还没讨论清楚 / 还没拍板的内容

### 1. 录音层

- 原生后端最终是否直接选定 miniaudio
- Recorder Utility Process 与原生模块的集成方式
- 是否显示实时电平
- 是否支持录音监听
- 设备切换怎么做
- 录音异常怎么恢复
- 录音线程、缓冲区、写盘线程的内部模型

### 2. 文件与工程结构

- 录音文件命名规则是否固定为 `take-001.wav` 这类形式
- 是否保存波形缓存
- 是否支持撤销 / 重做

### 3. 许可证与分发

- 最终依赖清单
- 每个依赖的许可证确认
- Steam 打包策略
- 是否需要第三方许可证页面

### 4. 快捷键与菜单细节

- 菜单栏具体菜单结构
- 常用快捷键如何设计
- 是否需要全局快捷键或只在窗口内生效

---

## 当前比较重、需要优先做决策的事情

### A. 原生录音后端的具体实现方式

因为进程位置已初步明确，但实现路径还没拍板。

建议尽快明确：

- 先选 miniaudio 还是继续保留 PortAudio 备选
- 原生录音模块是 Node-API addon，还是独立 sidecar 进程
- utility process 内如何组织原生调用和写盘逻辑

### B. 许可证与依赖清单

因为这会影响：

- GitHub 开源合规性
- Steam 分发方式
- 第三方组件的商用风险

建议尽快明确：

- 音频处理、导出、UI 依赖的最终清单
- 每个依赖的许可证确认方式
- 第三方许可证页面是否作为 MVP 一部分

### C. 开发优先级与里程碑

因为已经进入可以让 Codex 开工的阶段，建议尽快明确一版真正执行用的里程碑顺序。

建议尽快明确：

- 第 1 轮先做到什么程度
- 第 2 轮先接录音还是先接静态 UI
- 哪些风险验证要在正式编码前先做 demo

---

## 建议的下一步讨论顺序

1. 原生录音后端的具体实现方式
2. 许可证与依赖清单
3. 开发优先级与里程碑
4. 菜单栏与快捷键细节

---

## 一句话总结

Utterlane 是一个面向口播创作者的跨平台桌面工具：用户先导入或粘贴文案，软件按行切分为 segment；用户逐段录制、重录、重排，并通过“表格式文案列表 + 双页属性面板 + 时间轴控制栏 + 时间轴”的联动编辑器完成整理；一个 segment 可以拥有多个 take，录音会新增 take，重录会覆写当前 take，用户选择其中一个作为当前生效版本，最终导出音频与字幕。

