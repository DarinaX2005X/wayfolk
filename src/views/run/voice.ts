/**
 * Speaking a task or an instruction: the microphone is opened for one utterance, the
 * sound is kept as 16 kHz mono PCM and sent as WAV to the model through the app's own
 * proxy (task `dictate`), which writes it down. Only when live runs are on and the proxy
 * has a model that hears (store.llm.audio).
 */
import type { LlmClient } from '../../agents/types';

export type Recording = {
  /** Stops and gives the WAV as base64 without a data-URI prefix. */
  stop(): Promise<string>;
  cancel(): void;
};

const RATE = 16000;

export async function startRecording(onLevel: (level: number) => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is deprecated but runs everywhere the app runs, without a module file.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  const chunks: Float32Array[] = [];
  node.onaudioprocess = (e) => {
    const data = e.inputBuffer.getChannelData(0);
    chunks.push(new Float32Array(data));
    let peak = 0;
    for (let i = 0; i < data.length; i += 16) peak = Math.max(peak, Math.abs(data[i]));
    onLevel(Math.min(1, peak * 2.5));
  };
  source.connect(node);
  node.connect(ctx.destination);
  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    node.disconnect();
    source.disconnect();
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
  };
  return {
    stop: async () => {
      close();
      return wavBase64(chunks, ctx.sampleRate);
    },
    cancel: () => {
      close();
    },
  };
}

function wavBase64(chunks: Float32Array[], rate: number): string {
  const length = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + length * 2);
  const v = new DataView(buffer);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, length * 2, true);
  let o = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++, o += 2) {
      const s = Math.max(-1, Math.min(1, c[i]));
      v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
  }
  const bytes = new Uint8Array(buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Writes down what was said. Empty string when nothing was heard. */
export async function dictate(llm: LlmClient, wav: string, about: 'task' | 'instruction'): Promise<string> {
  const r = await llm.call({
    task: 'dictate',
    index: 1,
    attempt: 1,
    payload: null,
    audio: wav,
    messages: [
      {
        role: 'system',
        content:
          'Write down what the person says, word for word, in plain sentences. Leave out filler words. ' +
          (about === 'task' ? 'They are giving a task to a team of agents.' : 'They are telling an agent how to redo its work.') +
          ' Answer with JSON {"text": "..."}; an empty string when nothing was said.',
      },
      { role: 'user', content: 'Here is the recording.' },
    ],
    schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false },
  });
  const text = (r.json as { text?: unknown } | null)?.text;
  return typeof text === 'string' ? text.trim() : '';
}
