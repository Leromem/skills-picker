# Skills picker

A mod for Claude Code that adds a **Skills** button above the message box. Click it, pick one or more skills, and Claude loads them before answering your next message, or every message for the rest of the chat.

## What it does

- **Skills button:** opens the picker. While skills are picked, it reads `Skills · 2` and lists them beside it.
- **★ Pinned:** your favourite skills, shown first. Press **☆ Pin skills**, then click skills to pin or unpin them. Pins are kept across all chats.
- **Most used:** the skills you run most often, counted from the moment you install the mod.
- **This project:** skills installed in the current project's `.claude/skills` folder.
- **Manual:** skills only you can start, such as ones with `disable-model-invocation: true`. Clicking one puts `/skill-name ` at the front of your message box, so it runs as a command when you send. With **Whole chat** selected, the command is put back in front of the message box after every send, until you click it again or press **Clear**.
- **All skills:** everything else, with a filter box.

Choose how long new picks last:

- **Next message only:** the pick is used once, then drops off.
- **Whole chat:** the pick stays until you press **Clear**, run `/clear`, or open a new chat.

### Project defaults

Use the same skills in a project every time? Save them once:

- **Save picks as project default:** stores the current picks for this project folder. Every new chat there, and every `/clear`, starts with them picked for the whole chat. A manual skill in the default is already typed at the front of your message box.
- **Standing note:** a line such as `time matters here` or `just answer`, sent to Claude with every message in this project, slash commands included. It shows as `Note: …` beside the Skills button. Clear the field and press Enter to remove it.
- **Remove project default:** stops restoring the picks. The note stays until you clear it.

Each project keeps its own defaults.

When you send a message, the mod adds a hidden note telling Claude to load the picked skills first. The text you typed isn't changed.

## Install

You need [Claude Code](https://claude.com/claude-code).

### In a terminal session of Claude Code

Type this at the prompt:

```
/plugin install skills-picker --marketplace Leromem/skills-picker
```

1. Answer `y` when asked **Add marketplace?**
2. Press Enter to choose the **user** scope, so the mod works in every project.
3. You'll see `Installed skills-picker. Plugin is now active.` The Skills button shows above the message box right away.

### From a regular shell (PowerShell, Terminal, bash)

```bash
claude plugin install skills-picker --marketplace Leromem/skills-picker
```

Then start a new Claude Code chat.

### In the Claude desktop app

`/plugin` doesn't run in the desktop app. Do this instead:

1. Click **+** next to the message box, then **Plugins**.
2. Choose **Add marketplace** and enter `Leromem/skills-picker`.
3. Choose **Add plugin** and pick **skills-picker**.
4. Open a new chat.

## Update

```bash
claude plugin marketplace update skills-picker
```

Then open a new chat, or run `/reload-plugins`.

## Uninstall

```bash
claude plugin uninstall skills-picker@skills-picker
```

## Privacy

Everything stays on your computer. Your pins, usage counts and project defaults are saved in Claude Code's local plugin storage, and the mod sends nothing anywhere.

## License

MIT
