# Utterlane

## 项目定位

为了解决口播类视频制作时，常规录音软件往往需要录音后再生成字幕，并花费大量时间手动对齐音频与字幕的问题，我构思了 **Utterlane** 这款工具。

Utterlane 的核心思路是：

* 用户先将文案导入工具
* 工具按行将文案拆分为多个 Segment
* 用户逐句录音，每次录音生成一个 Take
* 用户可以管理每个 Segment 的多个 Take，并选择最满意的 Take 作为最终版本
* 最终导出完整音频的同时，基于文案内容和时间轴生成对齐字幕

它的价值不在于做一个完整音频工作站，而在于把“按稿录音、逐句重录、快速出字幕”的工作流做顺。

本工具采用 **Mozilla Public License Version 2.0** 开源协议。

---

## MVP范围

### MVP必做

* 创建项目
* 打开项目
* 自动保存项目
* 粘贴或导入文本文案
* 按行拆分为 Segment
* 编辑 Segment 文本
* 拖拽调整 Segment 顺序
* 为当前 Segment 录音
* 为当前 Segment 重录
* 一个 Segment 支持多个 Take
* 管理 Take 列表
* 选择某个 Take 作为当前版本
* 删除 Take
* 删除 Segment
* 播放当前 Segment
* 播放整个项目
* 导出 WAV
* 导出 SRT
* 菜单栏
* 状态栏（基础占位与全局状态显示）

### MVP明确不做

* 自动语音识别转写
* 自动生成字幕文本
* AI 润稿
* AI 配音
* 智能切句
* 自由布局 / Dock 系统
* 多窗口编辑
* 多轨编辑
* 波形精细编辑
* clip 级别效果编辑
* 单句音量调节
* 淡入淡出可视化编辑
* 响度归一化
* EQ / 压缩 / 降噪
* 云同步
* 多人协作
* 视频导出
* MP3 / AAC 导出
* 导出工程包格式

### MVP核心目标

Utterlane 的 MVP 目标不是做成完整的 NLE/DAW，而是先跑通下面这条链路：

* 文案导入
* 分句录音
* 多 Take 管理
* 顺序调整
* 导出音频与字幕

---

## 平台与发布范围

### 首发平台

* MVP 首发建议先支持：**Windows + macOS**
* Linux 不作为首发阻塞项

### 开发优先级

* 优先保证 Windows 和 macOS 下工程读写、录音、导出闭环可用
* 平台相关逻辑尽量收敛在主进程、预加载层和录音服务层
* Renderer 层尽量保持平台无关

### 平台相关要求

* 路径处理统一使用跨平台方式
* 不在工程文件中保存绝对路径
* 音频与项目内部路径统一使用相对路径

---

## 技术选型

### 基础框架

* Electron
* electron-vite
* React
* TypeScript

### 第三方库

#### 界面与布局（UI & Layout）

* Tailwind CSS：原子化 CSS 样式引擎。

  * 用 Tailwind 做样式层，不让它主导组件体系。
  * 界面气质由项目自身组件约束决定。
* Radix UI (Primitives)：无头组件库（Headless UI）。

  * 只拿行为层，不拿视觉层。
* react-resizable-panels：窗格化布局引擎。
* Lucide React：矢量图标库。

#### 状态管理与高性能渲染

* Zustand：轻量级全局状态管理。
* Native Canvas API (HTML5 原生)：用于时间轴与波形等高密度重绘区域。

  * 只用于高频、高密度渲染区，不扩大到普通表单与列表。

#### 音频相关模块

* miniaudio：单文件、无外部依赖的 C/C++ 音频播放与采集库。

  * 用于实现 Utterlane 的原生录音后端。
* FFmpeg（仅使用 LGPL 功能）：用于音频拼接、导出与格式转换。

### 依赖原则

* 优先使用轻量、可控、商用友好的库
* 不引入重型 UI 框架或强风格组件体系
* Radix 仅使用 Primitives，不使用 Themes
* Canvas 仅用于时间轴与波形绘制
* FFmpeg 仅使用 LGPL 路线，不启用 GPL / nonfree 组件

---

## 核心概念

### Segment

Segment 是 Utterlane 中的核心概念之一，代表文案中的一行、一句话或一个录音片段。

