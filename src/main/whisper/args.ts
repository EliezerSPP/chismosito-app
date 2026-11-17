export interface WhisperArgsOptions {
  modelPath: string
  wavPath: string
  language: string
  device: 'cpu' | 'cuda'
  threads: number
  outputBase: string
  vadModelPath?: string | null
}

/**
 * Construye los argumentos de whisper-cli.
 *
 * `-mc 0` desactiva el contexto de texto entre segmentos y `-et 2.0` baja el
 * umbral de entropía: juntos evitan que una alucinación se propague al resto
 * de la transcripción. `-sns` descarta tokens de no-habla y `--vad` ignora los
 * silencios usando Silero VAD.
 */
export function buildWhisperArgs(options: WhisperArgsOptions): string[] {
  const args = [
    '-m',
    options.modelPath,
    '-f',
    options.wavPath,
    '-l',
    options.language || 'es',
    '-t',
    String(Math.max(1, options.threads)),
    '-oj',
    '-of',
    options.outputBase,
    '-pp',
    '-mc',
    '0',
    '-et',
    '2.0',
    '-sns'
  ]

  if (options.vadModelPath) {
    args.push('--vad', '-vm', options.vadModelPath)
  }
  if (options.device === 'cpu') args.push('-ng')

  return args
}
