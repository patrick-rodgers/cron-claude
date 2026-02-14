---
id: example-weekly-backup
schedule: "0 0 * * 0"  # Every Sunday at midnight
invocation: cli
notifications:
  toast: true
enabled: false
---

# Weekly Backup Task

Perform a weekly backup of important project files.

## Instructions

1. Search for all `.md` files in my Documents folder modified in the last 7 days
2. Create a backup report listing:
   - File names
   - Sizes
   - Last modified dates
3. If any files are larger than 10MB, flag them for review

## Output

Create a backup report and save it to `C:\Users\[username]\OneDrive\Backups\weekly-report-[date].md`

Include recommendations for files that should be archived or cleaned up.
