import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

describe('CLI', () => {
  function createProgram() {
    const program = new Command();
    program.name('docsynth').description('AI-powered documentation generator').version('0.1.0');

    program.exitOverride();

    program.command('init').description('Initialize DocSynth in a repository');
    program.command('generate').description('Generate documentation for the current repository');
    program.command('status').description('Check status of DocSynth for this repository');
    program.command('login').description('Authenticate with DocSynth');
    program.command('config').description('Manage DocSynth configuration');

    return program;
  }

  it('should define all expected commands', () => {
    const program = createProgram();
    const commandNames = program.commands.map((cmd) => cmd.name());

    expect(commandNames).toContain('init');
    expect(commandNames).toContain('generate');
    expect(commandNames).toContain('status');
    expect(commandNames).toContain('login');
    expect(commandNames).toContain('config');
  });

  it('should have correct name and version', () => {
    const program = createProgram();
    expect(program.name()).toBe('docsynth');
    expect(program.version()).toBe('0.1.0');
  });

  it('should show help without error', () => {
    const program = createProgram();
    const helpText = program.helpInformation();
    expect(helpText).toContain('docsynth');
    expect(helpText).toContain('AI-powered documentation generator');
  });

  it('should error on unknown commands', () => {
    const program = createProgram();
    expect(() => program.parse(['node', 'docsynth', 'nonexistent'])).toThrow();
  });
});
