export function handleOutputError(error: NodeJS.ErrnoException) {
  // A detached development terminal must not crash desktop control.
  if (error.code !== 'EPIPE') throw error;
}

export function protectProcessOutput() {
  for (const stream of [process.stdout, process.stderr])
    stream.on('error', handleOutputError);
}