每个 Segment：

* 对应一段文案内容
* 可以包含多个 Take
* 最终只会选择一个 Take 作为当前生效版本
* 在时间轴上对应一个 clip

### Take

Take 是 Segment 下的一次录音尝试。

每个 Take：

* 对应一个实际音频文件
* 可以被试听
* 可以被设为当前版本
* 可以被删除

---

## 录音 / 重录 / Take 规则

### 录音

* 录音表示为当前 Segment 新增一个 Take
* 新增的 Take 会自动成为当前选中的 Take
* 当前选中的 Take 由 `selectedTakeId` 指定

### 重录

* 重录表示覆写当前选中的 Take
* 重录不会新建 Take
* 重录成功后，`selectedTakeId` 不变
* 如果当前 Segment 没有已选中的 Take，则不能执行重录

### Take 管理

* 一个 Segment 可以拥有多个 Take
* 用户可以播放任意 Take
* 用户可以将任意 Take 设为当前版本
* “播放 Take”和“设为当前”是两个独立动作

### 删除 Take

* 允许删除非当前 Take
* 允许删除当前 Take
* 删除非当前 Take 时，`selectedTakeId` 不变
* 删除当前 Take 时，应自动修复到相邻 Take；如果没有剩余 Take，则置空

### 空 Segment

* 允许 Segment 没有任何 Take
* 没有任何 Take 的 Segment 视为未录制状态

---

## 录音服务架构

### 进程分工

#### Renderer

负责编辑器 UI：

* Segments 列表
* Inspector 面板
* Timeline
* Control Bar
* 状态栏与菜单触发

#### Main

负责协调：

* 打开 / 保存工程
* 创建与管理 Recorder Utility Process
* 校验工程状态与路径
* 转发高层命令
* 处理异常恢复

#### Recorder Utility Process

负责录音服务：

* 枚举输入设备
* 初始化录音设备
* 开始录音
* 停止录音
* 取消录音
* 实时上报状态与电平
* 先写入临时文件，再交给主流程转正

### 通信原则

* `Renderer -> Main -> Recorder Utility Process`
* `Recorder Utility Process -> Main -> Renderer`
* Renderer 只处理高层状态，不直接接触底层音频实现
* 录音后端可替换，但对上层暴露统一接口

### 最小消息契约

#### 命令

* `listInputDevices`
* `initRecorder`
* `startNewTake`
* `overwriteSelectedTake`
* `stopRecording`
* `cancelRecording`

#### 响应

* `listInputDevices:result`
* `initRecorder:result`
* `stopRecording:result`
* `cancelRecording:result`

#### 事件

* `recording-state`
* `input-level`
* `recording-progress`
* `recording-error`
* `device-lost`

### 接口设计原则

* 接口以产品动作命名，而不是以底层音频库 API 命名
* UI 只关心“录音、重录、停止、取消、状态更新”这类高层行为
* 录音完成后先返回临时文件，由主流程决定如何落正式文件

---

## 模块边界

### Renderer 层负责

* 视图渲染
* 用户交互
* 本地 UI 状态
* 当前选中对象联动

### Main 层负责

* 工程文件读写
* 菜单栏与窗口生命周期
* 录音服务调度
* 导出任务调度
* 异常恢复与路径校验

### Recorder Service 负责

* 输入设备管理
* 原始音频采集
* 临时录音文件写入
* 录音状态上报

### Export Service 负责

* 按 `order` 遍历 Segment
* 读取 `selectedTakeId`
* 拼接音频
* 生成 SRT
* 执行导出前检查

### 边界原则

* Renderer 不直接读写工程文件
* Renderer 不直接接触原生录音后端
* 导出逻辑不放在 Renderer 中执行
* 录音逻辑与导出逻辑分离

---

## UI设计

### 设计要求

软件的界面风格需要更接近生产力工具，而不是炫技的网页。

设计原则：

* 不使用标题式的大字体
* 不使用卡片式的大边距和大留白
* 避免浪费宝贵的屏幕空间，影响操作效率
* 不使用过多颜色、渐变色或营销化视觉风格
* 整体风格以简约、清晰、功能性强为主
* 可参考 Adobe AU、PR、AE，以及 VSCode 等软件的风格与配色

