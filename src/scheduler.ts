/**
 * Windows Task Scheduler integration
 * Converts cron expressions to Task Scheduler triggers and manages scheduled tasks
 */

import { execSync } from 'child_process';
import { resolve, join } from 'path';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import cron from 'node-cron';

/**
 * Detect the path to claude/claude-code executable
 */
function detectClaudeCodePath(): string | null {
  try {
    // Try multiple command names: claude-code first, then claude
    const commands = process.platform === 'win32'
      ? ['where claude-code', 'where claude']
      : ['which claude-code', 'which claude'];

    for (const command of commands) {
      try {
        const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        // On Windows, 'where' can return multiple paths - take the first one
        const paths = result.split('\n');
        const path = paths[0].trim();
        if (path) {
          return path;
        }
      } catch {
        // Try next command
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}

interface ScheduleTrigger {
  type: 'daily' | 'weekly' | 'monthly' | 'once' | 'startup';
  time?: string; // HH:MM format
  days?: string[]; // For weekly: MON, TUE, etc.
  interval?: number; // For repeating tasks
}

/**
 * Parse cron expression and convert to Task Scheduler trigger
 * Cron format: minute hour day month weekday
 */
export function parseCronExpression(cronExpr: string): ScheduleTrigger {
  // Validate cron expression first
  if (!cron.validate(cronExpr)) {
    throw new Error(`Invalid cron expression: ${cronExpr}`);
  }

  const parts = cronExpr.split(' ');
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression format: ${cronExpr}`);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  // Determine trigger type and details
  const trigger: ScheduleTrigger = { type: 'daily' };

  // If hour and minute are specified
  if (hour !== '*' && minute !== '*') {
    const hourNum = parseInt(hour);
    const minuteNum = parseInt(minute);
    trigger.time = `${hourNum.toString().padStart(2, '0')}:${minuteNum.toString().padStart(2, '0')}`;
  } else {
    // Default to midnight
    trigger.time = '00:00';
  }

  // Check if it's a weekly schedule (specific day of week)
  if (dayOfWeek !== '*') {
    trigger.type = 'weekly';
    const dayMap: Record<string, string> = {
      '0': 'SUN',
      '1': 'MON',
      '2': 'TUE',
      '3': 'WED',
      '4': 'THU',
      '5': 'FRI',
      '6': 'SAT',
      '7': 'SUN',
    };
    trigger.days = dayOfWeek.split(',').map((d) => dayMap[d.trim()] || 'MON');
  }
  // Check if it's a monthly schedule (specific day of month)
  else if (dayOfMonth !== '*') {
    trigger.type = 'monthly';
  }

  return trigger;
}

/**
 * Generate PowerShell command to create scheduled task
 */
export function generateTaskSchedulerCommand(
  taskId: string,
  taskFilePath: string,
  trigger: ScheduleTrigger,
  projectRoot: string
): string {
  const executorPath = resolve(projectRoot, 'dist', 'executor.js');
  const absoluteTaskPath = resolve(taskFilePath);

  // Build the action command
  const actionCommand = `node "${executorPath}" "${absoluteTaskPath}"`;

  // Build trigger XML based on type
  let triggerXml = '';

  if (trigger.type === 'daily') {
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByDay>
          <DaysInterval>1</DaysInterval>
        </ScheduleByDay>
      </CalendarTrigger>`;
  } else if (trigger.type === 'weekly' && trigger.days) {
    const daysOfWeek = trigger.days.join('');
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByWeek>
          <WeeksInterval>1</WeeksInterval>
          <DaysOfWeek>
            ${trigger.days.map((day) => `<${day} />`).join('\n            ')}
          </DaysOfWeek>
        </ScheduleByWeek>
      </CalendarTrigger>`;
  } else if (trigger.type === 'monthly') {
    triggerXml = `
      <CalendarTrigger>
        <StartBoundary>2026-01-01T${trigger.time}:00</StartBoundary>
        <Enabled>true</Enabled>
        <ScheduleByMonth>
          <DaysOfMonth>
            <Day>1</Day>
          </DaysOfMonth>
          <Months>
            <January /><February /><March /><April /><May /><June />
            <July /><August /><September /><October /><November /><December />
          </Months>
        </ScheduleByMonth>
      </CalendarTrigger>`;
  }

  // Generate PowerShell script
  const psScript = `
$taskName = "CronClaude_${taskId}"
$action = New-ScheduledTaskAction -Execute "node" -Argument '"${executorPath}" "${absoluteTaskPath}"'
$trigger = New-ScheduledTaskTrigger -Daily -At "${trigger.time || '00:00'}"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType S4U

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "Task registered: $taskName"
`.trim();

  return psScript;
}

/**
 * Register a task in Windows Task Scheduler
 */
export function registerTask(
  taskId: string,
  taskFilePath: string,
  cronExpr: string,
  projectRoot: string
): void {
  try {
    console.log(`Registering task: ${taskId}`);
    console.log(`Cron expression: ${cronExpr}`);

    const trigger = parseCronExpression(cronExpr);
    console.log(`Trigger type: ${trigger.type}, time: ${trigger.time}`);

    const executorPath = resolve(projectRoot, 'dist', 'executor.js');
    const absoluteTaskPath = resolve(taskFilePath);

    // Detect claude-code path and pass it directly to executor
    const claudeCodePath = detectClaudeCodePath();

    if (claudeCodePath) {
      console.log(`Detected claude-code at: ${claudeCodePath}`);
    } else {
      console.log('Warning: claude-code not found in PATH - CLI tasks may fail');
    }

    // Build arguments: executor.js taskPath [claudeCodePath]
    const executorArgs = claudeCodePath
      ? `"${executorPath}" "${absoluteTaskPath}" "${claudeCodePath}"`
      : `"${executorPath}" "${absoluteTaskPath}"`;

    // Build PowerShell registration script
    const psScript = `
$ErrorActionPreference = 'Stop'
$action = New-ScheduledTaskAction -Execute "node" -Argument '${executorArgs}'
$trigger = New-ScheduledTaskTrigger -Daily -At "${trigger.time || '00:00'}"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType S4U
Register-ScheduledTask -TaskName "CronClaude_${taskId}" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "Task registered successfully"
`.trim();

    // Try normal registration first
    try {
      const psCommand = `powershell.exe -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`;
      execSync(psCommand, {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
      console.log(`✓ Task "${taskId}" registered successfully`);
      return;
    } catch (normalError: any) {
      // Check if it's an access denied error (check both message and stderr)
      const errorText = (normalError.message || '') + (normalError.stderr || '');
      const isAccessDenied =
        errorText.includes('Access is denied') ||
        errorText.includes('0x80070005') ||
        errorText.includes('PermissionDenied');

      if (isAccessDenied) {
        console.log('Administrator privileges required. Requesting elevation...');

        // Write script to temporary file
        const tempScript = join(tmpdir(), `cron-claude-register-${taskId}-${Date.now()}.ps1`);
        writeFileSync(tempScript, psScript, 'utf-8');

        try {
          // Execute with elevation
          const elevatedCommand = `powershell.exe -Command "Start-Process powershell -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '${tempScript}' -Verb RunAs -Wait"`;

          execSync(elevatedCommand, {
            stdio: 'inherit',
          });

          // Verify the task was created
          const verifyCommand = `powershell.exe -Command "Get-ScheduledTask -TaskName 'CronClaude_${taskId}' -ErrorAction SilentlyContinue | Select-Object -ExpandProperty TaskName"`;
          const result = execSync(verifyCommand, { encoding: 'utf-8' }).trim();

          if (result === `CronClaude_${taskId}`) {
            console.log(`✓ Task "${taskId}" registered successfully with elevated privileges`);
          } else {
            throw new Error('Task registration was cancelled or failed');
          }
        } finally {
          // Clean up temp file
          try {
            unlinkSync(tempScript);
          } catch {}
        }
      } else {
        throw normalError;
      }
    }
  } catch (error) {
    console.error(`Failed to register task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Unregister a task from Windows Task Scheduler
 */
export function unregisterTask(taskId: string): void {
  try {
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `Unregister-ScheduledTask -TaskName "${taskName}" -Confirm:$false`;

    execSync(psCommand, {
      shell: 'powershell.exe',
      stdio: 'inherit',
    });

    console.log(`✓ Task "${taskId}" unregistered successfully`);
  } catch (error) {
    console.error(`Failed to unregister task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Enable a task in Windows Task Scheduler
 */
export function enableTask(taskId: string): void {
  try {
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `Enable-ScheduledTask -TaskName "${taskName}"`;

    execSync(psCommand, {
      shell: 'powershell.exe',
      stdio: 'inherit',
    });

    console.log(`✓ Task "${taskId}" enabled`);
  } catch (error) {
    console.error(`Failed to enable task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Disable a task in Windows Task Scheduler
 */
export function disableTask(taskId: string): void {
  try {
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `Disable-ScheduledTask -TaskName "${taskName}"`;

    execSync(psCommand, {
      shell: 'powershell.exe',
      stdio: 'inherit',
    });

    console.log(`✓ Task "${taskId}" disabled`);
  } catch (error) {
    console.error(`Failed to disable task "${taskId}":`, error);
    throw error;
  }
}

/**
 * Get task status from Windows Task Scheduler
 */
export function getTaskStatus(taskId: string): {
  exists: boolean;
  enabled?: boolean;
  lastRunTime?: string;
  nextRunTime?: string;
} {
  try {
    const taskName = `CronClaude_${taskId}`;
    const psCommand = `Get-ScheduledTask -TaskName "${taskName}" | Select-Object State, @{Name="LastRunTime";Expression={(Get-ScheduledTaskInfo -TaskName "${taskName}").LastRunTime}}, @{Name="NextRunTime";Expression={(Get-ScheduledTaskInfo -TaskName "${taskName}").NextRunTime}} | ConvertTo-Json`;

    const output = execSync(psCommand, {
      shell: 'powershell.exe',
      encoding: 'utf-8',
      stdio: 'pipe',
    });

    const data = JSON.parse(output);

    return {
      exists: true,
      enabled: data.State === 'Ready',
      lastRunTime: data.LastRunTime,
      nextRunTime: data.NextRunTime,
    };
  } catch (error) {
    return { exists: false };
  }
}
