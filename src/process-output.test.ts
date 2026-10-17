import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { handleOutputError, protectProcessOutput } from './process-output';

it('handles broken output pipes while preserving other errors', () => {
  const pipe = new EventEmitter();
  pipe.on('error', handleOutputError);
  expect(() =>
    pipe.emit(
      'error',
      Object.assign(new Error('broken pipe'), { code: 'EPIPE' }),
    ),
  ).not.toThrow();
  const other = Object.assign(new Error('write failed'), { code: 'EIO' });
  expect(() => pipe.emit('error', other)).toThrow(other);
});

it('protects both output streams', () => {
  const stdout = vi.spyOn(process.stdout, 'on');
  const stderr = vi.spyOn(process.stderr, 'on');
  try {
    protectProcessOutput();
    expect(stdout).toHaveBeenCalledWith('error', handleOutputError);
    expect(stderr).toHaveBeenCalledWith('error', handleOutputError);
  } finally {
    process.stdout.removeListener('error', handleOutputError);
    process.stderr.removeListener('error', handleOutputError);
    stdout.mockRestore();
    stderr.mockRestore();
  }
});
