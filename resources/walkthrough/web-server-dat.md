## Set up the Web Server DAT

In TouchDesigner:

1. Press **Tab**, type `Web Server`, and create a **Web Server DAT**
2. Set **Port** to `9980`
3. Click the **+** next to **Callbacks DAT** to create the docked callbacks DAT
4. On that docked DAT, set **File** to the callback script you saved
5. Turn **Sync to File** on
6. Turn **Active** on

**Sync to File must be on.** Without it the DAT keeps its original text and your
edits in VS Code never reach TouchDesigner.

If you use a different port, change `tdBridge.port` in settings to match.
