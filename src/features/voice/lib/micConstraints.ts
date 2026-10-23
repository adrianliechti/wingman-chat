/** Microphone constraints shared by dictation and realtime capture. */
export function micConstraints(deviceId?: string, extra: MediaTrackConstraints = {}): MediaTrackConstraints {
  return {
    ...(deviceId && { deviceId: { exact: deviceId } }),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    ...extra,
  };
}
