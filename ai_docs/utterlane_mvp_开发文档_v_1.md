# Utterlane MVP 开发文档 v1

## 1. 项目目标

Utterlane 是一款面向口播视频场景的跨平台桌面端录音软件。

MVP 的目标不是做成完整音频工作站，而是先把下面这条核心链路跑通：

1. 用户导入或粘贴一段文案
2. 软件按行切分为多个 segment
3. 用户逐句录音
4. 用户可以重录某一句，或者为某一句录多个 take
5. 用户可以调整句子顺序
6. 用户最终导出一份完整 WAV 和一份 SRT

一句话定义：

**Utterlane MVP = 一个面向口播创作者的分段录音与字幕导出桌面工具。**

---

## 2. MVP 功能边界

### 2.1 MVP 必做

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
- selectedTakeId 正常保存与恢复

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
- 导出时只使用每个 segment 的 selectedTakeId
- 导出顺序按 order
- 导出前检查未录制 segment 和缺失文件

#### 基础桌面体验
- 菜单栏
- 基础错误提示
- 基础空状态
- 基础快捷键
- 启动时清理无主临时文件

### 2.2 MVP 明确不做

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

## 3. 技术路线

### 3.1 技术栈
- Electron
- React
- TypeScript

### 3.2 录音架构
- 录音后端设计为可替换
- MVP 优先使用原生录音后端
- 首选方向：miniaudio
- 备选方向：PortAudio
- 录音服务运行在 Electron utility process
- Renderer 不直接承担实时录音主链路
- 通信链路为：Renderer -> Main -> Recorder Utility Process

### 3.3 导出
MVP 导出目标：
- 音频：WAV
- 字幕：SRT

MVP 只需要支持：
- 按当前 order 拼接每个 segment 的 selected take
- 基于 segment.text 和 take 时长生成 SRT

---

## 4. 数据模型

### 4.1 project.json
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

### 4.2 segments.json
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

### 4.3 workspace.json
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

### 4.4 核心数据规则
- 每个 segment 使用独立 UUID 作为身份
- 顺序不写在 segment 上，统一由 `order: string[]` 表示
- 一个 segment 可拥有多个 take
- 当前生效版本由 `selectedTakeId` 指定
- 导出、时间轴、试听均只使用 `selectedTakeId`

---

## 5. 工程目录结构

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

规则：
- `audio/` 下每个 segment 使用独立子目录
- `temp/` 用于录音临时文件和 JSON 临时写入文件
- 元数据集中保存在 `project.json / segments.json / workspace.json`
- 不为每个 segment 单独创建配置文件

---

## 6. 多 take 与录音规则

### 6.1 录音与重录语义
- **录音** = 新增一个 take
- **重录** = 覆写当前 selected take

### 6.2 规则
- 新增 take 后，自动设为 `selectedTakeId`
- 重录后，`selectedTakeId` 不变
- 没有当前 take 时，不允许重录
- 播放和设为当前是两个独立动作

### 6.3 删除规则
#### 删除 take
- 允许删除非当前 take
- 允许删除当前 take
- 删除非当前 take：直接删，`selectedTakeId` 不变
- 删除当前 take：自动修复到相邻 take；如果没有剩余 take，则置空
- 允许 segment 没有任何 take

#### 删除 segment
- 删除 `segmentsById` 中对应对象
- 删除 `order` 中对应 id
- 删除 `audio/<segment-id>/` 整个目录
- 删除后自动选中相邻 segment
- 删除前弹确认

---

## 7. 编辑器界面

## 7.1 布局策略
- 布局固定
- 支持拖动分隔条调整尺寸
- 支持记住上次布局
- 暂不支持 PR 式自由拖拽停靠和任意重组

## 7.2 总体布局
### 上半部分
- 左侧：文案列表（表格式）
- 右侧：属性面板

### 下半部分
- 顶部：时间轴控制栏
- 下方：时间轴内容区

## 7.3 左侧文案列表
表格列：
1. 序号
2. 文案
3. 状态
4. Takes
5. 时长

规则：
- 状态：
  - `0 take` -> 未录制
  - `1 take` -> 已录制
  - `>1 take` -> 多 take
- 时长：显示 `selectedTakeId` 对应 take 时长；无当前 take 时显示 `--`

行交互：
- 单击：选中 segment
- 双击文案：快速编辑文本
- 拖拽整行：调整顺序
- 右键菜单：录音 / 重录 / 删除 segment

## 7.4 右侧属性面板
右侧属性面板分为两页：
- Segment
- Project

默认打开 Segment 页。

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
- Take 名称
- 时长
- 播放
- 设为当前
- 删除
- 当前选中标记

规则：
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

## 7.5 时间轴控制栏
### 左侧：当前上下文
- 当前 segment，例如 `Segment 12 / 48`
- 当前 take，例如 `Take 2 / 3`
- 当前状态，例如：未录制、已录制、正在录音、正在播放当前句、正在播放项目

### 中间：当前 segment 控制
- 上一个 Segment
- 下一个 Segment
- 上一个 Take
- 下一个 Take
- 播放当前 Segment
- 暂停
- 停止
- 录音
- 重录

### 右侧：整个项目控制
- 播放项目
- 暂停
- 停止
- 从头播放项目