### 总体布局

* 编辑器总体布局固定
* 支持拖动分隔条调整尺寸
* 支持记住上次布局
* 暂不支持 PR 式自由拖拽停靠和任意重组

#### 顶部

* 标题栏

#### 中部

* 上半部分面板

  * 左侧：Segments 视图
  * 右侧：Inspector 视图
* 下半部分面板

  * 顶部：Control Bar
  * 下方：Timeline 内容区

#### 底部

* 状态栏

### 标题栏

分为三部分：

* 左侧：软件图标、菜单栏
* 中间：当前项目路径或项目标题
* 右侧：窗口控制按钮（最小化、最大化 / 还原、关闭）

### 菜单栏

MVP 菜单栏建议至少包含：

* File：新建、打开、保存、导入文案、导出音频、导出字幕、退出
* Edit：撤销（预留）、重做（预留）、删除
* View：重置布局、显示 / 隐藏面板（可选）
* Transport：录音、重录、播放当前句、播放项目、停止
* Help：关于、许可证、项目链接

### 状态栏

状态栏用于承载全局状态，而不是当前句的细节信息。

建议显示：

* 保存状态（已保存 / 未保存）
* 当前项目音频设置（采样率、声道数）
* 背景任务状态（如导出中）
* 当前输入设备（可选）

状态栏在 MVP 中应作为正式布局的一部分存在，即使首版只显示占位信息。

### Segments视图

用于展示当前项目中的全部 Segment，并作为用户浏览、定位和排序的主视图。

#### 主要职责

* 按当前顺序展示所有 Segment
* 快速定位当前句子
* 显示每句是否已录制
* 显示每句的 Take 数量与当前时长
* 支持拖拽调整顺序

#### 推荐列结构

* 序号
* 文案
* 状态
* Takes
* 时长

#### 状态规则

* `0 take`：未录制
* `1 take`：已录制
* `>1 take`：多 Take

#### 支持交互

* 单击：选中当前 Segment
* 双击文案：快速编辑文本
* 拖拽整行：调整顺序
* 右键菜单：录音 / 重录 / 删除 Segment

#### 联动规则

* 选中某个 Segment 后：

  * Inspector 视图显示该 Segment 的信息
  * Timeline 视图定位并高亮对应 clip
  * Control 视图更新当前上下文

### Inspector视图

用于查看和编辑当前对象的属性，是当前编辑行为的主要入口。

Inspector 分为两个页面：

* Segment
* Project

#### Segment页

用于编辑当前选中的 Segment。

##### 基本信息

* 当前顺序号
* Segment 文本

##### 当前句操作

* 播放当前句
* 停止
* 录音
* 重录

##### Take列表

每个 Take 显示：

* Take 名称
* 时长
* 播放
* 设为当前
* 删除
* 当前选中标记

##### 行为规则

* “播放”只是试听，不会改变当前选中的 Take
* “设为当前”才会更新 `selectedTakeId`
* “录音”会新增一个 Take
* “重录”会覆写当前选中的 Take

#### Project页

用于编辑当前项目的全局设置。

##### 工程基本信息

* 工程名称
* 采样率
* 声道数

##### 默认导出设置

* 默认音频格式
* 默认字幕格式

##### 路径信息

* 工程目录
* 音频目录

### Control & Timeline视图

用于展示整个项目的时序结构，并提供当前句与整个项目的高频控制。

#### 结构

* 顶部：Control Bar
* 下方：Timeline 内容区

#### Control Bar

分为两组控制：

##### 当前 Segment 控制

* 上一个 Segment
* 下一个 Segment
* 上一个 Take
* 下一个 Take
* 播放当前 Segment
* 暂停
* 停止
* 录音
* 重录

##### 整个项目控制

* 播放项目
* 暂停
* 停止
* 从头播放项目

#### 当前上下文显示

* 当前 Segment，例如 `Segment 12 / 48`
* 当前 Take，例如 `Take 2 / 3`
* 当前状态，例如：

  * 未录制
  * 已录制
  * 正在录音
  * 正在播放当前句
  * 正在播放项目

#### Timeline内容区

每个 clip 最低显示：

