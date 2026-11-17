const TARGET_RATE = 16_000

/**
 * Decodifica el audio de una nota (webm/opus) a PCM 16 kHz mono int16.
 * Se hace en el renderer porque Chromium es el único que trae decodificador
 * de Opus; whisper.cpp solo lee WAV/MP3/FLAC y el proceso principal no tiene
 * ffmpeg.
 */
export async function decodeAudioToPcm(url: string): Promise<Int16Array> {
  const response = await fetch(url)
  if (!response.ok) throw new Error('No se pudo leer el audio de la nota')
  const buffer = await response.arrayBuffer()

  // decodeAudioData remuestrea a la frecuencia del contexto y mezcla a mono.
  const context = new OfflineAudioContext(1, TARGET_RATE, TARGET_RATE)
  const decoded = await context.decodeAudioData(buffer)
  const channel = decoded.getChannelData(0)

  const output = new Int16Array(channel.length)
  for (let i = 0; i < channel.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i]))
    output[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff
  }
  return output
}
