/**
 * 录音用 AudioWorklet processor。
 *
 * === 为什么独立 .js 文件 ===
 *
 * AudioWorklet 跑在独立的 audio rendering thread，与主线程隔离——React
 * 重渲染、layout、GC pause 等都不会让它丢 buffer。是替换 ScriptProcessorNode
 * 的标准方案。
 *
 * 这个文件被 recorder.ts 通过 `import workletUrl from './recorder-worklet.js?url'`
 * 加载——?url 让 Vite 把它原样 emit 为 asset，URL 在 dev / prod 都能稳定
 * 解析为 'self' 同源（避免 CSP script-src 拦截 blob:）。
 *
 * worklet 全局环境是隔离的：只能用 AudioWorklet 提供的全局 API
 * （registerProcessor / currentTime / sampleRate / AudioWorkletProcessor），
 * 不能 import npm 包，也不能访问 window / document。所以保持纯 JS。
 *
 * === 数据流 ===
 *
 * 每个 audio quantum（默认 128 samples）调一次 process()。我们：
 *   1. 把 inputs[0] 的每个声道复制到独立 Float32Array（inputs 是 worklet
 *      runtime 复用的临时 buffer，下一帧会被覆盖）
 *   2. 通过 port.postMessage 把 channels 发给主线程，并用 transferable
 *      转移 ArrayBuffer 所有权——避免每帧 ~1KB 的拷贝
 *
 * 不在 worklet 里做 RMS 计算 / PCM 拼接：
 *   - RMS：放主线程做，主线程的订阅 / RAF 节流逻辑没必要搬过来
 *   - 拼接：worklet 不应该持有跨帧的累积数据（不必要的内存压力）
 */

class RecorderProcessor extends AudioWorkletProcessor {
  /**
   * @param {Float32Array[][]} inputs
   * @returns {boolean} true 让 processor 继续存活
   */
  // worklet runtime 不允许 TS 编译，方法签名只能用 JSDoc。
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  process(inputs) {
    const input = inputs[0]
    // 输入可能为空（mic 还没启动 / 设备切换瞬间）。空时返回 true 让
    // processor 继续存活
    if (!input || input.length === 0 || input[0].length === 0) return true

    // 关键：input[c] 是 worklet runtime 复用的临时 buffer，下一帧会被
    // 覆盖。必须复制后再 postMessage——否则主线程拿到的引用会被改写
    const channels = []
    for (let c = 0; c < input.length; c++) {
      channels.push(new Float32Array(input[c]))
    }

    // transferable 把每个 channel 的 ArrayBuffer 所有权交给主线程，省去
    // 跨线程拷贝。worklet 端 channels[c] 之后不可再用——但反正每帧重新
    // 创建，没问题
    this.port.postMessage(
      { channels },
      channels.map((ch) => ch.buffer)
    )

    return true
  }
}

registerProcessor('utterlane-recorder', RecorderProcessor)