* 顺序号
* 文案缩略
* 基于当前 `selectedTakeId` 的片段长度
* 当前状态样式

#### 未录制 clip

* 仍然显示
* 使用固定最小宽度占位

#### 支持交互

* 单击：选中对应 Segment
* 拖拽：调整顺序
* hover：显示完整文案提示

#### 控制原则

* 录音、局部播放、全局播放三种状态互斥
* 没有 `selectedTakeId` 的 Segment 不能局部播放，也不能重录，但可以录音

---

## 用户使用流程

1. 用户创建一个新项目，输入项目的基本信息（如项目名称、音频设置等）。
2. 用户将文案导入工具，工具会自动将文案拆分为多个 Segment，每个 Segment 对应文案中的一行或一句话。
3. 用户在 Segments 视图中选择一个 Segment，在 Control 视图中开始录音。用户可以对每个 Segment 进行多次录音，每次录音都会生成一个新的 Take。
4. 用户在 Segments 视图中查看和管理每个 Segment 的多个 Take，选择最满意的 Take 作为该 Segment 的最终版本。
5. 用户在 Timeline 视图中查看整个项目的顺序、片段长度和录制完成情况，并在需要时调整 Segment 顺序。
6. 用户完成录音和整理后，可以导出最终的音频文件和对齐时间轴的字幕文件，进行后续的视频制作。

---

## 数据结构

### 核心数据结构

#### `Take`

```typescript
type Take = {
  /** 唯一标识符 */
  id: string;
  /** 录音文件路径（相对于项目的路径） */
  filePath: string;
}
```

#### `Segment`

```typescript
type Segment = {
  /** 唯一标识符 */
  id: string;
  /** 文案内容 */
  text: string;
  /** 录音尝试列表 */
  takes: Take[];
  /** 选中的录音尝试 ID */
  selectedTakeId?: string;
}
```

### 存储数据结构

#### `Segments`

```typescript
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

```typescript
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
    audiosDir: string;
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

```typescript
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

边界原则：

* 删掉 `workspace.json` 不应影响工程内容本身
* 会影响导出结果的内容不能放进 `workspace.json`

---

## 项目目录结构

```text
- `project.json`：存储项目元信息的文件
- `workspace.json`：存储工作区信息的文件
- `segments.json`：存储 Segment 和 Take 结构信息的文件
- `audios`：存储音频文件的目录
  - `[Segment UUID]`：一个 Segment 对应一个目录
    - `[Take UUID].wav`：Segment 下的每个 Take 对应一个音频文件
