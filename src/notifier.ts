/**
 * Windows Toast Notification system
 * Sends notifications when tasks complete
 */

import notifier from 'node-notifier';

/**
 * Send a Windows toast notification
 */
export async function sendNotification(title: string, message: string): Promise<void> {
  return new Promise((resolve, reject) => {
    notifier.notify(
      {
        title,
        message,
        icon: undefined, // Could add a custom icon later
        sound: true,
        wait: false,
        appID: 'cron-claude',
      },
      (err, response) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      }
    );
  });
}

/**
 * Send success notification
 */
export async function notifySuccess(taskId: string, message?: string): Promise<void> {
  await sendNotification(
    `✓ Task Completed: ${taskId}`,
    message || 'Task executed successfully'
  );
}

/**
 * Send failure notification
 */
export async function notifyFailure(taskId: string, error?: string): Promise<void> {
  await sendNotification(
    `✗ Task Failed: ${taskId}`,
    error || 'Task execution failed'
  );
}
