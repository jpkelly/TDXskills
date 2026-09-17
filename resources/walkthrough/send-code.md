## Send code to TouchDesigner

Open any Python file and use:

| Shortcut | Sends |
|---|---|
| **⌘/Ctrl + Enter** | the selection, or the current line if nothing is selected |
| **Shift + Enter** | the current line |
| **⌘/Ctrl + Shift + Enter** | the whole file |

Try a single expression:

```python
op('/project1').name
```

Expressions return their value, printed as `=> 'project1'`. Statements run and
their `print()` output is captured instead. You do not have to say which is which —
TouchDesigner compiles the code and decides.

There is also a send button in the editor title bar on Python files.
