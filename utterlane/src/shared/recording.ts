/**
 * 录音相关的 IPC 类型。
 *
 * 和 docs/utterlane.md#录音服务架构 的消息契约保持一致——
 * 接口命名按「产品动作」而不是「底层 API」，
 * 这样后续把后端从 Web Audio 换成 miniaudio utility process 时，
 * 上层 store / UI 不需要动。
 */

export type InputDevice = {
  /** 平台相关的设备标识；Web Audio 下是 MediaDeviceInfo.deviceId */
  id: string
  label: string
}

/** 录音服务写盘成功后 main 给 renderer 的返回 */
export type WriteTakeResult = { ok: true; filePath: string } | { ok: false; message: string }