### 控制状态机（MVP）
- `idle`
- `recording`
- `playingSegment`
- `pausedSegment`
- `playingProject`
- `pausedProject`

### 控制规则摘要
- 录音、局部播放、全局播放三种状态互斥
- 录音中只保留停止
- 局部播放中只保留暂停和停止
- 全局播放中只保留暂停和停止
- `播放项目` 表示从暂停位置继续
- `从头播放项目` 表示从项目起点重新播放
- 没有 `selectedTakeId` 的 segment 不能局部播放，也不能重录，但可以录音

## 7.6 时间轴内容区
每个 clip 最低显示：
- 顺序号
- 文案缩略
- 基于 `selectedTakeId` 的片段长度
- 当前状态样式

状态样式：
- 未录制
- 已录制
- 当前选中
- 正在录音
- 正在播放

规则：
- 未录制 clip 仍然显示，使用固定最小宽度占位
- 单击 clip：选中对应 segment
- 拖拽 clip：调整顺序
- hover：显示完整文案提示

---

## 8. 导出最小闭环

### 8.1 导出格式
- 音频：WAV
- 字幕：SRT

### 8.2 导出规则
- 每个 segment 只使用 `selectedTakeId`
- 按 `order` 顺序导出
- 没有 `selectedTakeId` 的 segment 默认跳过

### 8.3 字幕规则
- 字幕文本直接使用 `segment.text`
- 一条 segment 对应一条字幕
- 字幕时间按当前 take 时长顺序累加生成

### 8.4 导出前检查
- 至少有一个可导出 segment
- 检查是否有未录制 segment
- 检查当前 take 文件是否存在

### 8.5 MVP 暂不做
- 用户可调淡入淡出
- 单句音量调整
- 响度归一化
- 自动转写字幕
- 更复杂字幕切分

---

## 9. 保存与落盘策略

### 9.1 原则
- `project.json` 和 `segments.json` 必须原子写入
- `workspace.json` 节流保存，要求低于前两者
- 录音和重录都先写到 `temp/`，成功后再转正

### 9.2 录音落盘
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

### 9.3 自动保存
- 工程内容改动后自动保存
- 菜单栏保留 Save 作为手动触发入口

### 9.4 保存触发
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

### 9.5 临时文件
- `temp/` 同时用于录音临时文件和 JSON 临时写入文件
- 启动工程时清理无主临时文件

---

## 10. 录音服务消息协议

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

## 11. 菜单栏与状态栏

### 11.1 菜单栏
MVP 建议做。

建议至少包含：
- File
- Edit
- View
- Transport
- Help

### 11.2 状态栏
不是必须。

如果做，只显示全局状态，例如：
- 已保存 / 未保存
- 当前输入设备
- 工程音频参数
- 导出状态

---

## 12. MVP 验收标准

### 12.1 用户流程验收
用户可以完整完成：
1. 新建工程
2. 粘贴文案
3. 自动生成多个 segment
4. 对若干 segment 录音
5. 对某一句重录
6. 对某一句录出多个 take 并切换当前 take
7. 调整几个 segment 的顺序
8. 播放某一句
9. 播放整个项目
10. 导出 WAV 和 SRT

### 12.2 数据验收
- 工程关闭后再次打开，内容不丢
- segment 顺序不乱
- selected take 不乱
- 时间轴和列表仍然一致
- 工程文件不容易因为异常退出损坏

### 12.3 体验验收
- 用户能理解“录音”和“重录”的区别
- 用户能理解“播放当前句”和“播放项目”的区别
- 用户能找到当前哪个 take 是生效的
- 用户能在不看文档的情况下完成基础导出

---

## 13. 建议开发顺序

### 第一阶段：数据和工程骨架
- 工程目录结构
- Project / Segment / Take 数据结构
- 保存 / 自动保存机制
- 打开 / 新建工程

### 第二阶段：录音链路
- Recorder Utility Process 跑起来
- 新增 take
- 重录当前 take
- 写 temp，再转正
- 当前句播放 / 停止

### 第三阶段：主编辑界面
- 左侧表格
- 右侧双页属性面板
- 时间轴
- 时间轴顶部控制栏
- 三处联动

### 第四阶段：导出闭环
- 按 selected take 拼接音频
- 导出 WAV
- 生成 SRT
- 导出前校验

### 第五阶段：首发打磨
- 菜单栏
- 快捷键
- 错误提示
- 空状态
- 启动清理临时文件

---

## 14. Codex 开工建议

Codex 第一轮建议直接先完成：

1. Electron + React + TypeScript 工程骨架
2. Project / Segment / Take 类型定义
3. 工程目录与 JSON 读写
4. 左侧表格 + 右侧属性面板的空壳 UI
5. 时间轴和控制栏的静态骨架
6. 基础状态管理

第二轮再接：
- Recorder Utility Process
- 原生录音后端接入
- take 新增 / 重录 / 播放
- 导出 WAV + SRT

这样推进最稳。

---

## 15. 最终结论

Utterlane MVP 的核心不是“强大的音频后期”，而是：

- 按文案分句组织录音
- 针对单句录音和重录
- 管理多个 take
- 用时间轴理解整体结构
- 最终直接导出音频和字幕

只要这条主链顺利跑通，Utterlane 就已经具备清晰的产品价值。