- `temp`：临时路径
```

### 路径规则

* 工程内部引用统一使用相对路径
* 工程文件中不保存系统绝对路径
* Take 的 `filePath` 指向项目目录下的相对音频路径

---

## 导出规则

### MVP导出格式

* 音频：WAV
* 字幕：SRT

### 导出内容规则

* 每个 Segment 只使用 `selectedTakeId` 对应的 Take
* 导出顺序按 `segments.json` 中的 `order` 执行
* 没有 `selectedTakeId` 的 Segment 默认跳过

### 字幕规则

* 字幕文本直接使用 `segment.text`
* 一个 Segment 对应一条字幕
* 字幕时间按当前 Take 的时长顺序累加生成

### 导出前检查

* 至少存在一个可导出的 Segment
* 检查是否存在未录制 Segment
* 检查当前 Take 文件是否存在
* 如果存在未录制 Segment，应提示这些句子将被跳过，并由用户确认后继续

### MVP暂不支持

* 自动转写字幕
* 更复杂的字幕切分
* 单句音量调节
* 淡入淡出调节
* 响度归一化

---

## 保存与落盘策略

### 核心原则

* `project.json` 和 `segments.json` 必须原子写入
* `workspace.json` 使用节流保存
* 录音和重录都先写到 `temp/`，成功后再转正
* 工程内容改动后自动保存
* 菜单栏保留 Save 作为手动触发入口

### 保存触发

#### 立即保存 `segments.json`

* 导入文案并生成 Segments
* 编辑 Segment 文本
* 调整 Segment 顺序
* 新增 Take
* 重录成功
* 切换 `selectedTakeId`
* 删除 Take
* 删除 Segment

#### 保存 `project.json`

* 新建工程
* 修改工程名称
* 修改采样率 / 声道数
* 修改默认导出设置

#### 节流保存 `workspace.json`

* 切换当前选中 Segment
* 滚动 Segment 列表
* 缩放 / 滚动 Timeline
* 调整面板尺寸
* 窗口移动 / 缩放

### 录音落盘

#### 新增 Take

1. 录音服务先写入 `temp/`
2. 停止录音成功后，移动到正式路径
3. 更新 `segments.json`
4. 自动设为当前 Take

#### 重录当前 Take

1. 录音服务先写入 `temp/`
2. 停止录音成功后，用临时文件替换当前 Take 对应正式文件
3. `selectedTakeId` 不变
4. 保存 `segments.json`

### 临时文件

* `temp/` 同时用于录音临时文件和 JSON 临时写入文件
* 启动工程时应清理无主临时文件

### 错误处理原则

* 文件系统操作失败时，不应静默吞掉错误
* 录音落盘与工程数据更新之间应保持顺序一致
* 核心工程文件写入失败时，应给出明确错误提示

---

## 开发顺序与里程碑

### 第一阶段：工程骨架

* 初始化 Electron + electron-vite + React + TypeScript 工程
* 搭建基础目录结构
* 定义核心类型：Project / Segment / Take / Workspace
* 实现 `project.json` / `segments.json` / `workspace.json` 的读写模块

### 第二阶段：静态编辑器壳

* 完成标题栏、菜单栏、状态栏的基础布局
* 完成 Segments 视图、Inspector 视图、Control & Timeline 视图的静态骨架
* 完成可调尺寸布局
* 接入基础全局状态管理

### 第三阶段：录音闭环

* 接入 Recorder Utility Process
* 接通录音、重录、停止、取消录音流程
* 打通新增 Take、覆写当前 Take、切换当前 Take
* 打通播放当前句与播放整个项目的最小闭环

### 第四阶段：时间轴与联动

* 打通 Segments / Inspector / Timeline / Control 的联动
* 支持 Timeline clip 选中与重排
* 支持列表重排与时间轴同步

### 第五阶段：导出闭环

* 按 `order` + `selectedTakeId` 拼接音频
* 生成 WAV
* 生成 SRT
* 完成导出前检查与错误提示

### 第六阶段：首发打磨

* 完成空状态、错误提示、保存状态展示
* 完成临时文件清理
* 完成基础快捷键
* 完成最小可发布版本整理

---

## 开发前风险验证

### 必须尽早验证的事项

* 原生录音后端是否能稳定接入 Electron utility process
* 录音写入 `temp/` 后再转正的流程是否可靠
* 多个 Take 切换后，Timeline 长度与导出结果是否一致
* Canvas 渲染 Timeline 的性能是否足够支撑拖拽与滚动
* FFmpeg 在目标平台上的打包与调用是否稳定

### 验证目标

* 尽早发现录音稳定性、平台兼容性、导出链路问题
* 在大规模写 UI 前先验证关键技术闭环

---

## 验收标准

### 用户流程验收

用户可以完整完成：

1. 新建工程
2. 导入或粘贴文案
3. 自动生成多个 Segment
4. 为若干 Segment 录音
5. 对某一句重录
6. 为某一句录出多个 Take 并切换当前 Take
7. 调整多个 Segment 的顺序
8. 播放当前句
9. 播放整个项目
10. 导出 WAV 和 SRT

### 数据验收

* 工程关闭后再次打开，内容不丢
* Segment 顺序不乱
* `selectedTakeId` 不乱
* Timeline 和列表仍然一致
* 工程文件不容易因为异常退出损坏

### 体验验收

* 用户能理解“录音”和“重录”的区别
* 用户能理解“播放当前句”和“播放项目”的区别
* 用户能找到当前哪个 Take 是生效的
* 用户能在不看额外文档的情况下完成基础导出

---

## 仍待明确但不阻塞开工的事项

* 原生录音后端最终是 Node-API addon 还是 sidecar 进程
* 首发时是否默认显示实时输入电平
* 状态栏是否在首版显示输入设备信息
* 快捷键是否只在窗口内生效，还是支持更高级的全局行为
* Linux 是否进入首发支持范围

---
