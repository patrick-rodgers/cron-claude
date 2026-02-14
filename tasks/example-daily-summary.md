---
id: example-daily-summary
schedule: "0 9 * * *"  # Every day at 9 AM
invocation: cli
notifications:
  toast: true
enabled: false  # Set to true when ready to use
---

# Daily Summary Task

Please create a daily summary for me.

## Tasks

1. Check my calendar for today's meetings
2. Review any urgent emails from the last 24 hours
3. Create a brief summary report (bullet points)

## Output Format

Please format the output as:

### Daily Summary - [Date]

**Meetings Today:**
- [List of meetings]

**Urgent Items:**
- [Any urgent emails or tasks]

**Notes:**
- [Any other important information]

---

Save this summary to my OneDrive documents folder as `daily-summary-[date].md`.
